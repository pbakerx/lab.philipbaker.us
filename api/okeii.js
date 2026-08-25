// lab.philipbaker.us/api/okeii  —  the store behind /OKEII-SRA-Deployment
//
//   GET  ?action=state                       the manifest: every slot's version history
//   POST ?action=put                         one-shot upload for anything under a part
//   POST ?action=begin                       open a sliced upload (anything over a part)
//   POST ?action=part&id=<ticket>&n=<1-based>  one slice, raw bytes (or ?enc=b64)
//   POST ?action=finish                      close it out and record the version
//   POST ?action=restore                     make an older version current again
//   POST ?action=note                        edit a version's note
//   POST ?action=remove                      drop a version from a slot's history
//
// Uploads are additive: a drop on a filled slot pushes a new current version and
// leaves the old one in history. Nothing here overwrites a file. The one action
// that destroys something — remove, which deletes the blob — always requires
// OKEII_REVIEW_KEY, whether or not the additive tier is gated.
//
// The 4.5 MB Serverless Function body limit is the reason for the begin/part/
// finish dance — the campaign's :15 renders out at ~50 MB, so it cannot arrive
// in one request no matter how it is encoded. See "Big files" below for why the
// slices can't just be handed on to Blob as multipart parts.

import { put, del, list } from "@vercel/blob";
import {
  FILE_PREFIX,
  TMP_PREFIX,
  MAX_FILE_BYTES,
  PART_SIZE,
  PART_SIZE_B64,
  SLOT_ID_RE,
  addVersion,
  canDestroy,
  canWrite,
  classify,
  keyConfigured,
  keyMatches,
  mutate,
  pushLog,
  readState,
  safeName,
  versionId,
} from "../lib/okeii.js";
import { originAllowed, clientIp, rateLimiter } from "../lib/guard.js";
import { randomUUID } from "node:crypto";

const rateLimited = rateLimiter({ windowMs: 60_000, max: 240 });
const MAX_NOTE = 400;
const MAX_BY = 60;

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const fail = (res, code, error, extra) => res.status(code).json({ error, ...extra });
// Thrown from inside a mutate() callback, where the only honest answer is "the
// manifest moved on" rather than "the server broke".
const conflict = (m) => Object.assign(new Error(m), { status: 409 });

export default async function handler(req, res) {
  if (!originAllowed(req)) return fail(res, 403, "Not allowed from this origin.");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return fail(res, 503, "No Blob store is connected to this project, so the review page is read-only.");
  }

  const action = String(req.query?.action || "state");

  try {
    if (req.method === "GET") {
      if (action !== "state") return fail(res, 400, "GET only serves ?action=state.");
      const { state } = await readState();
      // The whole point of this page is seeing creative the moment it lands, so
      // the manifest is deliberately not cached at the edge.
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        ok: true,
        state,
        gate: { keyRequired: keyConfigured(), unlocked: keyMatches(req) },
        limits: { partSize: PART_SIZE, partSizeB64: PART_SIZE_B64, maxFileBytes: MAX_FILE_BYTES },
      });
    }

    if (req.method !== "POST") return fail(res, 405, "Use GET or POST.");
    if (rateLimited(clientIp(req))) return fail(res, 429, "Too many requests in a minute — give it a moment.");

    // Only permanent deletion is in the hard tier. Making an older version
    // current again changes nothing that can't be changed back, and a note is a
    // note — gating those behind a key nobody has set would mean the board
    // couldn't be rolled back at all.
    const destructive = action === "remove";
    if (destructive ? !canDestroy(req) : !canWrite(req)) {
      return fail(res, 401, gateMessage(destructive), { needsKey: true });
    }

    switch (action) {
      case "put": return await onePut(req, res);
      case "begin": return await begin(req, res);
      case "part": return await part(req, res);
      case "finish": return await finish(req, res);
      case "restore": return await restore(req, res);
      case "note": return await note(req, res);
      case "remove": return await remove(req, res);
      default: return fail(res, 400, `Unknown action "${action}".`);
    }
  } catch (err) {
    // Never leak a stack to a page the client might be looking at.
    console.error("[okeii]", action, err);
    return fail(res, err?.status || 500, err?.message || "That didn't go through.");
  }
}

