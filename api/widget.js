// lab.philipbaker.us/api/widget — the share page behind /widget-maker/w/<id>
//
// GET  ?id=<favorite id> → an HTML page for one saved widget, with og/twitter
//        tags so a link pasted into a social post unfurls into a real card.
//        vercel.json rewrites /widget-maker/w/:id here. The widget itself is
//        fetched from its favorites blob client-side and run in a sandboxed
//        iframe — generated code never executes on the lab origin.
// POST {id, snapshot} → store the social-card image for that widget. The
//        browser photographs the running widget (a canvas readback), fits it
//        to 1200×630 and sends a JPEG data URL. First one in wins, JPEG magic
//        bytes required, capped in size, and the id must already be a saved
//        favorite — so this can't be used to host arbitrary images, and a
//        card can't be swapped out from under a widget after the fact.
//
// Only favorites are shareable: they're the one persisted, signature-checked
// set of widgets, so a share link can only ever point at HTML this server wrote.

import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { findFavorite, SHOTS_PREFIX, ID_RE } from "../lib/favorites.js";
import { originAllowed, clientIp, rateLimiter } from "../lib/guard.js";

const SITE = "https://lab.philipbaker.us";
const FALLBACK_CARD = `${SITE}/widget-maker/img/og.png`;
const MAX_SNAPSHOT_BYTES = 600_000;
const rateLimited = rateLimiter({ windowMs: 60_000, max: 10 });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Cards live at shots/<id>.<contenthash>.jpg. The hash in the name means a
// card can be replaced later (moderation, a better capture) without the CDN
// serving the old bytes from the old URL for the rest of its max-age.
async function shotFor(id) {
  const { blobs } = await list({ prefix: `${SHOTS_PREFIX}${id}.`, limit: 10 });
  if (!blobs.length) return null;
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return blobs[0].url;
}

function shell({ title, head = "", body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${head}
<style>
  :root{--bg:#1a0e05;--ink:#fdf3ea;--dim:#c9b39d;--gold:#ffd24a;--card:#241408;--line:#3c2612}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#000;color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  body{display:flex;flex-direction:column}
  .stage{flex:1;position:relative;min-height:0;background:#000}
  .stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--dim);text-align:center;padding:24px}
  .wait strong{display:block;color:var(--ink);font-size:17px;margin-bottom:6px}
  .bar{display:flex;align-items:center;gap:14px;padding:9px 14px;background:var(--card);border-top:1px solid var(--line);flex:0 0 auto}
  .bar .t{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar .t small{display:block;font-weight:400;color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis}
  .bar a{color:var(--gold);text-decoration:none;white-space:nowrap;font-size:13px}
  .bar a.btn{padding:6px 12px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:#2a1709}
  .bar a.btn:hover{border-color:#5a3a19}
  .bar a.make{font-weight:600}
  @media (max-width:560px){.bar .t small{display:none}.bar a.home{display:none}}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function sharePage({ id, title, prompt, blobUrl, image }) {
  const url = `${SITE}/widget-maker/w/${id}`;
  const desc = prompt
    ? `“${prompt}” — built on request by the Widget Maker at lab.philipbaker.us. Runs live; make your own.`
    : "Built on request by the Widget Maker at lab.philipbaker.us. Runs live; make your own.";
  const card = image || FALLBACK_CARD;
  const head = `<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Widget Maker · lab.philipbaker.us">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(card)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(card)}">`;

  const body = `<div class="stage" id="stage">
  <div class="wait" id="wait"><div><strong>${esc(title)}</strong>Loading the widget…</div></div>
</div>
<div class="bar">
  <div class="t">${esc(title)}<small>${esc(prompt || "")}</small></div>
  <a class="btn" href="/widget-maker/#w=${esc(id)}">Remix it</a>
  <a class="make" href="/widget-maker/">Make your own →</a>
  <a class="home" href="/">lab.philipbaker.us</a>
</div>
<script>
(() => {
  "use strict";
  const src = ${JSON.stringify(blobUrl)};
  const wait = document.getElementById("wait");
  fetch(src)
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((data) => {
      if (typeof data.html !== "string") throw new Error("no html");
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-popups");
      frame.setAttribute("allow", "autoplay; fullscreen; gamepad");
      frame.title = ${JSON.stringify(title)};
      frame.srcdoc = data.html;
      document.getElementById("stage").replaceChildren(frame);
    })
    .catch(() => {
      wait.innerHTML = "<div><strong>Couldn't load this widget</strong>It may have been taken down. <a href='/widget-maker/' style='color:#ffd24a'>Make your own →</a></div>";
    });
})();
</script>`;

  return shell({ title: `${title} · Widget Maker`, head, body });
}

function missingPage() {
  return shell({
    title: "No widget here · Widget Maker",
    head: `<meta name="robots" content="noindex">`,
    body: `<div class="stage"><div class="wait"><div><strong>No widget here</strong>
      That link doesn't point at a saved widget — it may have been taken down.<br>
      <a href="/widget-maker/" style="color:#ffd24a">Make your own →</a></div></div></div>`,
  });
}

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "No Blob store is connected to this project." });
  }

  // ── The page ───────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const id = String(req.query?.id || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (!ID_RE.test(id)) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(404).send(missingPage());
    }
    try {
      const [fav, image] = await Promise.all([findFavorite(id), shotFor(id)]);
      if (!fav) {
        res.setHeader("Cache-Control", "public, max-age=60");
        return res.status(404).send(missingPage());
      }
      // A favorite never changes once saved, and its card is write-once, so the
      // CDN can hold this; stale-while-revalidate covers the card arriving a
      // beat after the page was first fetched.
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=86400");
      return res.status(200).send(
        sharePage({ id, title: fav.title, prompt: fav.prompt, blobUrl: fav.url, image }),
      );
    } catch (err) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(500).send(shell({
        title: "Widget Maker",
        body: `<div class="stage"><div class="wait"><div><strong>Something went wrong</strong>${esc(err?.message || "")}</div></div></div>`,
      }));
    }
  }

  // ── The social card ────────────────────────────────────────────────────────
  if (req.method === "POST") {
    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Not allowed from this origin." });
    }
    if (rateLimited(clientIp(req))) {
      return res.status(429).json({ error: "Easy — too many in a minute." });
    }
    const { id, snapshot } = req.body || {};
    if (!ID_RE.test(String(id))) {
      return res.status(400).json({ error: "Bad widget id." });
    }
    const m = typeof snapshot === "string" && snapshot.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) {
      return res.status(400).json({ error: "Send a JPEG data URL as `snapshot`." });
    }
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 1_000 || buf.length > MAX_SNAPSHOT_BYTES) {
      return res.status(400).json({ error: "Snapshot is the wrong size." });
    }
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) {
      return res.status(400).json({ error: "That isn't a JPEG." });
    }
    try {
      const fav = await findFavorite(id);
      if (!fav) {
        return res.status(404).json({ error: "Save the widget first — only favorites get a page." });
      }
      const existing = await shotFor(id);
      if (existing) {
        return res.status(200).json({ ok: true, already: true, image: existing });
      }
      const digest = createHash("sha256").update(buf).digest("hex").slice(0, 8);
      const blob = await put(`${SHOTS_PREFIX}${id}.${digest}.jpg`, buf, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        cacheControlMaxAge: 31536000,
      });
      return res.status(201).json({ ok: true, image: blob.url });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Couldn't save the card." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Use GET or POST." });
}
