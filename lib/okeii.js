// Shared helpers for the OKEII Strong Readers Act deployment review page
// (/OKEII-SRA-Deployment). The page is a catalog of placeholders — one per
// deliverable size a vendor actually asked for — and creative gets dropped onto
// them as it comes out of production.
//
// Everything persisted lives in Vercel Blob under one prefix:
//
//   okeii-sra/state/<stamp>.json  the manifest: slot -> ordered version list.
//                                 Written to a NEW object every time and never
//                                 edited in place — see readState below.
//   okeii-sra/f/<slot>/<file>     the creative itself, one blob per version.
//                                 Public, because the page has to render it, but
//                                 random-suffixed so the URLs aren't guessable.
//
// Nothing is ever overwritten in place. A new drop on a filled slot becomes the
// current version and the old one stays reachable in the slot's history, which
// is the whole point — a reviewer has to be able to see what changed between
// rounds without asking anyone to dig up the previous export.

import { list, put, del } from "@vercel/blob";

export const PREFIX = "okeii-sra/";
export const STATE_PREFIX = `${PREFIX}state/`;
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
// One JSON object holds every slot's history — a few hundred entries of
// metadata, never file bytes — so a page load costs one fetch rather than one
// per slot. It is written as one manifest object per write, named for the moment it was written, and never
// edited afterwards. Reading means listing the prefix and taking the newest.
//
// The obvious design — one state.json, read-modify-write — does not survive
// contact with a CDN, and the first cut of this file proved it. head() for the
// ETag is a control-plane call and always current; fetching the blob's public URL
// for the body goes to an edge that honours cacheControlMaxAge and ignores a
// cache-busting query. So a write could arrive holding a fresh ETag over a body
// up to a minute stale: the conditional put passed, and every entry added in
// that minute was silently erased. Three of the first eight seeded uploads went
// that way.
//
// Immutable objects make the cache correct rather than fighting it — a given URL
// can only ever hold one thing, so an edge copy is never wrong. list() is a
// control-plane call, so "which is newest" is always current.

const stamp = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
const KEEP = 6;   // rollback depth if a manifest ever lands corrupt

async function listState() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: STATE_PREFIX, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  // Timestamp-first pathnames, so lexical order is chronological order.
  out.sort((a, b) => b.pathname.localeCompare(a.pathname));
  return out;
}

export async function readState() {
  const objects = await listState();
  if (!objects.length) return { state: blank(), at: null, objects };
  const res = await fetch(objects[0].url);
  if (!res.ok) throw new Error(`the manifest came back ${res.status}`);
  const text = await res.text();
  try {
    return { state: normalize(JSON.parse(text)), at: objects[0].pathname, objects };
  } catch {
    // A truncated manifest must not read as an empty board — that would look
    // like every slot had been cleared.
    throw new Error("The newest manifest didn't parse. Nothing was changed.");
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
    base.slots[id] = {
      currentId: slot.currentId ?? null,
      versions: slot.versions,
      notes: Array.isArray(slot.notes) ? slot.notes : [],
    };
  }
  return base;
}

// Mutate = read the newest manifest, apply the change, write a new one.
//
// Two people dropping at the same instant is the one case this can still lose,
// and the window is the width of a single put. The guard is a re-list afterwards:
// if something landed between the read and the write, the mutation is replayed
// against the newer state rather than left as the loser.
export async function mutate(fn, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const { state, at } = await readState();
    const result = fn(state);
    if (result === SKIP) return { state, skipped: true };
    state.updatedAt = new Date().toISOString();

    const pathname = `${STATE_PREFIX}${stamp()}.json`;
    try {
      await put(pathname, JSON.stringify(state), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        // Immutable by construction: this pathname has never been used before.
        cacheControlMaxAge: 31536000,
      });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
      continue;
    }

    const after = await listState();
    const raced = after.find((b) => b.pathname !== pathname && (!at || b.pathname > at) && b.pathname < pathname);
    if (raced) {
      // Someone wrote between our read and our write, so what we just saved is
      // missing their change. Drop ours and replay against theirs.
      lastErr = new Error("another change landed first");
      try { await del(pathname); } catch { /* an orphan is waste, not a failure */ }
      continue;
    }

    await prune(after.filter((b) => b.pathname !== pathname));
    return { state, result };
  }
  throw lastErr || new Error("Couldn't save — the manifest kept changing underneath.");
}

// Superseded manifests are a few KB each and a handful of them is a free undo,
// so a short tail is kept and the rest goes.
async function prune(older) {
  const gone = older.slice(KEEP - 1);
  if (!gone.length) return;
  try {
    await del(gone.map((b) => b.pathname));
  } catch (err) {
    console.error("[okeii] couldn't prune old manifests", err);
  }
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
// gating — and there is one tier for all of them: open when OKEII_REVIEW_KEY is
// unset, key-holders only when it is set.
//
// Deletion sat in a stricter tier of its own at first. That was wrong in
// practice: with no key configured it meant nobody could take a wrong file off a
// slot, which is the thing a reviewer most needs to do. Set the key and every
// write locks together; leave it unset and anyone with the link can work.

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
