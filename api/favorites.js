// lab.philipbaker.us/api/favorites
//
// GET    → the public gallery: newest favorites first, metadata only.
// POST   → save the widget in play. Requires the HMAC that /api/generate issued
//          for that exact document, so the gallery can only ever contain widgets
//          this server wrote.
// DELETE → remove one. Gated on WIDGET_MAKER_ADMIN_KEY; when that isn't set,
//          deletion is off entirely and the CLI is the way to take something
//          down (see CLAUDE.md — the token has to be passed explicitly).

import { list, put, del } from "@vercel/blob";
import { PREFIX, verify, idFor, encodePath, decodePath, listFavorites, itemFor } from "../lib/favorites.js";
import { originAllowed, clientIp, rateLimiter } from "../lib/guard.js";

const MAX_FAVORITES = 200;
const MAX_HTML_CHARS = 400_000;
const MAX_TITLE = 60;
const MAX_PROMPT = 140;
const GALLERY_LIMIT = 60;
const rateLimited = rateLimiter({ windowMs: 60_000, max: 10 });

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  if (!originAllowed(req)) {
    return res.status(403).json({ error: "Not allowed from this origin." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: "No Blob store is connected to this project, so favorites are off.",
    });
  }

  // ── The gallery ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const blobs = await listFavorites();
      const items = blobs
        .map(itemFor)
        .filter(Boolean)
        .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
        .slice(0, GALLERY_LIMIT);

      // The gallery changes rarely; let the CDN carry the load but keep it fresh.
      res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
      return res.status(200).json({ items, total: blobs.length });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Couldn't read the gallery." });
    }
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    if (rateLimited(clientIp(req))) {
      return res.status(429).json({ error: "Easy — too many saves in a minute." });
    }

    const { html, signature, title, prompt } = req.body || {};
    if (typeof html !== "string" || !html) {
      return res.status(400).json({ error: "Nothing to save." });
    }
    if (html.length > MAX_HTML_CHARS) {
      return res.status(400).json({ error: "That widget is too large to save." });
    }

    let ok = false;
    try {
      ok = verify(html, signature);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ok) {
      // Either the document was edited after generation, or someone is POSTing
      // their own HTML at us. Both get the same answer.
      return res.status(403).json({
        error: "That widget isn't one this server generated, so it can't be saved.",
      });
    }

    try {
      const id = idFor(html);
      const existing = await listFavorites();

      const already = existing.find((b) => decodePath(b.pathname)?.id === id);
      if (already) {
        const meta = decodePath(already.pathname);
        return res.status(200).json({
          ok: true,
          already: true,
          item: { ...meta, url: already.url, savedAt: already.uploadedAt, pathname: already.pathname },
        });
      }

      if (existing.length >= MAX_FAVORITES) {
        return res.status(507).json({
          error: `The gallery is full at ${MAX_FAVORITES} widgets. Some need clearing out first.`,
        });
      }

      const cleanTitle = clip(title, MAX_TITLE) || "Widget";
      const cleanPrompt = clip(prompt, MAX_PROMPT);
      const pathname = encodePath(cleanTitle, cleanPrompt, id);
      const savedAt = new Date().toISOString();

      const blob = await put(
        pathname,
        JSON.stringify({ title: cleanTitle, prompt: cleanPrompt, html, savedAt }),
        {
          access: "public",
          contentType: "application/json",
          // Identity is the document hash, so the pathname is already unique and
          // re-saving the same widget must land on the same object.
          addRandomSuffix: false,
          cacheControlMaxAge: 31536000,
        },
      );

      return res.status(201).json({
        ok: true,
        item: { id, title: cleanTitle, prompt: cleanPrompt, url: blob.url, savedAt, pathname },
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Couldn't save that." });
    }
  }

  // ── Taking something down ──────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const adminKey = process.env.WIDGET_MAKER_ADMIN_KEY;
    if (!adminKey) {
      return res.status(404).json({
        error:
          "Deletion isn't enabled. Set WIDGET_MAKER_ADMIN_KEY, or delete via the Vercel Blob CLI.",
      });
    }
    if (req.headers["x-admin-key"] !== adminKey) {
      return res.status(401).json({ error: "Wrong admin key." });
    }
    const pathname = String(req.query?.pathname || "");
    if (!pathname.startsWith(PREFIX)) {
      return res.status(400).json({ error: "Pass ?pathname=favorites/…" });
    }
    try {
      await del(pathname);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Couldn't delete that." });
    }
  }

  return res.status(405).json({ error: "Use GET, POST or DELETE." });
}
