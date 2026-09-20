// Shared helpers for /api/mazewars — the Maze Wars+ high score board, player cards, the
// feature-request box, and the few emails the game sends.
//
// Storage is Vercel Blob, used the way `00. Technical Notes/Vercel Blob as a Datastore.md`
// says to: every write is a NEW object, nothing is read-modify-written, and whatever a listing
// needs rides in the PATHNAME (list() returns pathnames but no metadata) — so the board is one
// list() call and no blob body is fetched to draw it.
//
//   mazewars/s/<b64 public row>.<player hash>.<stamp>.json   a player's best visit   (PUBLIC by design)
//   mazewars/p/<player hash>.<flags>.<stamp>.json            their card: sealed email + consents
//   mazewars/b/<stamp>.json                                  "an announcement went out" markers
//   mazewars/r/<stamp>.json                                  feature requests
//
// What is public and what is not:
//   • player name, full name, location, score -> public (they ARE the board) -> score pathname
//   • email -> never in a pathname, never in any response to a browser; it exists only inside a
//     card's body, and only as AES-256-GCM ciphertext, because every object in this store is a
//     public URL to anyone who learns it. Every pathname carries 48 random bits besides.

import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { list } from "@vercel/blob";

export const SCORES = "mazewars/s/";
export const CARDS = "mazewars/p/";
export const BELLS = "mazewars/b/";
export const REQUESTS = "mazewars/r/";
export const BOARD_SIZE = 10;        // "the top ten" — being pushed out of it is what sends the bump email
export const KEEP = 120;             // score rows kept at all; the tail beyond this is pruned
export const BELL_REST_MS = 60 * 60 * 1000;   // one "somebody is online" announcement an hour, site-wide
export const BELL_MAX = 40;          // recipients per announcement (Resend's free tier is 100 emails a day)
export const GAME = "https://lab.philipbaker.us/maze-wars/";