function gateMessage(destructive) {
  if (destructive && !keyConfigured()) {
    return "Deleting a version permanently needs the review key, and OKEII_REVIEW_KEY isn't set on this project. Everything else still works — nothing on this board can be lost.";
  }
  return "That needs the review key — use Unlock at the top of the page.";
}

// ── Shared validation ──────────────────────────────────────────────────────

/* Dragging the same file onto the same placeholder twice is a slip, not a new
   round, and a history full of identical entries makes the real revisions hard
   to find. Identity is the file's SHA-256, so this catches a re-drop under a
   different name and lets a genuine re-export through. Scoped to the slot's
   CURRENT version: putting last week's file back deliberately is a restore, and
   that still works. */
async function duplicate(d) {
  if (!d.meta?.sha || d.allowDuplicate) return null;
  const { state } = await readState();
  const slot = state.slots[d.slotId];
  if (!slot?.versions.length) return null;
  const current = slot.versions.find((v) => v.id === slot.currentId) || slot.versions[0];
  return current?.sha === d.meta.sha ? current : null;
}

function describe(body) {
  const slotId = String(body?.slotId || "");
  if (!SLOT_ID_RE.test(slotId)) return { error: "That isn't a slot on this page." };

  const filename = clip(body?.filename, 180);
  if (!filename) return { error: "The file arrived without a name." };

  const type = classify(filename);
  if (!type) {
    return {
      error: `"${filename}" isn't a file type this page accepts. Images, video, audio, PDF, Office documents and design source files are — HTML and SVG deliberately are not.`,
    };
  }

  const sha = String(body?.sha || "");
  if (sha && !/^[a-f0-9]{64}$/.test(sha)) return { error: "That file's checksum didn't look like one." };

  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0) return { error: "That file looks empty." };
  if (size > MAX_FILE_BYTES) {
    return { error: `${filename} is ${mb(size)} — over the ${mb(MAX_FILE_BYTES)} ceiling for this page.` };
  }

  return {
    slotId,
    filename,
    size,
    type,
    pathname: `${FILE_PREFIX}${slotId}/${safeName(filename)}`,
    allowDuplicate: body?.allowDuplicate === true,
    meta: {
      sha: sha || null,
      by: clip(body?.by, MAX_BY) || "Unattributed",
      note: clip(body?.note, MAX_NOTE),
      width: posInt(body?.width),
      height: posInt(body?.height),
      duration: Number.isFinite(Number(body?.duration)) ? Math.round(Number(body.duration) * 100) / 100 : null,
    },
  };
}

const posInt = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

function record(state, d, blob, extra = {}) {
  const version = {
    id: versionId(),
    filename: d.filename,
    kind: d.type.kind,
    contentType: blob.contentType || d.type.contentType,
    size: d.size,
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    pathname: blob.pathname,
    uploadedAt: new Date().toISOString(),
    ...d.meta,
    ...extra,
  };
  const slot = addVersion(state, d.slotId, version);
  pushLog(state, {
    slotId: d.slotId,
    versionId: version.id,
    action: slot.versions.length > 1 ? "replaced" : "added",
    by: version.by,
    filename: version.filename,
  });
  return version;
}

// ── One-shot upload ────────────────────────────────────────────────────────
//
// The body arrives base64-encoded inside JSON. That inflates it by a third, so
// the client only takes this path for files comfortably under the limit and
// falls through to begin/part/finish for anything larger.

async function onePut(req, res) {
  const d = describe(req.body || {});
  if (d.error) return fail(res, 400, d.error);
  const dup = await duplicate(d);
  if (dup) return res.status(200).json({ ok: true, already: true, version: dup });

  const raw = String(req.body?.data || "");
  if (!raw) return fail(res, 400, "No file data came through.");
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) return fail(res, 400, "The file data didn't decode.");

  const blob = await put(d.pathname, buf, {
    access: "public",
    contentType: d.type.contentType,
    // The store is public, so a guessable pathname would be a guessable URL for
    // creative that hasn't run yet. The suffix is what keeps these unlisted.
    addRandomSuffix: true,
    cacheControlMaxAge: 31536000,
  });

  let version;
  await mutate((state) => { version = record(state, { ...d, size: buf.length }, blob); });
  return res.status(201).json({ ok: true, version });
}

