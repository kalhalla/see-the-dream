/* ============================================================
   functions/render.js  —  Cloudflare Pages Function
   Served automatically at:  /render   (POST)

   Generates a concept render via the OpenAI Images API, server-side,
   using a secret API key that never reaches the browser.

   SET THESE in Cloudflare → your Pages project → Settings →
   Environment variables (mark OPENAI_API_KEY as a *Secret*):
     OPENAI_API_KEY   (required)  your platform.openai.com API key
     IMAGE_MODEL      (optional)  default "gpt-image-1"  ← set to the
                                  current cheap model listed on
                                  platform.openai.com (gpt-image-1
                                  is being retired in Oct 2026)
     IMAGE_QUALITY    (optional)  "low" | "medium" | "high"  (default low)

   Body:  { "prompt": "..." }
   Returns: { ok:true, image:"data:image/png;base64,..." }
   ============================================================ */

export async function onRequest(context) {
  const { request, env } = context;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405, cors);

  if (!env.OPENAI_API_KEY) {
    // No key yet → tell the page to keep its placeholder, don't error loudly.
    return json({ ok: false, error: "no-key" }, 200, cors);
  }

  let prompt = "";
  try { ({ prompt } = await request.json()); } catch {}
  if (!prompt) return json({ ok: false, error: "missing prompt" }, 400, cors);

  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.IMAGE_MODEL || "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality: env.IMAGE_QUALITY || "low",
        n: 1,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || ("api " + r.status));
    const b64 = j.data && j.data[0] && j.data[0].b64_json;
    if (!b64) throw new Error("no image returned");
    return json({ ok: true, image: "data:image/png;base64," + b64 }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: e.message }, 502, cors);
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}
