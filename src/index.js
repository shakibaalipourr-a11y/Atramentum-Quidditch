
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
const ADMIN_PASSWORD_ITERATIONS = 100000;

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

async function handleAdminRecovery(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  if (!env.ADMIN_RECOVERY_SECRET) return json({ success: false, message: "Recovery is not configured." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  if (!safeEqual(body?.recoverySecret || "", env.ADMIN_RECOVERY_SECRET)) {
    return json({ success: false, message: "Recovery authorization failed." }, 403);
  }

  const password = String(body?.password || "");
  if (password.length < 14 || password.length > 200) {
    return json({ success: false, message: "Password must be between 14 and 200 characters." }, 400);
  }

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
  const passwordHash = await deriveAdminPassword(password, salt);

  const results = await env.atramentum_db.batch([
    env.atramentum_db.prepare(`
      UPDATE admin_users
      SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE username = 'ACAME_IX47' AND role = 'super_admin'
        AND NOT EXISTS (
          SELECT 1 FROM admin_audit_logs
          WHERE action = 'super_admin_recovery_completed'
            AND target_username = 'ACAME_IX47'
        )
    `).bind(passwordHash, salt),
    env.atramentum_db.prepare(`
      INSERT INTO admin_audit_logs (admin_id, action, target_username, details)
      SELECT NULL, 'super_admin_recovery_completed', 'ACAME_IX47',
        'One-time super administrator password recovery completed.'
      WHERE changes() = 1
    `)
  ]);

  if (!results[0]?.meta?.changes) {
    return json({ success: false, message: "Recovery has already been used or the administrator account is unavailable." }, 409);
  }

  await env.atramentum_db.prepare(`
    DELETE FROM admin_sessions
    WHERE admin_id = (SELECT id FROM admin_users WHERE username = 'ACAME_IX47' LIMIT 1)
  `).run();

  return json({ success: true, message: "Super administrator password updated. Recovery can no longer be used." });
}

async function handleAdminSetupStatus(env) {
  const admin = await env.atramentum_db.prepare(`
    SELECT CASE WHEN password_hash IS NOT NULL AND password_salt IS NOT NULL THEN 1 ELSE 0 END AS configured
    FROM admin_users
    WHERE username = 'ACAME_IX47' AND role = 'super_admin'
    LIMIT 1
  `).first();
  if (!admin) return json({ success: false, configured: false }, 404);
  return json({ success: true, configured: admin.configured === 1 });
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


async function getManagedMatch(env, matchId) {
  return env.atramentum_db.prepare(`
    SELECT m.id, m.home_team_id, m.away_team_id, m.scheduled_at, m.status,
      m.winner_team_id, home.display_name AS home_name, home.emblem AS home_emblem,
      away.display_name AS away_name, away.emblem AS away_emblem
    FROM matches m
    JOIN teams home ON home.id = m.home_team_id
    JOIN teams away ON away.id = m.away_team_id
    WHERE m.id = ? LIMIT 1
  `).bind(matchId).first();
}

function canManageMatch(admin, match) {
  if (admin.role === "super_admin" || admin.role === "referee") return true;
  return admin.role === "house_admin" &&
    (admin.team_id === match.home_team_id || admin.team_id === match.away_team_id);
}


async function handlePublicMatchLive(request, env, matchId) {
  const player = await getPlayer(request,env);
  const admin = player ? null : await getAdmin(request,env);
  if (!player && !admin) return json({success:false,message:"A valid player or administrator session is required."},401);
  const id=Number(matchId);
  if (!Number.isSafeInteger(id)||id<1) return json({success:false,message:"Invalid match ID."},400);
  const match=await getManagedMatch(env,id);
  if (!match) return json({success:false,message:"Match not found."},404);
  const [state,scores,events]=await Promise.all([
    env.atramentum_db.prepare("SELECT positions_json,balls_json,revision,updated_at FROM match_live_state WHERE match_id=?").bind(id).first(),
    env.atramentum_db.prepare("SELECT team_id,score FROM match_team_results WHERE match_id=?").bind(id).all(),
    env.atramentum_db.prepare("SELECT id,team_id,event_type,points,description,event_time FROM match_events WHERE match_id=? ORDER BY id DESC LIMIT 20").bind(id).all()
  ]);
  let positions=[],balls=[];
  try{positions=state?.positions_json?JSON.parse(state.positions_json):[]}catch{}
  try{balls=state?.balls_json?JSON.parse(state.balls_json):[]}catch{}
  return json({success:true,match,positions,balls,revision:state?.revision||0,updatedAt:state?.updated_at||null,scores:scores.results||[],events:events.results||[]});
}

async function handleAdminMatches(request, env) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ success:false, message:"Admin session expired or invalid." },401);
  if (!["super_admin","house_admin","referee"].includes(admin.role))
    return json({ success:false,message:"Insufficient permissions." },403);

  if (request.method === "POST") {
    if (admin.role !== "super_admin") return json({success:false,message:"Only the super administrator may create fixtures."},403);
    let body;
    try { body=await request.json(); } catch { return json({success:false,message:"Invalid request body."},400); }
    const homeTeamId=String(body?.homeTeamId||"");
    const awayTeamId=String(body?.awayTeamId||"");
    const scheduledAt=body?.scheduledAt?String(body.scheduledAt):null;
    if (!homeTeamId || !awayTeamId || homeTeamId===awayTeamId)
      return json({success:false,message:"Choose two different participating teams."},400);
    if (scheduledAt && (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(scheduledAt) || Number.isNaN(Date.parse(scheduledAt))))
      return json({success:false,message:"Invalid scheduled date and time."},400);
    const teams=await env.atramentum_db.prepare("SELECT id FROM teams WHERE id IN (?,?)").bind(homeTeamId,awayTeamId).all();
    if ((teams.results||[]).length!==2) return json({success:false,message:"One or both teams do not exist."},400);
    const created=await env.atramentum_db.prepare(
      "INSERT INTO matches(home_team_id,away_team_id,scheduled_at,status) VALUES(?,?,?,'scheduled')"
    ).bind(homeTeamId,awayTeamId,scheduledAt).run();
    const matchId=created.meta?.last_row_id;
    await writeAdminAudit(env,admin.id,"match_created",String(matchId),JSON.stringify({homeTeamId,awayTeamId,scheduledAt}));
    return json({success:true,matchId,message:"Fixture created."},201);
  }
  if (request.method === "GET") {
    const result = await env.atramentum_db.prepare(`
      SELECT m.id, m.scheduled_at, m.status, m.winner_team_id,
        m.home_team_id, m.away_team_id,
        home.display_name AS home_name, home.emblem AS home_emblem,
        away.display_name AS away_name, away.emblem AS away_emblem,
        COALESCE(hr.score,0) AS home_score, COALESCE(ar.score,0) AS away_score,
        COALESCE(ls.revision,0) AS live_revision, ls.updated_at AS live_updated_at
      FROM matches m
      JOIN teams home ON home.id=m.home_team_id
      JOIN teams away ON away.id=m.away_team_id
      LEFT JOIN match_team_results hr ON hr.match_id=m.id AND hr.team_id=m.home_team_id
      LEFT JOIN match_team_results ar ON ar.match_id=m.id AND ar.team_id=m.away_team_id
      LEFT JOIN match_live_state ls ON ls.match_id=m.id
      WHERE (? != 'house_admin' OR m.home_team_id = ? OR m.away_team_id = ?)
      ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
        m.scheduled_at DESC, m.id DESC
    `).bind(admin.role, admin.team_id || "", admin.team_id || "").all();
    return json({success:true,matches:result.results||[],admin:{role:admin.role,teamId:admin.team_id}});
  }
  return json({success:false,message:"Method not allowed."},405);
}

