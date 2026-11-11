import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(workerSource).toString("base64");
const { default: worker } = await import(moduleUrl);

function createEnv({ loginPlayer = null, sessionPlayer = null } = {}) {
  const state = { insertedSession: null, deletedToken: null, prepareCalls: 0, queries: [] };

  const db = {
    prepare(sql) {
      state.prepareCalls += 1;
      state.queries.push(sql);
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("player_code_hash")) return loginPlayer;
              if (sql.includes("FROM sessions")) return sessionPlayer;
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO sessions")) state.insertedSession = values;
              if (sql.includes("DELETE FROM sessions")) state.deletedToken = values[0];
              return { success: true };
            },
            async all() {
              return { results: [] };
            }
          };
        },
        async all() {
          return { results: [] };
        }
      };
    }
  };

  return { atramentum_db: db, state };
}

test("login rejects a JSON null payload with 400 instead of throwing", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null"
    }),
    env
  );

  assert.equal(response.status, 400);
  assert.equal(env.state.prepareCalls, 0);
});

test("login rejects an empty player code", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }),
    env
  );

  assert.equal(response.status, 400);
  assert.equal(env.state.prepareCalls, 0);
});

test("successful login creates a session and returns compatible token fields", async () => {
  const env = createEnv({
    loginPlayer: {
      id: 1,
      name: "Enzo",
      team_id: "slytherin",
      player_number: 1,
      position: "Chaser"
    }
  });

  const response = await worker.fetch(
    new Request("https://atramentum.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ENZO001" })
    }),
    env
  );

  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.session, data.token);
  assert.equal(data.playerId, 1);
  assert.match(data.token, /^[a-f0-9]{64}$/);
  assert.equal(env.state.insertedSession[0], 1);
  assert.equal(env.state.insertedSession[1], data.token);
  assert.ok(env.state.insertedSession[2]);
});

test("profile returns the authenticated player's flat and nested data", async () => {
  const env = createEnv({
    sessionPlayer: {
      id: 1,
      name: "Enzo",
      team_id: "slytherin",
      player_number: 1,
      position: "Chaser",
      active: 1,
      team_name: "اسلیترین",
      team_emblem: "🐍",
      token: "valid-session"
    }
  });

  const response = await worker.fetch(
    new Request("https://atramentum.test/api/profile", {
      headers: { Authorization: "Bearer valid-session" }
    }),
    env
  );

  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.playerId, 1);
  assert.equal(data.player.teamId, "slytherin");
  assert.equal(data.player.teamEmblem, "🐍");
});

test("logout revokes the presented session token", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/logout", {
      method: "POST",
      headers: { Authorization: "Bearer session-to-revoke" }
    }),
    env
  );

  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(env.state.deletedToken, "session-to-revoke");
});


test("leaderboard ranks houses by cumulative Quidditch match points", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/leaderboard"),
    env
  );

  const data = await response.json();
  const query = env.state.queries.join("\\n");
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.ok(query.includes("SUM(score) AS points"));
  assert.ok(query.includes("FROM match_team_results"));
  assert.ok(query.includes("ORDER BY points DESC"));
  assert.ok(query.includes("COUNT(*) AS player_count"));
});

function createAdminMatchEnv({ admin, match = null, activeCount = 0 } = {}) {
  const state = { updatedMatch: null, batches: [], queries: [] };
  const db = {
    prepare(sql) {
      state.queries.push(sql);
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM admin_sessions")) return admin || null;
              if (sql.includes("COUNT(*) AS total") && sql.includes("FROM matches")) return { total: activeCount };
              if (sql.includes("FROM matches m") && sql.includes("WHERE m.id = ?")) return match;
              if (sql.includes("SELECT started_at,elapsed_seconds,clock_running FROM match_game_state")) return null;
              return null;
            },
            async all() {
              if (sql.includes("SELECT team_id,score FROM match_team_results")) return { results: [] };
              return { results: [] };
            },
            async run() {
              if (sql.includes("UPDATE matches SET status=?")) state.updatedMatch = values;
              return { success: true, meta: { changes: 1 } };
            }
          };
        }
      };
    },
    async batch(statements) {
      state.batches.push(statements);
      return [];
    }
  };
  return { atramentum_db: db, state };
}

