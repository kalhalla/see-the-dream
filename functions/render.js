/* ============================================================
   functions/render.js  —  Cloudflare Pages Function  (POST /render)

   Generates a concept render via the OpenAI Images API, server-side,
   with the API key kept as a secret env var (never in the browser).

   Two modes, chosen automatically:
     • body has { prompt, image }  -> image-to-image via /v1/images/edits
       (transforms the user's uploaded photo — keeps the real building)
     • body has { prompt } only    -> text-to-image via /v1/images/generations

   Cloudflare env vars (Pages → Settings → Environment variables):
     OPENAI_API_KEY  (Secret, required)
     IMAGE_MODEL     (optional, default "gpt-image-2")
     IMAGE_QUALITY   (optional, "low" | "medium" | "high", default low)

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
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: "no-key" }, 200, cors);

  let prompt = "", image = null;
  try { ({ prompt, image } = await request.json()); } catch {}
  if (!prompt) return json({ ok: false, error: "missing prompt" }, 400, cors);

  try {
    const b64 = image ? await editImage(env, prompt, image) : await genImage(env, prompt);
    return json({ ok: true, image: "data:image/png;base64," + b64 }, 200, cors);
  } catch (e) {
    // if an edit failed, fall back to a text render so the user still sees something
    try {
      const b64 = await genImage(env, prompt);
      return json({ ok: true, image: "data:image/png;base64," + b64, fallback: true }, 200, cors);
    } catch (e2) {
      return json({ ok: false, error: e.message }, 502, cors);
    }
  }
}

/* ---------- OpenAI calls ---------- */
async function genImage(env, prompt) {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.IMAGE_MODEL || "gpt-image-2",
      prompt,
      size: "1024x1024",
      quality: env.IMAGE_QUALITY || "low",
      n: 1,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || ("generations " + r.status));
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error("no image returned");
  return b64;
}

async function editImage(env, prompt, dataUrl) {
  const bytes = dataUrlToBytes(dataUrl);
  const fd = new FormData();
  fd.append("model", env.IMAGE_MODEL || "gpt-image-2");
  fd.append("prompt", prompt);
  fd.append("size", "1024x1024");
  fd.append("quality", env.IMAGE_QUALITY || "low");
  fd.append("n", "1");
  fd.append("image", new Blob([bytes], { type: "image/png" }), "image.png");

  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.OPENAI_API_KEY }, // no Content-Type: fetch sets the multipart boundary
    body: fd,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || ("edits " + r.status));
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error("no image returned");
  return b64;
}

/* ---------- helpers ---------- */
function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl.split(",")[1]) || "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}
