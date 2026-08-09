# lab — lab.philipbaker.us

One-off static projects, FTP-style. **Each top-level folder = a path on lab.philipbaker.us.**
Drop a folder with an `index.html`, deploy, done. Curated by Philip; keep the root index
(`index.html`) list in sync when adding/removing a project.

Mostly static — `/api/*.js` are Vercel Node serverless functions (see /widget-maker). The
root `package.json` exists only so Vercel installs their deps; there is no build step, and
`vercel.json` pins `"framework": null` to keep it that way.

## Deploy

```bash
npx vercel --prod --scope team_msxsmiFFlh80LDtD36JrW9pk
```

The `--scope` flag is required — without it the CLI errors "Not authorized" (the project is
linked to that team in `.vercel/project.json` but the logged-in user `pbakerx-7592` needs the
explicit scope). Production alias: https://lab.philipbaker.us — allow ~10–15s of CDN
propagation before verifying new paths (fresh 404s right after READY are usually just lag).

`vercel.json` sets `Access-Control-Allow-Origin: *` on `/arcade/media/*` so external tools
(e.g. the Infinite Mac emulator) can fetch recovered binaries cross-origin.

## Projects

- **/widget-maker** — creative sandbox: type a wish ("a bunch of red balls bouncing
  around", "asteroids", "a rain simulator"), Claude writes a self-contained HTML widget,
  and it runs live in a sandboxed iframe. Iterate by saying what to change; every build
  lands in a version rail you can jump back to. Nothing is persisted server-side.
  - `api/generate.js` — Vercel Node function. Streams SSE (`delta`/`done`/`error`) from
    `claude-opus-5` via `@anthropic-ai/sdk`. The system prompt is the product here: it
    dictates one complete HTML document, no fences, no external resources, no storage
    APIs (opaque origin — they throw), fill-the-viewport + DPI-aware canvas, and
    "return the whole document again" on iteration.
  - Iteration context is collapsed to `[original wish, current HTML, new instruction]`
    rather than the full transcript — the document already embodies every earlier change.
  - Needs `ANTHROPIC_API_KEY` in the Vercel project env. Optional: `WIDGET_MAKER_PASSCODE`
    (gates the endpoint) and `WIDGET_MAKER_EFFORT` (defaults to `medium` to stay inside
    the 60s function limit).
  - Guardrails: origin allowlist, 8 req/min per IP (in-memory, per warm instance),
    prompt/HTML size caps. The endpoint spends real money — watch it if the URL spreads.
  - `frame.html` is the full-screen viewer; it re-sandboxes the widget so generated code
    never runs on the lab origin (hence postMessage rather than a blob URL).
- **/honda-acura** — Honda × Acura HTML5 display-ad case study (PB Productions branded).
  Self-contained; `?still` mode for screenshots; og:image must stay an absolute URL.
- **/arcade** — '90s Shockwave/Flash games recovered from the Wayback Machine, played via
  emulation. `player.html?f=<path>&t=<title>` plays anything under `arcade/media/`;
  `&then=<path>` chains a preloader movie into its game (7s handoff).
  - `.dcr` → dirplayer (self-hosted 15MB polyfill at `arcade/vendor/dirplayer-polyfill.js`).
    Quirks: some movies don't paint until first click; some crash the WASM VM (bitmap
    decoder) — player.html shows a graceful message; some throw "Invalid stage property
    picture" (dirplayer hasn't implemented `(the stage).picture`).
  - `.swf` → Ruffle from unpkg CDN, loaded with `openUrlMode:"deny"` because era shells
    call getURL on load and would navigate the page away.
- **/am-1998** — the black-and-white am.com (1997–99) Philip designed; Wayback screenshots.
  The homepage hero was reconstructed: original HTML + the separately-recovered
  `graphics/main/on.gif` (Wayback replay never rendered it).
- **/vault** — screening room (recovered TV spots/films as MP4) + contact sheets of stills
  extracted from Director movies + site-design screenshots + Flash shells with
  `play.html` (same engine rules as arcade).
- **/hello** — the original example.

## The master archive (not in this repo)

`/Users/philipbaker/Desktop/PNG Exports/AM-Wayback-Archive/` — the full Ackerman McQueen
recovery: MANIFEST.md (authoritative catalog + addenda), AM-recovered-media/ (originals,
mp4 conversions, 454 extracted stills in 12-dcr-harvest/, SWA→MP3 soundtracks in
14-swa-audio/), adveractive-recovered/ (CDX listings + game binaries), site-designs/.
Anything on the lab site is a copy; originals live there.

## Recovery tooling that worked

- Wayback CDX API for discovery; download with `https://web.archive.org/web/<TS>id_/<URL>`.
- ProjectorRays (built in scratchpad) decompiles .dcr → Lingo scripts + embedded JPEGs
  (`--dump-chunks --dump-scripts`; grep scripts for URLs/media refs).
- SWA audio = MP3 after a 24-byte header — strip to first 0xFFEx sync.
- Classic-Mac files: `unar` preserves resource forks as xattrs; package for emulators with
  `ditto -c -k --sequesterRsrc` (AppleDouble zip that Infinite Mac restores).
