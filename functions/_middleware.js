// Server-side access gate for every HTML page.
// The login entry points remain reachable; all other pages require a live player
// or administrator session verified by the Worker (not merely a browser flag).
function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map(part => part.trim()).find(part => part.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

async function validSession(env, request, endpoint, token) {
  if (!token || !env.ATRAMENTUM_API) return false;
  try {
    const headers = new Headers({ Authorization: "Bearer " + token, "Cache-Control": "no-store" });
    const check = new Request(new URL(endpoint, request.url), { method: "GET", headers });
    const response = await env.ATRAMENTUM_API.fetch(check);
    return response.ok;
  } catch {
    return false;
  }
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // API requests are handled by their own authenticated Worker routes.
  if (path.startsWith("/api/")) return next();

  // These are authentication/recovery entry points, not application sections.
  if (path === "/" || path === "/index.html" || path === "/admin.html" || path === "/recover-admin.html") {
    return next();
  }

  // Protect browser navigations to HTML pages. Static assets are not application pages.
  const acceptsHtml = (request.headers.get("Accept") || "").includes("text/html");
  if (!acceptsHtml && !path.endsWith(".html")) return next();

  const playerToken = readCookie(request, "atr_player_session");
  const adminToken = readCookie(request, "atr_admin_session");
  const [playerOk, adminOk] = await Promise.all([
    validSession(env, request, "/api/profile", playerToken),
    validSession(env, request, "/api/admin/me", adminToken)
  ]);

  if (playerOk || adminOk) return next();

  const destination = path + url.search;
  const loginUrl = new URL("/index.html", url);
  loginUrl.searchParams.set("next", destination);
  const headers = new Headers({ Location: loginUrl.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", "atr_player_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "atr_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers });
}
