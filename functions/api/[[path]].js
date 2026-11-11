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

  return env.ATRAMENTUM_API.fetch(request);
}