// ── Big files ──────────────────────────────────────────────────────────────
//
// Two limits collide here: a Vercel Serverless Function accepts at most 4.5 MB
// of request body, and Blob's multipart API refuses any part under 5 MiB. So the
// browser cannot hand the server pieces that the server can pass straight
// through as multipart parts — there is no size that satisfies both.
//
// What works is to land each 4 MB slice as its own short-lived blob, then have
// finish() read them back in order as one continuous stream and hand THAT to
// put({multipart:true}), which does its own chunking at a legal size. The bytes
// make an extra hop inside Vercel's own network, which is cheap; the alternative
// is hand-rolling Blob's client-token wire protocol in the browser, which is
// version-coupled and would break silently on an SDK bump.

async function begin(req, res) {
  const d = describe(req.body || {});
  if (d.error) return fail(res, 400, d.error);
  // Checked here rather than at finish, so a 50 MB re-drop never leaves the
  // browser at all.
  const dup = await duplicate(d);
  if (dup) return res.status(200).json({ ok: true, already: true, version: dup });

  const id = randomUUID();
  return res.status(200).json({
    ok: true,
    ticket: { id, slotId: d.slotId, filename: d.filename, size: d.size },
    partSize: PART_SIZE,
    partSizeB64: PART_SIZE_B64,
    parts: Math.ceil(d.size / PART_SIZE),
  });
}

const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;
const tmpDir = (id) => `${TMP_PREFIX}${id}/`;
// Zero-padded so the pathname sort finish() relies on is the numeric order.
const tmpPart = (id, n) => `${tmpDir(id)}${String(n).padStart(5, "0")}`;

async function part(req, res) {
  const id = String(req.query?.id || "");
  const n = Number(req.query?.n);
  if (!UPLOAD_ID_RE.test(id)) return fail(res, 400, "That upload slice is missing its ticket.");
  if (!Number.isInteger(n) || n < 1 || n > 4096) return fail(res, 400, "Bad part number.");

  const body = await rawBody(req);
  if (!body.length) return fail(res, 400, "That slice arrived empty.");
  if (body.length > PART_SIZE + 8192) return fail(res, 413, "That slice is bigger than the agreed part size.");

  await put(tmpPart(id, n), body, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    allowOverwrite: true,     // a retried slice must land on the same object
    cacheControlMaxAge: 60,
  });

  return res.status(200).json({ ok: true, n });
}

async function finish(req, res) {
  const t = req.body?.ticket || {};
  if (!UPLOAD_ID_RE.test(String(t.id))) return fail(res, 400, "That upload can't be closed out — its ticket is missing.");

  const d = describe({ ...req.body, slotId: t.slotId, filename: t.filename, size: t.size });
  if (d.error) return fail(res, 400, d.error);

  // The slices are found by listing, never by trusting URLs the caller sent —
  // a client-supplied URL here would be a request forgery the server performs
  // on its own network.
  const slices = [];
  let cursor;
  do {
    const page = await list({ prefix: tmpDir(t.id), cursor, limit: 1000 });
    slices.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  slices.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const expected = Number(req.body?.parts);
  if (!slices.length) return fail(res, 409, "None of that upload's slices are still in the store — start it again.");
  if (Number.isInteger(expected) && slices.length !== expected) {
    await scrub(slices);
    return fail(res, 409, `That upload is missing slices — ${slices.length} of ${expected} arrived. Try it again.`);
  }
  const total = slices.reduce((n, b) => n + b.size, 0);

  try {
    const blob = await put(d.pathname, joined(slices), {
      access: "public",
      contentType: d.type.contentType,
      addRandomSuffix: true,
      multipart: true,          // the SDK re-chunks at a size Blob will accept
      cacheControlMaxAge: 31536000,
    });

    let version;
    await mutate((state) => { version = record(state, { ...d, size: total }, blob); });
    return res.status(201).json({ ok: true, version });
  } finally {
    await scrub(slices);
  }
}

// One continuous stream over the slices, pulled in order and never all held in
// memory at once — a 50 MB render would otherwise have to fit in the function.
function joined(slices) {
  let i = 0;
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (i >= slices.length) { controller.close(); return; }
          const res = await fetch(slices[i].url, { cache: "no-store" });
          if (!res.ok || !res.body) throw new Error(`slice ${i + 1} came back ${res.status}`);
          i += 1;
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) { reader = null; continue; }
        controller.enqueue(value);
        return;
      }
    },
  });
}

