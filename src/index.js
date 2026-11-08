
const SESSION_DURATION_DAYS = 7;

// ==========================================
// ATRAMENTUM QUIDDITCH
// Cloudflare Worker + D1 Database
// ==========================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

function getToken(request) {
  const authorization = request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim();
}

async function getPlayer(request, env) {
  const token = getToken(request);

  if (!token) {
    return null;
  }

  const result = await env.atramentum_db.prepare(`
    SELECT
      p.id,
      p.name,
      p.team_id,
      p.player_number,
      p.position,
      p.active,
      t.display_name AS team_name,
      t.emblem AS team_emblem,
      s.token
    FROM sessions s
    JOIN players p ON p.id = s.player_id
    JOIN teams t ON t.id = p.team_id
    WHERE s.token = ?
      AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND p.active = 1
    LIMIT 1
  `).bind(token).first();

  return result || null;
}

async function handleLogin(request, env) {
  if (request.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Invalid request body" }, 400);
  }

  const code = String(body?.code || "").trim();

  if (!code || code.length > 100) {
    return json({
      success: false,
      message: "Please enter your player code."
    }, 400);
  }

  const codeHash = await sha256(code);

  const player = await env.atramentum_db.prepare(`
    SELECT id, name, team_id, player_number, position
    FROM players
    WHERE player_code_hash = ?
      AND active = 1
    LIMIT 1
  `).bind(codeHash).first();

  if (!player) {
    return json({
      success: false,
      message: "Invalid player code."
    }, 401);
  }

  const token = createToken();

  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await env.atramentum_db.prepare(`
    INSERT INTO sessions (player_id, token, expires_at)
    VALUES (?, ?, ?)
  `).bind(player.id, token, expiresAt).run();

  return json({
    success: true,
    message: "Login successful.",
    // Keep both names during the frontend compatibility transition.
    token: token,
    session: token,
    playerId: player.id,
    name: player.name,
    teamId: player.team_id,
    playerNumber: player.player_number,
    position: player.position
  });
}

async function handleProfile(request, env) {
  if (request.method !== "GET") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  const player = await getPlayer(request, env);

  if (!player) {
    return json({
      success: false,
      message: "Session expired or invalid."
    }, 401);
  }

  const playerData = {
    id: player.id,
    name: player.name,
    teamId: player.team_id,
    teamName: player.team_name,
    teamEmblem: player.team_emblem,
    playerNumber: player.player_number,
    position: player.position,
    active: player.active
  };

  return json({
    success: true,
    player: playerData,

    // Flat fields for compatibility with the website
    playerId: player.id,
    name: player.name,
    teamId: player.team_id,
    teamName: player.team_name,
    playerNumber: player.player_number,
    position: player.position,
    active: player.active
  });
}

