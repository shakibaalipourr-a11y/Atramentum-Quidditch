
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