// One key for everything private, derived from whichever project secret exists: MAZEWARS_SECRET
// if Philip ever sets one; otherwise the secret Widget Maker already requires; the Blob token as
// a last resort (if THAT leaks the store is readable anyway, so nothing more is lost).
function secretKey() {
  const secret = process.env.MAZEWARS_SECRET || process.env.WIDGET_MAKER_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "";
  return createHash("sha256").update("mazewars-pii-v1|" + secret).digest();
}
export function seal(text) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
export function unseal(sealed) {
  try {
    const b = Buffer.from(String(sealed), "base64url"), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// The browser keeps a random player id and never shows it; only this hash of it is ever public.
// Knowing the id is what lets you change or remove your own rows.
export const PID_RE = /^[a-z0-9]{16,40}$/;
export const PH_RE = /^[a-f0-9]{16}$/;
export const playerHash = (pid) => createHash("sha256").update("mazewars-player|" + pid).digest("hex").slice(0, 16);

// The unsubscribe link in every email: proof that the link came from us, for that player.
export const unsubKey = (ph) => createHmac("sha256", secretKey()).update("unsub|" + ph).digest("hex").slice(0, 24);
export function unsubOk(ph, k) {
  if (!PH_RE.test(String(ph)) || typeof k !== "string" || k.length !== 24) return false;
  const a = Buffer.from(unsubKey(ph)), b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const unsubLink = (ph) => `https://lab.philipbaker.us/api/mazewars?op=unsub&id=${ph}&k=${unsubKey(ph)}`;

export const clean = (s, n) => String(s ?? "").replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
export const stamp = () => Date.now().toString(36) + randomBytes(6).toString("hex");
export const stampTime = (s) => parseInt(String(s).slice(0, -12), 36) || 0;

// ── score rows ─────────────────────────────────────────────────────────────────────────────
export function encodeScore(rec) {
  const header = Buffer.from(JSON.stringify({ n: rec.name, f: rec.full, l: rec.loc, k: rec.kills, d: rec.deaths, w: rec.when }), "utf8").toString("base64url");
  return `${SCORES}${header}.${rec.ph}.${rec.stamp}.json`;
}
export function decodeScore(blob) {
  const parts = blob.pathname.slice(SCORES.length).split(".");
  if (parts.length !== 4 || !PH_RE.test(parts[1])) return null;
  try {
    const h = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const kills = h.k | 0, deaths = h.d | 0;
    if (kills < 1 || kills > 999 || deaths < 0 || deaths > 999) return null;
    return { name: clean(h.n, 15) || "Nobody", full: clean(h.f, 40), loc: clean(h.l, 40), kills, deaths, when: clean(h.w, 10), ph: parts[1], stamp: parts[2], pathname: blob.pathname, url: blob.url, uploadedAt: blob.uploadedAt };
  } catch {
    return null;
  }
}
// More kills wins; then fewer deaths; then whoever got there first.
export const better = (a, b) => (a.kills !== b.kills ? a.kills > b.kills : a.deaths !== b.deaths ? a.deaths < b.deaths : false);
export function ranked(entries) {
  const best = new Map();                         // one row per player: their best
  for (const e of entries) { const cur = best.get(e.ph); if (!cur || better(e, cur)) best.set(e.ph, e); }
  const at = (e) => new Date(e.uploadedAt || 0).getTime() || 0;   // list() hands back Dates; a row not yet listed carries its own
  return [...best.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || at(a) - at(b));
}
export const publicRow = (e, i) => ({ rank: i + 1, id: e.ph.slice(0, 8), name: e.name, full: e.full, loc: e.loc, kills: e.kills, deaths: e.deaths, when: e.when });

// ── cards ──────────────────────────────────────────────────────────────────────────────────
// flags in the pathname: b = "email me if I am bumped", o = "email me when someone comes online".
// That lets an announcement find its audience from one list() and fetch only those bodies.
export const cardPath = (ph, c) => `${CARDS}${ph}.${(c.bump ? "b" : "") + (c.online ? "o" : "") || "x"}.${stamp()}.json`;
export function decodeCard(blob) {
  const parts = blob.pathname.slice(CARDS.length).split(".");
  if (parts.length !== 4 || !PH_RE.test(parts[0])) return null;
  return { ph: parts[0], bump: parts[1].includes("b"), online: parts[1].includes("o"), at: stampTime(parts[2]), pathname: blob.pathname, url: blob.url };
}
export function newestCards(blobs) {                // one per player: the newest
  const m = new Map();
  for (const b of blobs) { const c = decodeCard(b); if (c && (!m.has(c.ph) || m.get(c.ph).at < c.at)) m.set(c.ph, c); }
  return m;
}
export async function emailOf(card) {               // null unless there is a readable address in it
  try { const body = await (await fetch(card.url)).json(); const to = body?.e ? unseal(body.e) : null; return to && EMAIL_RE.test(to) ? { to, body } : null; } catch { return null; }
}

export async function listAll(prefix) {
  const out = []; let cursor;
  do { const page = await list({ prefix, cursor, limit: 1000 }); out.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  return out;
}

// ── email (Resend) ─────────────────────────────────────────────────────────────────────────
// Off until RESEND_API_KEY is in the project env AND a redeploy has happened (env vars are
// snapshotted into a deployment). MAZEWARS_MAIL_FROM must be an address on a domain verified in
// that Resend account, or Resend refuses the send. MAZEWARS_OWNER_EMAIL is where "somebody just
// came in" and feature requests go.
export const mailReady = () => !!process.env.RESEND_API_KEY;
export async function sendMail(to, subject, text, ph) {
  if (!mailReady()) return { sent: false, why: "not configured" };
  const footer = ph ? `\n\n--\nYou asked Maze Wars+ to send you this. One click stops all of it:\n${unsubLink(ph)}\n` : "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAZEWARS_MAIL_FROM || "Maze Wars+ <mazewars@philipbaker.us>", to: [to], subject, text: text + footer,
        headers: ph ? { "List-Unsubscribe": `<${unsubLink(ph)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      }),
    });
    return r.ok ? { sent: true } : { sent: false, why: `resend ${r.status}` };
  } catch (err) {
    return { sent: false, why: err?.message || "network" };
  }
}