// Best effort: an orphaned slice is billable waste, not a broken upload, so it
// must never turn a successful assembly into a failed request.
async function scrub(slices) {
  if (!slices.length) return;
  try {
    await del(slices.map((b) => b.pathname));
  } catch (err) {
    console.error("[okeii] couldn't clear upload slices", err);
  }
}

// Vercel's Node runtime hands back a Buffer for content types it doesn't parse,
// which is what an octet-stream slice is. The base64 branch exists because that
// behaviour is the one thing here that isn't ours to guarantee — if a slice ever
// comes back empty the client retries the whole file with ?enc=b64, which rides
// the JSON path that is definitely parsed.
async function rawBody(req) {
  if (String(req.query?.enc) === "b64") {
    const chunk = typeof req.body === "string" ? req.body : req.body?.data;
    return Buffer.from(String(chunk || ""), "base64");
  }
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ── History ────────────────────────────────────────────────────────────────

async function restore(req, res) {
  const slotId = String(req.body?.slotId || "");
  const id = String(req.body?.versionId || "");
  if (!SLOT_ID_RE.test(slotId)) return fail(res, 400, "That isn't a slot on this page.");

  let picked = null;
  await mutate((state) => {
    const slot = state.slots[slotId];
    const hit = slot?.versions.find((v) => v.id === id);
    if (!hit) throw conflict("That version isn't in this slot's history any more.");
    slot.currentId = id;
    picked = hit;
    pushLog(state, { slotId, versionId: id, action: "restored", by: clip(req.body?.by, MAX_BY) || "Unattributed", filename: hit.filename });
  });
  return res.status(200).json({ ok: true, version: picked });
}

async function note(req, res) {
  const slotId = String(req.body?.slotId || "");
  const id = String(req.body?.versionId || "");
  const text = clip(req.body?.note, MAX_NOTE);
  if (!SLOT_ID_RE.test(slotId)) return fail(res, 400, "That isn't a slot on this page.");

  await mutate((state) => {
    const hit = state.slots[slotId]?.versions.find((v) => v.id === id);
    if (!hit) throw conflict("That version isn't in this slot's history any more.");
    hit.note = text;
  });
  return res.status(200).json({ ok: true });
}

// The blob goes too. Storage is metered and a superseded 50 MB render is worth
// real money to keep around by accident — but the current version can never be
// the one removed, so a slot can't be emptied by a single click.
async function remove(req, res) {
  const slotId = String(req.body?.slotId || "");
  const id = String(req.body?.versionId || "");
  if (!SLOT_ID_RE.test(slotId)) return fail(res, 400, "That isn't a slot on this page.");

  let pathname = null;
  await mutate((state) => {
    const slot = state.slots[slotId];
    const i = slot?.versions.findIndex((v) => v.id === id) ?? -1;
    if (i < 0) throw conflict("That version isn't in this slot's history any more.");
    if (slot.versions.length > 1 && slot.currentId === id) {
      throw conflict("That's the current version. Restore an earlier one first, then remove this.");
    }
    pathname = slot.versions[i].pathname;
    const [gone] = slot.versions.splice(i, 1);
    if (!slot.versions.length) delete state.slots[slotId];
    else if (slot.currentId === id) slot.currentId = slot.versions[0].id;
    pushLog(state, { slotId, versionId: id, action: "removed", by: clip(req.body?.by, MAX_BY) || "Unattributed", filename: gone.filename });
  });

  // The manifest is the source of truth; a blob that outlives its entry is
  // waste, not a bug, so a failure here must not fail the request.
  if (pathname) { try { await del(pathname); } catch (err) { console.error("[okeii] orphan blob", pathname, err); } }
  return res.status(200).json({ ok: true });
}