async function handleLogout(request, env) {
  if (request.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  const token = getToken(request);

  if (token) {
    await env.atramentum_db.prepare(`
      DELETE FROM sessions WHERE token = ?
    `).bind(token).run();
  }

  return json({
    success: true,
    message: "Logged out successfully."
  });
}

async function handleTeams(request, env) {
  const result = await env.atramentum_db.prepare(`
    SELECT
      id,
      name,
      display_name,
      emblem,
      points
    FROM teams
    ORDER BY points DESC, name ASC
  `).all();

  return json({
    success: true,
    teams: result.results || []
  });
}

async function handleLeaderboard(request, env) {
  const result = await env.atramentum_db.prepare(`
    SELECT
      t.id AS team_id,
      t.name,
      t.display_name,
      t.emblem,
      t.points,
      COUNT(p.id) AS player_count
    FROM teams t
    LEFT JOIN players p
      ON p.team_id = t.id
      AND p.active = 1
    GROUP BY t.id
    ORDER BY t.points DESC, t.name ASC
  `).all();

  return json({
    success: true,
    leaderboard: result.results || []
  });
}

async function handleMatches(request, env) {
  const result = await env.atramentum_db.prepare(`
    SELECT
      m.id,
      m.scheduled_at,
      m.status,
      m.winner_team_id,
      home.name AS home_team,
      home.emblem AS home_emblem,
      away.name AS away_team,
      away.emblem AS away_emblem
    FROM matches m
    JOIN teams home ON home.id = m.home_team_id
    JOIN teams away ON away.id = m.away_team_id
    ORDER BY
      CASE WHEN m.status = 'scheduled' THEN 0 ELSE 1 END,
      m.scheduled_at DESC
  `).all();

  return json({
    success: true,
    matches: result.results || []
  });
}

async function handleHealth(env) {
  const result = await env.atramentum_db.prepare(
    "SELECT 1 AS database_connected"
  ).first();

  return json({
    success: true,
    server: "Atramentum Quidditch",
    database: result.database_connected === 1
  });
}


const ADMIN_SESSION_DAYS = 1;
const ADMIN_PASSWORD_ITERATIONS = 310000;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function deriveAdminPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: hexToBytes(saltHex), iterations: ADMIN_PASSWORD_ITERATIONS, hash: "SHA-256"
  }, key, 256);
  return Array.from(new Uint8Array(bits)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function writeAdminAudit(env, adminId, action, targetUsername, details) {
  await env.atramentum_db.prepare(`
    INSERT INTO admin_audit_logs (admin_id, action, target_username, details)
    VALUES (?, ?, ?, ?)
  `).bind(adminId || null, action, targetUsername || null, details || null).run();
}

async function getAdmin(request, env) {
  const token = getToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return await env.atramentum_db.prepare(`
    SELECT a.id, a.username, a.display_name, a.role, a.team_id, a.active
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_id
    WHERE s.token_hash = ?
      AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND a.active = 1
    LIMIT 1
  `).bind(tokenHash).first();
}

async function handleAdminBootstrap(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!env.ADMIN_BOOTSTRAP_SECRET) return json({ success: false, message: "Admin bootstrap is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }
  if (!safeEqual(body?.bootstrapSecret || "", env.ADMIN_BOOTSTRAP_SECRET)) {
    return json({ success: false, message: "Invalid setup authorization." }, 403);
  }
  const password = String(body?.password || "");
  if (password.length < 14 || password.length > 200) {
    return json({ success: false, message: "Password must be between 14 and 200 characters." }, 400);
  }
  const admin = await env.atramentum_db.prepare(`
    SELECT id, username, password_hash FROM admin_users
    WHERE username = 'ACAME_IX47' AND role = 'super_admin' LIMIT 1
  `).first();
  if (!admin) return json({ success: false, message: "Initial administrator record is missing." }, 500);
  if (admin.password_hash) return json({ success: false, message: "Initial administrator has already been configured." }, 409);
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
  const passwordHash = await deriveAdminPassword(password, salt);
  await env.atramentum_db.prepare(`
    UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND password_hash IS NULL
  `).bind(passwordHash, salt, admin.id).run();
  await writeAdminAudit(env, admin.id, "bootstrap_completed", admin.username, "Initial super administrator configured.");
  return json({ success: true, message: "Initial administrator password configured. You can now sign in." });
}

async function handleAdminLogin(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!username || username.length > 80 || !password || password.length > 200) {
    return json({ success: false, message: "نام کاربری یا رمز عبور معتبر نیست." }, 400);
  }
  const admin = await env.atramentum_db.prepare(`
    SELECT id, username, display_name, role, team_id, password_hash, password_salt, active
    FROM admin_users WHERE username = ? COLLATE NOCASE LIMIT 1
  `).bind(username).first();
  if (!admin || !admin.active || !admin.password_hash || !admin.password_salt) {
    return json({ success: false, message: "نام کاربری یا رمز عبور نادرست است." }, 401);
  }
  const candidate = await deriveAdminPassword(password, admin.password_salt);
  if (!safeEqual(candidate, admin.password_hash)) {
    return json({ success: false, message: "نام کاربری یا رمز عبور نادرست است." }, 401);
  }
  const token = createToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.atramentum_db.prepare(`
    INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)
  `).bind(admin.id, await sha256(token), expiresAt).run();
  await writeAdminAudit(env, admin.id, "login", admin.username, "Administrator signed in.");
  return json({ success: true, token, expiresAt, admin: {
    id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, teamId: admin.team_id
  }});
}

async function handleAdminMe(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed" }, 405);
  const admin = await getAdmin(request, env);
  if (!admin) return json({ success: false, message: "Admin session expired or invalid." }, 401);
  return json({ success: true, admin: {
    id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, teamId: admin.team_id
  }});
}

async function handleAdminLogout(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  const token = getToken(request);
  if (token) await env.atramentum_db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ success: true, message: "Admin session closed." });
}

