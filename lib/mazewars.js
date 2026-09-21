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
//   mazewars/v/<YYYYMMDD>/<visit id>.<b64 row>.<stamp>.json  the visit log; mazewars/v/_digest/<date>.<stamp>.json marks a digest as sent
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
export const VISITS = "mazewars/v/";                // one row per visit: who came, for how long, what happened (see "the visit log" below)
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

// The list of feature requests is public, so Philip needs a way to take one down that needs no password: every request's email
// carries a signed link. The person who SENT an idea gets the same key back, so they can take their own down too.
export const IDEA_RE = /^[a-z0-9]{10,40}$/;
export const ideaKey = (id) => createHmac("sha256", secretKey()).update("idea|" + id).digest("hex").slice(0, 24);
export function ideaOk(id, k) { if (!IDEA_RE.test(String(id)) || typeof k !== "string" || k.length !== 24) return false; const a = Buffer.from(ideaKey(id)), b = Buffer.from(k); return a.length === b.length && timingSafeEqual(a, b); }
export const ideaLink = (id, hide) => `https://lab.philipbaker.us/api/mazewars?op=idea&id=${id}&k=${ideaKey(id)}&hide=${hide ? 1 : 0}`;

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

// ── the visit log ──────────────────────────────────────────────────────────────────────────
// Philip, Sep 21 2026: "Are [we] able to see who's played and how long they stayed on?" Until then the only record of a visit was
// the "just came in" email, and play time was sent with a score and thrown away. Now the page reports one row per visit — when it
// is hidden, when it closes, and every two minutes in between (a phone kills a tab without a word) — and each report REPLACES the
// one before it (put the new object, then delete the old: the scores' pattern). The row rides in the pathname, so a day's digest
// is a listing and no body is ever fetched. No IP address is stored, nothing but what the player typed and what the game counted.
//   stay = arrival to their last ACTIVE moment (a tab left open all night is not a twelve-hour visit)
//   play = seconds with the window showing and a hand on the controls
export const VISITS_SINCE = "2026-09-21";          // the first Central-time day the log covers; a digest for any day before it would be a lie
export const VID_RE = /^[a-z0-9]{12,24}$/;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
export function encodeVisit(v) {
  const row = Buffer.from(JSON.stringify({ n: v.name, f: v.full, l: v.loc, a: v.at, s: v.stay, p: v.play, k: v.kills, d: v.deaths, h: v.humans, t: v.thumbs, c: v.chat, m: v.touch, r: v.ref, z: v.line, ph: v.ph }), "utf8").toString("base64url");
  return `${VISITS}${ymd(v.at)}/${v.vid}.${row}.${v.stamp}.json`;
}
export function decodeVisit(blob) {
  const m = /^mazewars\/v\/\d{8}\/([a-z0-9]{12,24})\.([A-Za-z0-9_-]+)\.([a-z0-9]+)\.json$/.exec(blob.pathname); if (!m) return null;
  try { const h = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8")); const n = (x, hi) => Math.max(0, Math.min(hi, x | 0));
    return { vid: m[1], stamp: m[3], pathname: blob.pathname, name: clean(h.n, 15) || "Nobody", full: clean(h.f, 40), loc: clean(h.l, 40), at: Number(h.a) || 0, stay: n(h.s, 86400), play: n(h.p, 86400), kills: n(h.k, 9999), deaths: n(h.d, 9999),
      humans: n(h.h, 40), thumbs: h.t ? 1 : 0, chat: n(h.c, 999), touch: h.m ? 1 : 0, ref: clean(h.r, 60), line: h.z ? 1 : 0, ph: PH_RE.test(String(h.ph)) ? h.ph : "" };
  } catch { return null; }
}
// A calendar day in Philip's time zone, `back` days ago: its label and its first and last instant. Midnight Central is 05:00 or
// 06:00 UTC depending on daylight saving, so try both and keep the one that really is midnight there.
const chicago = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
function centralMidnight(y, m, d) { const want = new Date(Date.UTC(y, m - 1, d)); for (const h of [5, 6]) { const t = Date.UTC(y, m - 1, d, h), c = chicago(t); if (+c.hour === 0 && +c.day === want.getUTCDate()) return t; } return Date.UTC(y, m - 1, d, 6); }
export function centralDay(back = 1, nowMs = Date.now()) {
  const c = chicago(nowMs), day = new Date(Date.UTC(+c.year, +c.month - 1, +c.day - back)), next = new Date(day.getTime() + 86_400_000);
  const start = centralMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()), end = centralMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { date: day.toISOString().slice(0, 10), start, end, label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(day) };
}
export const span = (secs) => { secs = Math.max(0, Math.round(secs)); if (secs < 60) return secs + "s"; const m = Math.round(secs / 60); return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };
const many = (n, one, plural) => `${n} ${n === 1 ? one : plural || one + "s"}`;
// The words of the morning email. `rows` are that day's visits (latest report of each); `before` is the set of player hashes seen on
// any earlier day. Pure, so it can be run anywhere.
export function digestText(rows, day, before = new Set()) {
  if (!rows.length) return { subject: "Maze Wars+ yesterday: nobody came in", text: `Maze Wars+ — ${day.label}\n\nNobody came into the maze.\n\n${GAME}` };
  rows = [...rows].sort((a, b) => a.at - b.at); const who = (r) => r.ph || r.vid, players = new Set(rows.map(who)), back = new Set(rows.filter((r) => r.ph && before.has(r.ph)).map(who));
  const plays = rows.map((r) => r.play).sort((a, b) => a - b), typical = plays[Math.floor((plays.length - 1) / 2)], longest = rows.reduce((a, b) => (b.play > a.play ? b : a));
  const from = new Map(); for (const r of rows) { const k = r.ref || "direct"; from.set(k, (from.get(k) || 0) + 1); } const chatters = rows.filter((r) => r.chat > 0);
  const head = [
    `${many(rows.length, "visit")} from ${many(players.size, "player")}${back.size ? ` (${back.size} had been before)` : ""}. ${rows.filter((r) => r.touch).length} on a phone or tablet, ${rows.filter((r) => !r.touch).length} on a desktop.`,
    `In the maze ${span(rows.reduce((a, r) => a + r.stay, 0))} in all, ${span(rows.reduce((a, r) => a + r.play, 0))} of it actually playing. A typical visit played ${span(typical)}; the longest, ${span(longest.play)} (${longest.name}).`,
    `${rows.filter((r) => r.thumbs).length} played Thumbs, ${rows.filter((r) => r.humans > 0).length} met another person, ${chatters.length} chatted${chatters.length ? ` (${many(chatters.reduce((a, r) => a + r.chat, 0), "line")})` : ""}.`,
    `Came from: ${[...from.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}.`,
  ];
  const at = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  const list = rows.map((r) => { const card = [r.full, r.loc].filter(Boolean).join(", "), met = [r.thumbs ? "Thumbs" : "", r.humans ? many(r.humans, "person", "people") : ""].filter(Boolean).join(" and ");
    return `${at(r.at)}  ${r.name}${card ? ` (${card})` : ""}${r.ph && before.has(r.ph) ? "  - has been before" : ""}\n         ${span(r.stay)} in the maze, ${span(r.play)} playing. Score ${r.kills}-${r.deaths}. ${met ? "Met " + met + "." : "Met nobody."}${r.chat ? " " + many(r.chat, "chat line") + "." : ""} ${r.touch ? "Phone or tablet" : "Desktop"}${r.ref ? ", from " + r.ref : ""}${r.line ? ", on a private line" : ""}.`; });
  return { subject: `Maze Wars+ yesterday: ${many(rows.length, "visit")}, ${many(players.size, "player")}`, text: `Maze Wars+ — ${day.label} (Central time)\n\n${head.join("\n")}\n\n${list.join("\n\n")}\n\n--\n"In the maze" runs to their last active moment; "playing" is time with the window showing and a hand on the controls.\n${GAME}` };
}
