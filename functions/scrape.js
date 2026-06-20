/* ============================================================
   functions/scrape.js  —  Cloudflare Pages Function
   Served automatically at:  /scrape
   Usage:  GET /scrape?url=<listing-url>  ->  JSON property data

   This runs SERVER-SIDE on Cloudflare's edge, so it can fetch the
   listing without the CORS limits that block a browser. It is tuned
   for terrenos.es listings. Other portals (Idealista, Kyero, Fotocasa,
   Rightmove-Overseas) each have different markup and need their own
   parser branch — add them in parse() as you go.
   ============================================================ */

export async function onRequest(context) {
  const { request } = context;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=600",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  const target = new URL(request.url).searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return json({ ok: false, error: "Provide a valid ?url=" }, 400, cors);
  }

  let html;
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "en,es;q=0.8",
      },
    });
    if (!res.ok) throw new Error("upstream " + res.status);
    html = await res.text();
  } catch (e) {
    return json({ ok: false, error: "Could not fetch listing: " + e.message }, 502, cors);
  }

  return json(parse(html, target), 200, cors);
}

/* ---------- helpers ---------- */
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}
function decode(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
function meta(html, prop) {
  const re = new RegExp(
    '<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)["\']',
    "i"
  );
  const m = html.match(re);
  return m ? decode(m[1].trim()) : "";
}
function num(s) {
  const d = (s || "").replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : null;
}
function titleCase(s) {
  return (s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- parser (terrenos.es) ---------- */
function parse(html, url) {
  let path = "";
  try { path = new URL(url).pathname; } catch {}
  const seg = path.split("/").filter(Boolean);

  const ogDesc = meta(html, "og:description");
  const ogImg = meta(html, "og:image");
  const ogTitle = meta(html, "og:title");

  // reference
  let ref = (path.match(/(\d{4,})\/?$/) || [])[1] || "";
  const refM = html.match(/Ref:?\s*([A-Z]{2}\d+)/i);
  if (refM) ref = refM[1].toUpperCase();
  else if (ref) ref = "TR" + ref;

  // land classification (from the URL slug — terrenos encodes it there)
  let landType = "";
  if (/undevelop|no-?urban|non-?developable/i.test(path)) landType = "Non-developable";
  else if (/developable/i.test(path)) landType = "Developable";
  else if (/urban/i.test(path)) landType = "Urban";

  // town
  let location = "";
  const iSale = seg.findIndex((s) => /sale|venta/i.test(s));
  if (iSale >= 0 && seg[iSale + 1]) location = titleCase(seg[iSale + 1].replace(/-/g, " "));

  // price (prefer the clean og:description sentence)
  let price = null;
  const pM = ogDesc.match(/from\s*([\d.\s,]+)\s*euros/i) || ogDesc.match(/([\d.\s,]+)\s*euros/i);
  if (pM) price = num(pM[1]);
  if (!price) { const eM = html.match(/([\d][\d.\s]{3,})\s*€/); if (eM) price = num(eM[1]); }

  // plot (og:description: "surface area of X m2")
  let plotArea = null;
  const plM = ogDesc.match(/surface area of\s*([\d.\s,]+)\s*m2/i);
  if (plM) plotArea = num(plM[1]);

  // built area
  let buildArea = null;
  const baM = html.match(/Building area[\s\S]{0,90}?(\d[\d.,]*)\s*m²/i) || html.match(/(\d{2,3})\s*m²/);
  if (baM) buildArea = num(baM[1]);

  // bathrooms
  let bathrooms = null;
  const bthM = html.match(/Bathrooms[\s\S]{0,90}?(\d+)/i);
  if (bthM) bathrooms = parseInt(bthM[1], 10);

  // type
  let type = "";
  const tyM = (ogTitle || "").match(/Detached (?:house|villa)|Villa|Country house|Rustic estate|Village house|Finca/i);
  if (tyM) type = titleCase(tyM[0].toLowerCase());

  // utilities
  const lc = html.toLowerCase();
  const utilities = [];
  if (/water/i.test(lc)) utilities.push("Water");
  if (/electricity|solar/i.test(lc)) utilities.push("Electricity");
  if (/sewerage/i.test(lc)) utilities.push("Sewerage");
  if (/solar/i.test(lc)) utilities.push("Solar");
  if (/water well|aljibe/i.test(lc)) utilities.push("Well");

  // access
  let access = /paved road|asfalt/i.test(lc) ? "Paved road" : "";

  // photos
  const photos = Array.from(
    new Set(html.match(/https:\/\/cdn\.terrenos\.es\/photo\/[^\s"')]+\.jpg/gi) || [])
  ).filter((p) => !/_small/i.test(p));
  const hero = ogImg || photos[0] || "";

  // coordinates (from the embedded Google Earth / Maps links)
  let coords = null;
  const cM = html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (cM) coords = { lat: parseFloat(cM[1]), lng: parseFloat(cM[2]) };

  // honest auto-flags (cheap, keyword-based — a hint, not legal advice)
  const flags = {
    nonDevelopable: landType === "Non-developable" || /no-?urbaniz|non developable|undevelopable/i.test(lc),
    noCedula: /no dispone de c[eé]dula|sin c[eé]dula|no c[eé]dula/i.test(lc),
    unregistered: /no consta[\s\S]{0,40}inscrit|not registered|no inscrit/i.test(lc),
    pre1984: /anterior a 1984|pre-?1984|antes de 1984/i.test(lc),
  };

  return {
    ok: true,
    sourceUrl: url,
    ref,
    title: ogTitle || (type && location ? type + " in " + location : "Property"),
    location,
    price,
    plotArea,
    buildArea,
    bathrooms,
    type,
    landType,
    access,
    utilities,
    photos,
    hero,
    coords,
    flags,
    description: ogDesc,
  };
}