test("house administrator can finalize a match involving their own house", async () => {
  const env = createAdminMatchEnv({
    admin: { id: 7, username: "serpentis", role: "house_admin", team_id: "slytherin" },
    match: { id: 12, home_team_id: "slytherin", away_team_id: "gryffindor", status: "live" }
  });
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/admin/matches/12/live", {
      method: "POST",
      headers: { Authorization: "Bearer valid-admin", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", status: "completed" })
    }),
    env
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(env.state.updatedMatch[0], "completed");
  assert.equal(env.state.updatedMatch[2], 12);
});

test("house administrator cannot finalize a match outside their house scope", async () => {
  const env = createAdminMatchEnv({
    admin: { id: 7, username: "serpentis", role: "house_admin", team_id: "slytherin" },
    match: { id: 13, home_team_id: "hufflepuff", away_team_id: "ravenclaw", status: "live" }
  });
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/admin/matches/13/live", {
      method: "POST",
      headers: { Authorization: "Bearer valid-admin", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", status: "completed" })
    }),
    env
  );
  assert.equal(response.status, 403);
  assert.equal(env.state.updatedMatch, null);
});

test("bulk finalization updates the central database for every role scope", async () => {
  const env = createAdminMatchEnv({
    admin: { id: 1, username: "ACAME_IX47", role: "super_admin", team_id: null },
    activeCount: 4
  });
  const response = await worker.fetch(
    new Request("https://atramentum.test/api/admin/matches/finish-active", {
      method: "POST",
      headers: { Authorization: "Bearer valid-admin", "Content-Type": "application/json" },
      body: "{}"
    }),
    env
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.completedCount, 4);
  assert.equal(env.state.batches.length, 1);
  assert.equal(env.state.batches[0].length, 3);
  assert.ok(env.state.queries.some(sql => sql.includes("status IN ('live','paused')")));
});

test("public match feed excludes completed fixtures", async () => {
  const env = createEnv();
  const response = await worker.fetch(new Request("https://atramentum.test/api/matches"), env);
  const data = await response.json();
  const query = env.state.queries.join("\\n");
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.ok(query.includes("WHERE m.status IN ('scheduled','live','paused')"));
});

test("profile returns completed-match statistics and history from the database", async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM sessions")) return {
                id: 1, name: "Enzo", team_id: "slytherin", player_number: 1,
                position: "Chaser", active: 1, team_name: "اسلیترین",
                team_emblem: "🐍", token: "valid-player-token"
              };
              if (sql.includes("COUNT(DISTINCT m.id)")) return {
                matches_played: 3, matches_won: 2, total_points: 40,
                special_actions: 5, goals: 4, assists: 2, saves: 1, catches: 2
              };
              return null;
            },
            async all() {
              if (sql.includes("FROM player_match_stats pms") && sql.includes("home_team_name")) {
                return { results: [{
                  match_id: 9, home_team_name: "اسلیترین", away_team_name: "گریفیندور",
                  home_score: 40, away_score: 20, goals: 2, assists: 1,
                  saves: 0, catches: 1, points: 20
                }] };
              }
              return { results: [] };
            },
            async run() { return { success: true }; }
          };
        }
      };
    }
  };
  const env = { atramentum_db: db, ASSETS: { fetch: async () => new Response("asset") } };
  const response = await worker.fetch(new Request("https://atramentum.test/api/profile", {
    headers: { Authorization: "Bearer valid-player-token" }
  }), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.stats.matchesPlayed, 3);
  assert.equal(data.stats.matchesWon, 2);
  assert.equal(data.stats.totalPoints, 40);
  assert.equal(data.stats.specialActions, 5);
  assert.equal(data.history.length, 1);
  assert.ok(queries.some(sql => sql.includes("m.status = 'completed'")));
});

test("stadium includes an actual 2D canvas view connected to the 3D match scene", async () => {
  const html = await readFile(new URL("../public/stadium.html", import.meta.url), "utf8");
  assert.match(html, /<canvas id="arena2d"/);
  assert.match(html, /data-view-mode="2d"/);
  assert.match(html, /data-view-mode="3d"/);
  assert.match(html, /function drawTacticalMap\(/);
  assert.match(html, /players\.filter\(p=>p\.visible\)/);
  assert.match(html, /function setViewMode\(/);
});

