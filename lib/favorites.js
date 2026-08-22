// Shared helpers for the Widget Maker favorites gallery.
//
// Favorites are public, user-generated, and run in other visitors' browsers, so
// the one thing that must hold is: **only HTML this server generated can be
// saved.** /api/generate signs every finished document with an HMAC keyed on
// WIDGET_MAKER_SECRET, and /api/favorites refuses anything whose signature
// doesn't verify. That's stateless — no session, no database of pending
// widgets — and it means the gallery can't be used as a place to host
// arbitrary HTML someone POSTed at us.

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { list } from "@vercel/blob";

export const PREFIX = "favorites/";

function key() {
  const secret = process.env.WIDGET_MAKER_SECRET;
  if (!secret) throw new Error("WIDGET_MAKER_SECRET is not set.");
  return secret;
}

export function sign(html) {
  return createHmac("sha256", key()).update(html, "utf8").digest("hex");
}

export function verify(html, signature) {
  if (typeof signature !== "string" || signature.length !== 64) return false;
  const expected = Buffer.from(sign(html), "hex");
  let given;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(expected, given);
}

// Identity is the document itself, so favouriting the same widget twice is a
// no-op rather than a duplicate card.
export function idFor(html) {
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, 16);
}

// Vercel Blob's list() gives back pathnames, sizes and timestamps — but no
// custom metadata. Rather than fetch every blob just to render a card, the
// title and prompt ride along inside the pathname, base64url-encoded. The
// gallery then costs exactly one list() call, and a favorite's HTML is only
// fetched when someone actually opens it.
//
// base64url's alphabet is [A-Za-z0-9-_], so "." is safe as a separator.
export function encodePath(title, prompt, id) {
  const header = Buffer.from(
    JSON.stringify({ t: title, p: prompt }),
    "utf8",
  ).toString("base64url");
  return `${PREFIX}${header}.${id}.json`;
}

export function decodePath(pathname) {
  const rest = pathname.slice(PREFIX.length);
  const [header, id] = rest.split(".");
  if (!header || !id) return null;
  try {
    const { t, p } = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    return { id, title: String(t || "Widget"), prompt: String(p || "") };
  } catch {
    return null;
  }
}

// ── Lookups ────────────────────────────────────────────────────────────────

export const ID_RE = /^[a-f0-9]{16}$/;

// Social-card snapshots live beside the favorites, keyed by the same id, but
// under their own prefix so the gallery's list() never sees them.
export const SHOTS_PREFIX = "shots/";

export async function listFavorites() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export function itemFor(blob) {
  const meta = decodePath(blob.pathname);
  if (!meta) return null;
  return { ...meta, url: blob.url, savedAt: blob.uploadedAt, pathname: blob.pathname };
}

export async function findFavorite(id) {
  if (!ID_RE.test(String(id))) return null;
  const blobs = await listFavorites();
  const hit = blobs.find((b) => decodePath(b.pathname)?.id === id);
  return hit ? itemFor(hit) : null;
}
