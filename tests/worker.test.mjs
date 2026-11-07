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
  const state = { insertedSession: null, deletedToken: null, prepareCalls: 0 };

  const db = {
    prepare(sql) {
      state.prepareCalls += 1;
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
