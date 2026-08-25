// Shared helpers for the OKEII Strong Readers Act deployment review page
// (/OKEII-SRA-Deployment). The page is a catalog of placeholders — one per
// deliverable size a vendor actually asked for — and creative gets dropped onto
// them as it comes out of production.
//
// Everything persisted lives in Vercel Blob under one prefix:
//
//   okeii-sra/state.json          the manifest: slot -> ordered version list.
//                                 PRIVATE — it lists the URL of every file on
//                                 the board, and most of them haven't run yet.
//   okeii-sra/f/<slot>/<file>     the creative itself, one blob per version.
//                                 Public, because the page has to render it, but
//                                 random-suffixed so the URLs aren't guessable.
//
// Nothing is ever overwritten in place. A new drop on a filled slot becomes the
// current version and the old one stays reachable in the slot's history, which
// is the whole point — a reviewer has to be able to see what changed between
// rounds without asking anyone to dig up the previous export.

import { list, put, get } from "@vercel/blob";

export const PREFIX = "okeii-sra/";
export const STATE_PATH = `${PREFIX}state.json`;
export const FILE_PREFIX = `${PREFIX}f/`;
// Slices of an in-flight large upload, deleted as soon as they are reassembled.
export const TMP_PREFIX = `${PREFIX}tmp/`;

// Vercel caps a Serverless Function request body at 4.5 MB, so anything larger
// arrives a slice at a time. 4 MB of raw bytes leaves headroom for headers; the
// base64 fallback inflates by 4/3, which is why its slice is smaller. Note these
// are NOT Blob multipart parts — Blob refuses any part under 5 MiB, which is
// above the body limit, so api/okeii.js reassembles the slices before writing.
export const PART_SIZE = 4_000_000;
export const PART_SIZE_B64 = 3_000_000;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