async function handleAdminUsers(request, env) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ success: false, message: "Admin session expired or invalid." }, 401);
  if (admin.role !== "super_admin") return json({ success: false, message: "Insufficient permissions." }, 403);
  if (request.method === "GET") {
    const result = await env.atramentum_db.prepare(`
      SELECT username, display_name, role, team_id, active,
        CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS password_configured
      FROM admin_users
      ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'house_admin' THEN 1 ELSE 2 END, username
    `).all();
    return json({ success: true, users: result.results || [] });
  }
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!username || password.length < 14 || password.length > 200) {
      return json({ success: false, message: "Username is required and password must be at least 14 characters." }, 400);
    }
    const target = await env.atramentum_db.prepare(
      "SELECT id, username FROM admin_users WHERE username = ? COLLATE NOCASE LIMIT 1"
    ).bind(username).first();
    if (!target) return json({ success: false, message: "Administrator account not found." }, 404);
    if (target.username === "ACAME_IX47") return json({ success: false, message: "Use the dedicated recovery process for the super administrator." }, 403);
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = Array.from(saltBytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const passwordHash = await deriveAdminPassword(password, salt);
    await env.atramentum_db.prepare(`
      UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(passwordHash, salt, target.id).run();
    await env.atramentum_db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(target.id).run();
    await writeAdminAudit(env, admin.id, "set_admin_password", target.username, "Password provisioned by super administrator.");
    return json({ success: true, message: "Password configured. The account can now sign in." });
  }
  return json({ success: false, message: "Method not allowed" }, 405);
}

// ==========================================
// MAIN ROUTER
// ==========================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {

      if (path === "/api/admin/bootstrap") {
        return await handleAdminBootstrap(request, env);
      }

      if (path === "/api/admin/login") {
        return await handleAdminLogin(request, env);
      }

      if (path === "/api/admin/me") {
        return await handleAdminMe(request, env);
      }

      if (path === "/api/admin/logout") {
        return await handleAdminLogout(request, env);
      }

      if (path === "/api/admin/users") {
        return await handleAdminUsers(request, env);
      }

      if (path === "/api/login") {
        return await handleLogin(request, env);
      }

      if (path === "/api/profile") {
        return await handleProfile(request, env);
      }

      if (path === "/api/logout") {
        return await handleLogout(request, env);
      }

      if (path === "/api/teams") {
        return await handleTeams(request, env);
      }

      if (path === "/api/leaderboard") {
        return await handleLeaderboard(request, env);
      }

      if (path === "/api/matches") {
        return await handleMatches(request, env);
      }

      if (path === "/api/health") {
        return await handleHealth(env);
      }

      if (path.startsWith("/api/")) {
        return json({
          success: false,
          message: "API endpoint not found."
        }, 404);
      }

      return await env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Atramentum server error:", error);

      return json({
        success: false,
        message: "Internal server error."
      }, 500);
    }
  }
};
