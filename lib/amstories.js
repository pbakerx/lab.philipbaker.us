// Shared helpers for /api/amstories — the "Were You There?" wall at the bottom of
// /90s-web-ackerman-mcqueen: stories and photos from people who worked in (or with)
// Ackerman McQueen, public the moment they are posted.
//
// Storage is Vercel Blob, the way `00. Technical Notes/Vercel Blob as a Datastore.md` says to
// use it: every write is a NEW object, and nothing is ever read-modify-written.
//
//   amstories/s/<id>.json           one story: { v, id, name, role, text, photo: {url, w, h} | null, when }
//   amstories/p/<id>-<random>.jpg   its photo, if it has one (the random suffix makes the URL unguessable)
//   amstories/_hidden/<id>.json     Philip took it off the page with the link in his email; the same
//                                   email's other link deletes this marker and the story is back
//
// An id is a time-sortable stamp plus 48 random bits, so pathnames can't be guessed either.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { list } from "@vercel/blob";

export const ROOT = "amstories/";
export const STORIES = ROOT + "s/";
export const PHOTOS = ROOT + "p/";
export const HIDDEN = ROOT + "_hidden/";
export const PAGE = "https://lab.philipbaker.us/90s-web-ackerman-mcqueen/";
export const MAX_WALL = 500;              // stories on the page at once; past this, posting pauses
export const ID_RE = /^[a-z0-9]{14,40}$/;

export const newId = () => Date.now().toString(36) + randomBytes(6).toString("hex");
export const idTime = (id) => parseInt(String(id).slice(0, -12), 36) || 0;

// One key for the signed links, from whichever project secret exists (the same fallback
// chain the Maze Wars clubhouse uses; AMSTORIES_SECRET only if Philip ever sets one).
function secretKey() {
  const secret = process.env.AMSTORIES_SECRET || process.env.WIDGET_MAKER_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "";
  return createHash("sha256").update("amstories-v1|" + secret).digest();
}
const mac = (what, id) => createHmac("sha256", secretKey()).update(what + "|" + id).digest("hex").slice(0, 24);
function macOk(what, id, k) {
  if (!ID_RE.test(String(id)) || typeof k !== "string" || k.length !== 24) return false;
  const a = Buffer.from(mac(what, id)), b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Philip's links, in the email each story sends him: off the page, or back on. No password.
export const hideOk = (id, k) => macOk("hide", id, k);
export const hideLink = (id, hide) => `https://lab.philipbaker.us/api/amstories?op=hide&id=${id}&k=${mac("hide", id)}&hide=${hide ? 1 : 0}`;
// The poster's own key, handed back once when they post and kept by their browser: it lets
// them remove their story, photo and all, for good.
export const ownKey = (id) => mac("own", id);
export const ownOk = (id, k) => macOk("own", id, k);

// One line of text: no control characters, no angle brackets, single spaces.
export const line = (s, n) => String(s ?? "").replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
// A story: the same, except paragraphs are kept (never more than one blank line between them).
export const prose = (s, n) => String(s ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(/[\p{Cc}<>]/gu, (c) => (c === "\n" ? "\n" : " "))
  .replace(/[^\S\n]+/g, " ")
  .replace(/ *\n */g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim()
  .slice(0, n);

export async function listAll(prefix) {
  const out = []; let cursor;
  do { const page = await list({ prefix, cursor, limit: 1000 }); out.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  return out;
}

// Mail goes through the same Resend account and verified address the Maze Wars clubhouse
// uses; only the display name changes. AMSTORIES_OWNER_EMAIL only if Philip wants these
// somewhere other than the clubhouse's inbox.
export const ownerEmail = () => process.env.AMSTORIES_OWNER_EMAIL || process.env.MAZEWARS_OWNER_EMAIL || "";
export const mailReady = () => !!process.env.RESEND_API_KEY && !!ownerEmail();
function fromAddress() {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(process.env.MAZEWARS_MAIL_FROM || "");
  return `lab.philipbaker.us <${m ? m[1] : "philip@philipbaker.us"}>`;
}
export async function sendMail(subject, text) {
  if (!mailReady()) return { sent: false, why: "not configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to: [ownerEmail()], subject, text }),
    });
    return r.ok ? { sent: true } : { sent: false, why: `resend ${r.status}` };
  } catch (err) {
    return { sent: false, why: err?.message || "network" };
  }
}