async function handleAdminMatchLive(request, env, matchId) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({success:false,message:"Admin session expired or invalid."},401);
  if (!["super_admin","house_admin","referee"].includes(admin.role))
    return json({success:false,message:"Insufficient permissions."},403);
  const id = Number(matchId);
  if (!Number.isSafeInteger(id) || id < 1) return json({success:false,message:"Invalid match ID."},400);
  const match = await getManagedMatch(env,id);
  if (!match) return json({success:false,message:"Match not found."},404);
  if (!canManageMatch(admin,match)) return json({success:false,message:"This match is outside your team scope."},403);

  if (request.method === "GET") {
    const [state, scores, events] = await Promise.all([
      env.atramentum_db.prepare("SELECT positions_json, balls_json, revision, updated_at FROM match_live_state WHERE match_id=?").bind(id).first(),
      env.atramentum_db.prepare("SELECT team_id,score,result FROM match_team_results WHERE match_id=?").bind(id).all(),
      env.atramentum_db.prepare("SELECT id,player_id,team_id,event_type,points,description,event_time FROM match_events WHERE match_id=? ORDER BY id DESC LIMIT 40").bind(id).all()
    ]);
    let positions=[], balls=[];
    try { positions=state?.positions_json?JSON.parse(state.positions_json):[]; } catch {}
    try { balls=state?.balls_json?JSON.parse(state.balls_json):[]; } catch {}
    return json({success:true,match,positions,balls,revision:state?.revision||0,updatedAt:state?.updated_at||null,scores:scores.results||[],events:events.results||[]});
  }

  if (request.method !== "POST") return json({success:false,message:"Method not allowed."},405);
  let body;
  try { body=await request.json(); } catch { return json({success:false,message:"Invalid request body."},400); }
  const action=String(body?.action||"");
  const allowedStatus=["scheduled","live","paused","completed"];
  if (action === "status") {
    if (!allowedStatus.includes(body.status)) return json({success:false,message:"Invalid match status."},400);
    if (admin.role==="house_admin" && !["live","paused"].includes(body.status))
      return json({success:false,message:"House administrators may start or pause their team's match, but cannot schedule or finalize it."},403);
    const winner=body.winnerTeamId==null?null:String(body.winnerTeamId);
    if (winner && ![match.home_team_id,match.away_team_id].includes(winner))
      return json({success:false,message:"Winner must be one of the participating teams."},400);
    await env.atramentum_db.prepare("UPDATE matches SET status=?, winner_team_id=? WHERE id=?")
      .bind(body.status,body.status==="completed"?winner:null,id).run();
    await writeAdminAudit(env,admin.id,"match_status_changed",String(id),JSON.stringify({status:body.status,winnerTeamId:winner}));
    return json({success:true,message:"Match status updated."});
  }
  if (action === "score") {
    const teamId=String(body.teamId||"");
    const score=Number(body.score);
    if (![match.home_team_id,match.away_team_id].includes(teamId) || !Number.isSafeInteger(score) || score<0 || score>9999)
      return json({success:false,message:"Invalid team or score."},400);
    if (admin.role==="house_admin" && teamId!==admin.team_id)
      return json({success:false,message:"You may only change your own team's score."},403);
    await env.atramentum_db.prepare(`
      INSERT INTO match_team_results(match_id,team_id,score)
      VALUES(?,?,?)
      ON CONFLICT(match_id,team_id) DO UPDATE SET score=excluded.score
    `).bind(id,teamId,score).run();
    await env.atramentum_db.prepare(`
      INSERT INTO match_events(match_id,team_id,event_type,points,description)
      VALUES(?,?, 'score_adjustment', ?, ?)
    `).bind(id,teamId,score,"Score set by "+admin.username).run();
    await writeAdminAudit(env,admin.id,"match_score_changed",String(id),JSON.stringify({teamId,score}));
    return json({success:true,message:"Score updated."});
  }
  if (action === "event") {
    const eventType=String(body.eventType||"").trim().slice(0,50);
    const description=String(body.description||"").trim().slice(0,240);
    const points=Number(body.points||0);
    const teamId=body.teamId==null?null:String(body.teamId);
    if (!eventType || !Number.isSafeInteger(points) || points < -999 || points > 999 ||
        (teamId && ![match.home_team_id,match.away_team_id].includes(teamId)))
      return json({success:false,message:"Invalid match event."},400);
    if (admin.role==="house_admin" && teamId && teamId!==admin.team_id)
      return json({success:false,message:"You may only record events for your own team."},403);
    await env.atramentum_db.prepare(`
      INSERT INTO match_events(match_id,team_id,event_type,points,description)
      VALUES(?,?,?,?,?)
    `).bind(id,teamId,eventType,points,description||null).run();
    await writeAdminAudit(env,admin.id,"match_event_recorded",String(id),eventType);
    return json({success:true,message:"Match event recorded."});
  }
  if (action === "positions") {
    if (admin.role==="house_admin") return json({success:false,message:"Only referees and the super administrator may publish the live field state."},403);
    const positions=body.positions, balls=body.balls;
    const validPoint=p=>p&&typeof p==="object"&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))&&Number.isFinite(Number(p.z))&&Math.abs(Number(p.x))<=45&&Number(p.y)>=0&&Number(p.y)<=35&&Math.abs(Number(p.z))<=22;
    if (!Array.isArray(positions)||positions.length>40||!positions.every(validPoint)||
        !Array.isArray(balls)||balls.length>8||!balls.every(validPoint))
      return json({success:false,message:"Invalid live field coordinates."},400);
    const pjson=JSON.stringify(positions.map(p=>({playerId:p.playerId==null?null:Number(p.playerId),teamId:p.teamId==null?null:String(p.teamId),x:Number(p.x),y:Number(p.y),z:Number(p.z)})));
    const bjson=JSON.stringify(balls.map(p=>({kind:String(p.kind||"ball").slice(0,24),x:Number(p.x),y:Number(p.y),z:Number(p.z)})));
    await env.atramentum_db.prepare(`
      INSERT INTO match_live_state(match_id,positions_json,balls_json,revision,updated_by,updated_at)
      VALUES(?,?,?,1,?,CURRENT_TIMESTAMP)
      ON CONFLICT(match_id) DO UPDATE SET positions_json=excluded.positions_json,
        balls_json=excluded.balls_json,revision=match_live_state.revision+1,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    `).bind(id,pjson,bjson,admin.id).run();
    return json({success:true,message:"Live field state published."});
  }
  return json({success:false,message:"Unknown match action."},400);
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

      // ATRAMENTUM_RECOVERY_ROUTE_BUILD_FIX_20261108
      if (path === "/api/admin/recover") {
        return await handleAdminRecovery(request, env);
      }

      if (path === "/api/admin/setup-status" && request.method === "GET") {
        return await handleAdminSetupStatus(env);
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

      if (path === "/api/admin/matches") {
        return await handleAdminMatches(request, env);
      }

      const adminLiveMatch = path.match(/^\/api\/admin\/matches\/(\d+)\/live$/);
      if (adminLiveMatch) {
        return await handleAdminMatchLive(request, env, adminLiveMatch[1]);
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

      const publicLiveMatch = path.match(/^\/api\/matches\/(\d+)\/live$/);
      if (publicLiveMatch && request.method === "GET") {
        return await handlePublicMatchLive(request, env, publicLiveMatch[1]);
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
