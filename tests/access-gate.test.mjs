import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as accessGate } from "../functions/_middleware.js";
import { onRequest as apiBridge } from "../functions/api/[[path]].js";

function envFor(valid = {}) {
  const calls = [];
  return {
    calls,
    ATRAMENTUM_API: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
        calls.push({ path, token });
        return new Response("{}", { status: valid[path]?.includes(token) ? 200 : 401 });
      }
    }
  };
}

function htmlRequest(path, cookie = "") {
  return new Request("https://atramentum.test" + path, {
    headers: { Accept: "text/html", ...(cookie ? { Cookie: cookie } : {}) }
  });
}

test("private HTML pages redirect to the player code gateway without a session", async () => {
  const env = envFor();
  const response = await accessGate({ request: htmlRequest("/academy.html"), env, next: async () => new Response("page") });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /\/index\.html\?next=%2Facademy\.html/);
  assert.match(response.headers.get("Set-Cookie"), /atr_player_session=;/);
  assert.equal(env.calls.length, 0);
});

test("a verified player session can open private pages", async () => {
  const env = envFor({ "/api/profile": ["valid-player"] });
  const response = await accessGate({ request: htmlRequest("/stadium.html", "atr_player_session=valid-player"), env, next: async () => new Response("page") });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "page");
  assert.ok(env.calls.some(call => call.path === "/api/profile" && call.token === "valid-player"));
});

test("a verified administrator session can open private pages", async () => {
  const env = envFor({ "/api/admin/me": ["valid-admin"] });
  const response = await accessGate({ request: htmlRequest("/admin-tools.html", "atr_admin_session=valid-admin"), env, next: async () => new Response("page") });
  assert.equal(response.status, 200);
  assert.ok(env.calls.some(call => call.path === "/api/admin/me" && call.token === "valid-admin"));
});

test("invalid or expired cookies never unlock a private page", async () => {
  const env = envFor();
  const response = await accessGate({ request: htmlRequest("/profile.html", "atr_player_session=expired"), env, next: async () => new Response("page") });
  assert.equal(response.status, 302);
});

test("login and recovery gateways remain reachable before authentication", async () => {
  const env = envFor();
  for (const path of ["/", "/index.html", "/admin.html", "/recover-admin.html"]) {
    const response = await accessGate({ request: htmlRequest(path), env, next: async () => new Response("gateway") });
    assert.equal(response.status, 200, path);
  }
  assert.equal(env.calls.length, 0);
});

test("API requests pass through to their dedicated API handlers", async () => {
  const env = envFor();
  const request = new Request("https://atramentum.test/api/login", { method: "POST" });
  const response = await accessGate({ request, env, next: async () => new Response("api") });
  assert.equal(await response.text(), "api");
  assert.equal(env.calls.length, 0);
});

test("player login creates an HttpOnly access cookie", async () => {
  const response = await apiBridge({
    request: new Request("https://atramentum.test/api/login", { method: "POST" }),
    env: { ATRAMENTUM_API: { fetch: async () => new Response(JSON.stringify({ success: true, session: "new-player-token" }), { headers: { "Content-Type": "application/json" } }) } }
  });
  assert.match(response.headers.get("Set-Cookie"), /atr_player_session=new-player-token/);
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
});

test("administrator login creates a separate HttpOnly access cookie", async () => {
  const response = await apiBridge({
    request: new Request("https://atramentum.test/api/admin/login", { method: "POST" }),
    env: { ATRAMENTUM_API: { fetch: async () => new Response(JSON.stringify({ success: true, token: "new-admin-token" }), { headers: { "Content-Type": "application/json" } }) } }
  });
  assert.match(response.headers.get("Set-Cookie"), /atr_admin_session=new-admin-token/);
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
});

test("player logout clears its access cookie", async () => {
  const response = await apiBridge({
    request: new Request("https://atramentum.test/api/logout", { method: "POST" }),
    env: { ATRAMENTUM_API: { fetch: async () => new Response(JSON.stringify({ success: true })) } }
  });
  assert.match(response.headers.get("Set-Cookie"), /atr_player_session=;/);
});
