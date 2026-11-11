// ATRAMENTUM PAGES → WORKER API BRIDGE
// Routes /api/* requests through the Service Binding configured as ATRAMENTUM_API.

export async function onRequest({ request, env }) {
  if (!env.ATRAMENTUM_API) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Atramentum API service binding is not configured."
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  const response = await env.ATRAMENTUM_API.fetch(request);
  const path = new URL(request.url).pathname;
  let cookie = null;

  if (response.ok && request.method === "POST" && (path === "/api/login" || path === "/api/admin/login")) {
    try {
      const data = await response.clone().json();
      if (data?.success) {
        if (path === "/api/login" && data.session) {
          cookie = "atr_player_session=" + encodeURIComponent(data.session) + "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";
        } else if (path === "/api/admin/login" && data.token) {
          cookie = "atr_admin_session=" + encodeURIComponent(data.token) + "; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax";
        }
      }
    } catch {
      // Preserve the Worker response if it is not JSON.
    }
  }

  const clearPlayer = path === "/api/logout" && request.method === "POST";
  const clearAdmin = path === "/api/admin/logout" && request.method === "POST";
  if (!cookie && !clearPlayer && !clearAdmin) return response;

  const headers = new Headers(response.headers);
  if (cookie) headers.append("Set-Cookie", cookie);
  if (clearPlayer) headers.append("Set-Cookie", "atr_player_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  if (clearAdmin) headers.append("Set-Cookie", "atr_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