// An allowlist, not a blocklist. These blobs are served from a public host, so
// nothing that a browser will execute as a document may enter the store — that
// rules out .html and .svg no matter how convenient they'd be for a mock.
export const KINDS = {
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  png: ["image", "image/png"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  mp4: ["video", "video/mp4"],
  m4v: ["video", "video/mp4"],
  mov: ["video", "video/quicktime"],
  webm: ["video", "video/webm"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  m4a: ["audio", "audio/mp4"],
  aac: ["audio", "audio/aac"],
  pdf: ["pdf", "application/pdf"],
  zip: ["archive", "application/zip"],
  docx: ["doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: ["doc", "application/msword"],
  xlsx: ["doc", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["doc", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["doc", "text/plain"],
  md: ["doc", "text/plain"],
  rtf: ["doc", "application/rtf"],
  ai: ["source", "application/postscript"],
  psd: ["source", "image/vnd.adobe.photoshop"],
  indd: ["source", "application/octet-stream"],
  aep: ["source", "application/octet-stream"],
};

export function extOf(filename) {
  const m = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function classify(filename) {
  const ext = extOf(filename);
  const hit = KINDS[ext];
  return hit ? { ext, kind: hit[0], contentType: hit[1] } : null;
}

// Blob pathnames become URLs, so the filename has to survive a round trip
// through one. The original name is kept in the manifest and shown in the UI;
// this is only what the object is called in the store.
export function safeName(filename) {
  const ext = extOf(filename);
  const stem = String(filename || "file")
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${stem || "file"}${ext ? "." + ext : ""}`;
}

export const SLOT_ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function versionId() {
  // Sortable by time, unique enough for a store that sees a few dozen writes a
  // day. Not a security boundary — the blob's own random suffix is.
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function blank() {
  return { version: 1, updatedAt: new Date(0).toISOString(), slots: {}, log: [] };
}

// ── The manifest ───────────────────────────────────────────────────────────
//
// One JSON object holds every slot's history. It is small (a few hundred
// entries of metadata, never file bytes) and it is read on every page load, so
// keeping it in one blob costs one fetch rather than one per slot.

export async function readState() {
  // Both the body and the ETag come out of ONE origin read, and that is the
  // whole point.
  //
  // The first cut did head() for the ETag and fetched the blob's public URL for
  // the body. head() is a control-plane call and always current; the public URL
  // is a CDN edge that honours cacheControlMaxAge and ignores a cache-busting
  // query. So a write could arrive with a *fresh* ETag over a *stale* body — the
  // conditional put passed, and the entries added in the last minute were
  // silently erased. Three of the first eight uploads went that way.
  //
  // The manifest is private for the same reason it is read this way: the CDN
  // bypass only applies to private blobs, and the manifest lists the blob URL of
  // every piece of creative on the board, several of which have not run yet.
  const hit = await get(STATE_PATH, { access: "private", useCache: false });
  if (!hit || hit.statusCode !== 200 || !hit.stream) return { state: blank(), etag: null };
  const text = await new Response(hit.stream).text();
  try {
    return { state: normalize(JSON.parse(text)), etag: hit.etag };
  } catch {
    // A truncated or half-written manifest must not read as an empty board —
    // that would look like every slot had been cleared.
    throw new Error("The manifest didn't parse. Nothing was changed.");
  }
}

function normalize(state) {
  const base = blank();
  if (!state || typeof state !== "object") return base;
  base.updatedAt = typeof state.updatedAt === "string" ? state.updatedAt : base.updatedAt;
  base.log = Array.isArray(state.log) ? state.log.slice(0, 300) : [];
  const slots = state.slots && typeof state.slots === "object" ? state.slots : {};
  for (const [id, slot] of Object.entries(slots)) {
    if (!SLOT_ID_RE.test(id) || !slot || !Array.isArray(slot.versions)) continue;
    base.slots[id] = { currentId: slot.currentId ?? null, versions: slot.versions };
  }
  return base;
}

// @vercel/blob's error classes don't set `name` — BlobError extends Error and
// only prefixes the message — so these match on the message the SDK actually
// throws ("Vercel Blob: The requested blob does not exist" / "Vercel Blob:
// Precondition failed: ETag mismatch."), with the class name as a second look
// in case a future version starts setting one.
const named = (err, cls) => err?.name === cls || err?.constructor?.name === cls;

function isPreconditionFailed(err) {
  return named(err, "BlobPreconditionFailedError") || /precondition failed/i.test(String(err?.message || ""));
}

// Read-modify-write against one shared JSON blob. Two people dropping files at
// the same moment is rare but not impossible, and the loser of that race would
// silently erase the winner's version — so the write is conditional on the ETag
// that was read, and a clash simply replays the mutation against fresh state.
export async function mutate(fn, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const { state, etag } = await readState();
    const result = fn(state);
    if (result === SKIP) return { state, skipped: true };
    state.updatedAt = new Date().toISOString();
    try {
      await put(STATE_PATH, JSON.stringify(state), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        // Conditional on what was actually read above; a clash replays the
        // mutation against fresh state rather than clobbering the winner.
        ...(etag ? { ifMatch: etag } : {}),
      });
      return { state, result };
    } catch (err) {
      if (!isPreconditionFailed(err)) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 60 * (i + 1) + Math.random() * 60));
    }
  }
  throw lastErr || new Error("Couldn't save — the manifest kept changing underneath.");
}

export const SKIP = Symbol("skip");

export function pushLog(state, entry) {
  state.log.unshift({ at: new Date().toISOString(), ...entry });
  state.log = state.log.slice(0, 300);
}

export function addVersion(state, slotId, version) {
  const slot = (state.slots[slotId] ||= { currentId: null, versions: [] });
  slot.versions.unshift(version);
  slot.currentId = version.id;
  return slot;
}

// ── Request guards ─────────────────────────────────────────────────────────
//
// The page's URL is unlisted rather than secret, so writes are the thing worth
// gating. Two tiers:
//
//   additive  (dropping a new version)  — same-origin, plus the review key when
//                                         one is configured
//   destructive (restore, delete)       — always requires the review key
//
// That split is deliberate. The worst an unkeyed visitor can do is add a file
// to the top of a slot's history; nothing they do can remove what is already
// there. OKEII_REVIEW_KEY turns the additive tier on too.

export function keyConfigured() {
  return Boolean(process.env.OKEII_REVIEW_KEY);
}

export function keyMatches(req) {
  const want = process.env.OKEII_REVIEW_KEY;
  if (!want) return false;
  const got = req.headers["x-okeii-key"];
  if (typeof got !== "string" || got.length !== want.length) return false;
  // Length is already equal, so a plain compare leaks only timing on a value
  // the holder chose. Kept constant-time anyway — it costs nothing.
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export function canWrite(req) {
  return keyConfigured() ? keyMatches(req) : true;
}

export function canDestroy(req) {
  return keyConfigured() && keyMatches(req);
}

export async function listFiles() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: FILE_PREFIX, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
