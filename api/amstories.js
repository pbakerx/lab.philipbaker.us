// /api/amstories — the "Were You There?" wall at the bottom of /90s-web-ackerman-mcqueen.
// Philip, Sep 25 2026: "a call to action for folks to tell their story or add a photo. Make it public."
//
//   GET                                   -> every story on the page, newest first: name, role, text, photo, date
//   POST {name, role, text, photo, w, h}  -> post one. It is public at once; Philip is mailed a copy with a
//                                            signed link that takes it off the page. The reply carries the
//                                            poster's own key, which their browser keeps to remove it later.
//   GET  ?op=hide&id=&k=&hide=1|0         -> Philip's link: off the page, or back on (a marker; nothing is deleted)
//   POST ?op=remove {id, k}               -> the poster removes their own story, photo and all, for good
//
// Photos arrive as JPEG data URLs the page has already shrunk (1600px at most) and re-encoded in the
// browser, which also drops the camera's metadata. The server takes JPEG bytes only (checked, not
// trusted), stores them as image/jpeg under a random suffix, and never serves anything else.

import { put, del } from "@vercel/blob";
import { originAllowed, clientIp, rateLimiter } from "../lib/guard.js";
import {
  ROOT, STORIES, PHOTOS, HIDDEN, PAGE, MAX_WALL, ID_RE, newId, idTime,
  hideOk, hideLink, ownKey, ownOk, line, prose, listAll, mailReady, sendMail,
} from "../lib/amstories.js";

const JSON_PUT = { access: "public", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 31536000 };
const postLimited = rateLimiter({ windowMs: 10 * 60_000, max: 4 });
const MAX_PHOTO = 2_600_000;   // bytes; the page sends ~150-600 KB, and the body limit is 4.5 MB of base64

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const page = (res, code, title, html) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  return res.status(code).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#000;color:#e8e8e8;font:17px/1.6 Georgia,serif;text-align:center"><div style="padding:2em;max-width:32em"><h1 style="font:400 14px Verdana,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#5fb3b3">${esc(title)}</h1><p>${html}</p><p><a href="${PAGE}#stories" style="color:#5fb3b3">Back to the page</a></p></div>`);
};
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

async function shelf() {
  const all = await listAll(ROOT), hidden = new Set(), stories = [];
  for (const x of all) {
    let m;
    if ((m = /^amstories\/_hidden\/([a-z0-9]+)\.json$/.exec(x.pathname))) hidden.add(m[1]);
    else if ((m = /^amstories\/s\/([a-z0-9]+)\.json$/.exec(x.pathname))) stories.push({ id: m[1], url: x.url });
  }
  return { all, hidden, shown: stories.filter((s) => !hidden.has(s.id)).sort((a, b) => idTime(b.id) - idTime(a.id)) };
}
const pub = (j) => ({ id: j.id, name: j.name, role: j.role || "", text: j.text || "", photo: j.photo || null, when: j.when });

export default async function handler(req, res) {
  if (!originAllowed(req)) return res.status(403).json({ error: "Not allowed from this origin." });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: "No Blob store is connected." });
  const op = String(req.query?.op || "");
  try {
    // the wall, for everybody
    if (req.method === "GET" && op === "") {
      const { shown } = await shelf();
      const items = (await Promise.all(shown.slice(0, 200).map((s) => fetch(s.url).then((r) => (r.ok ? r.json() : null)).catch(() => null))))
        .filter((j) => j && ID_RE.test(String(j.id)) && j.name).map(pub);
      res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
      return res.status(200).json({ items, total: items.length });
    }

    // Philip's link from the email: off the page, or back on
    if (req.method === "GET" && op === "hide") {
      const id = String(req.query?.id || ""), hide = String(req.query?.hide || "1") !== "0";
      if (!hideOk(id, String(req.query?.k || ""))) return page(res, 403, "am.com stories", "That link is not one of ours.");
      const path = `${HIDDEN}${id}.json`, there = (await listAll(path)).length > 0;
      if (hide && !there) await put(path, JSON.stringify({ v: 1, when: new Date().toISOString() }), JSON_PUT);
      else if (!hide && there) await del(path);
      return page(res, 200, "am.com stories", hide
        ? `That story is off the page. <a href="${hideLink(id, false)}" style="color:#5fb3b3">Put it back</a>`
        : `That story is back on the page. <a href="${hideLink(id, true)}" style="color:#5fb3b3">Take it off again</a>`);
    }

    const b = req.body && typeof req.body === "object" ? req.body : {};

    // the poster takes their own story down, photo and all
    if (req.method === "POST" && op === "remove") {
      const id = String(b.id || "");
      if (!ownOk(id, String(b.k || ""))) return res.status(403).json({ error: "That isn't yours to remove." });
      const gone = [...await listAll(`${STORIES}${id}.`), ...await listAll(`${PHOTOS}${id}`)].map((x) => x.pathname);
      if (gone.length) await del(gone);
      return res.status(200).json({ ok: true, removed: gone.length });
    }

    // a new story
    if (req.method === "POST" && op === "") {
      if (b.website) return res.status(201).json({ ok: true });                 // the honeypot: thank the bot, keep nothing
      if (postLimited(clientIp(req))) return res.status(429).json({ error: "Easy. Try again in a few minutes." });
      const name = line(b.name, 60), role = line(b.role, 80), text = prose(b.text, 2000);
      if (!name) return res.status(400).json({ error: "Your name, please." });
      let bytes = null;
      if (b.photo) {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
        if (!m) return res.status(400).json({ error: "The photo didn't come through as a JPEG." });
        bytes = Buffer.from(m[1], "base64");
        if (bytes.length < 800 || bytes.length > MAX_PHOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
          return res.status(400).json({ error: "That photo didn't come through. Try another?" });
        }
      }
      if (!text && !bytes) return res.status(400).json({ error: "A story, a photo, or both." });
      const { shown } = await shelf();
      if (shown.length >= MAX_WALL) return res.status(503).json({ error: "The wall is full for now." });

      const id = newId(), when = new Date().toISOString();
      let photo = null;
      if (bytes) {
        const r = await put(`${PHOTOS}${id}.jpg`, bytes, { access: "public", contentType: "image/jpeg", addRandomSuffix: true, cacheControlMaxAge: 3600 });
        photo = { url: r.url, w: int(b.w, 1, 4000), h: int(b.h, 1, 4000) };
      }
      const story = { v: 1, id, name, role, text, photo, when };
      await put(`${STORIES}${id}.json`, JSON.stringify(story), JSON_PUT);

      if (mailReady()) {
        await sendMail(`am.com: a story from ${name}`, [
          `${name}${role ? " - " + role : ""}`, "",
          text || "(no words, just a photo)",
          photo ? `\nPhoto: ${photo.url}` : "",
          `\nIt is on the page now: ${PAGE}#stories`,
          `Take it off the page: ${hideLink(id, true)}`,
        ].join("\n"));
      }
      return res.status(201).json({ ok: true, item: pub(story), key: ownKey(id) });
    }

    return res.status(405).json({ error: "Not here." });
  } catch (err) {
    return res.status(500).json({ error: "The wall isn't answering right now. Try again in a minute." });
  }
}
