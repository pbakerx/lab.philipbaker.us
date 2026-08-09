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

`vercel.json` sets `Access-Control-Allow-Origin: *` on `/vault/media/*` so external tools
(e.g. the Infinite Mac emulator) can fetch recovered binaries cross-origin.

## Shared chrome

Every lab page except the full-screen players (`widget-maker/frame.html`,
`vault/player.html`, `vault/play.html`) loads `<script src="/shared/menu.js" defer>`,
which mounts the philipbaker.us hamburger menu.

**It is not a copy.** `api/menu.js` fetches philipbaker.us server-side, parses the links
out of the server-rendered `.drawer-nav`, and extracts the `.hamburger`/`.drawer` rules
plus the Space Grotesk `@font-face` blocks from the stylesheet that page links to. Change
the nav on philipbaker.us and it changes here within the 10-minute CDN cache — no edit in
this repo. It has to run server-side: philipbaker.us sends no CORS headers on its HTML.

- Relative hrefs (`/about`) are rewritten absolute, or they'd 404 on this origin.
- The three custom properties the menu reads (`--ink`, `--drawer-bg`, `--hair`) are set on
  the `#pb-menu` wrapper, not `:root`, so the lab's identically-named vars are untouched.
- The wrapper also restates browser-default typography. The lab root's
  `body{line-height:1.55}` was otherwise inheriting in and spacing the drawer 55px per item
  instead of 53px.
- `menu.js` builds the DOM with `createElement`/`textContent` — the content arrives over
  the network and must never be parsed as markup.
- If the live read fails, a **styled** fallback ships (links + the CSS as it stood when
  written); an unstyled drawer dumped into the page would be worse than no menu. The font
  is deliberately not baked in — those URLs carry a deployment hash that goes stale.

If philipbaker.us ever stops server-rendering that nav, or renames `.drawer-nav`, the sync
degrades to that fallback rather than breaking — check `stale` / `error` in the response.

## Projects

- **/widget-maker** — creative sandbox: type a wish ("a bunch of red balls bouncing
  around", "asteroids", "a rain simulator"), Claude writes a self-contained HTML widget,
  and it runs live in a sandboxed iframe. Iterate by saying what to change; every build
  lands in a version rail you can jump back to. **The favorites gallery is shared** —
  anything a visitor saves is visible to everyone, and is the only persisted state.
  - `api/generate.js` — Vercel Node function. Streams SSE (`delta`/`done`/`error`) from
    `claude-fable-5` at `effort: high` via `@anthropic-ai/sdk`. Fable 5 always thinks (an
    explicit `thinking` config is rejected, so we never send one) and its classifiers can
    decline a request, so `fallbacks: "default"` is on. `maxDuration` is 300s, so wall
    clock isn't the binding constraint — cost is: ~$0.12-0.28 per build at effort `high`
    (2.5k-5.6k output tokens on Fable 5's $10/$50 per MTok), i.e. 4-6 builds per dollar.
    `xhigh`/`max` would cut that to 1-3, so `high` is deliberate. That system
    prompt is the product here: it dictates one complete HTML document, no fences, no
    external resources, no storage APIs (opaque origin — they throw), fill-the-viewport
    + DPI-aware canvas, and "return the whole document again" on iteration.
  - Iteration context is collapsed to `[original wish, current HTML, new instruction]`
    rather than the full transcript — the document already embodies every earlier change.
    Note the assistant turn there is mid-conversation, not a trailing prefill, which is
    what keeps it legal on models that reject prefills.
  - The rail holds *widgets*, each with its own version lineage. "+ New" parks on
    `wi === -1` so the next build starts a fresh lineage without discarding the old ones.
    A group is labelled with its newest version's title (rain that became snow reads
    "Snow"); each row is labelled with the prompt that produced it.
  - `api/favorites.js` + `lib/favorites.js` — the shared gallery, on Vercel Blob (store
    `widget-favorites`, public). **The load-bearing rule: only HTML this server generated
    can be saved.** `/api/generate` HMACs each finished document with
    `WIDGET_MAKER_SECRET` and returns the signature; `/api/favorites` refuses anything
    that doesn't verify, so the gallery can't be used to host arbitrary POSTed HTML.
    Editing one byte invalidates it.
    - The signature covers the *server's* idea of the finished document, so `generate`
      also returns `canonical` — but only when tidying actually changed something, which
      keeps the common case from re-sending the whole file.
    - Blob `list()` returns no custom metadata, so title+prompt ride inside the pathname
      base64url-encoded (`favorites/<b64>.<id>.json`). The gallery is therefore one
      `list()` call, and a widget's HTML is fetched only when a card is opened. Identity
      is `sha256(html)`, so re-saving is a no-op rather than a duplicate.
    - Blobs are stored as `application/json`, not `text/html` — a public blob URL must
      not render user HTML as a page, even on a foreign origin.
    - Card previews mount/unmount on scroll (IntersectionObserver); running every
      favorite at once would be brutal.
  - Moderation: `DELETE /api/favorites?pathname=…` with `x-admin-key`, enabled only if
    `WIDGET_MAKER_ADMIN_KEY` is set. The always-available fallback is the CLI — but pass
    the token explicitly, because a bare `vercel blob …` picks up `VERCEL_OIDC_TOKEN`
    from `.env.local` and dies on "must both be set":
    ```bash
    TOKEN=$(grep '^BLOB_READ_WRITE_TOKEN=' .env.local | cut -d= -f2-)
    npx vercel blob list --rw-token "$TOKEN"
    npx vercel blob del "favorites/<b64>.<id>.json" --rw-token "$TOKEN"
    ```
    Cap is 200 favorites.
  - Needs `ANTHROPIC_API_KEY`, `WIDGET_MAKER_SECRET` and `BLOB_READ_WRITE_TOKEN` in the
    Vercel project env. Optional: `WIDGET_MAKER_PASSCODE` (gates generation),
    `WIDGET_MAKER_ADMIN_KEY`, `WIDGET_MAKER_MODEL`, `WIDGET_MAKER_EFFORT`,
    `WIDGET_MAKER_SPEED`.
  - Guardrails: origin allowlist, 8 req/min per IP (in-memory, per warm instance),
    prompt/HTML size caps. The endpoint spends real money — watch it if the URL spreads.
  - `frame.html` is the full-screen viewer; it re-sandboxes the widget so generated code
    never runs on the lab origin (hence postMessage rather than a blob URL).
- **/honda-acura** — Honda × Acura HTML5 display-ad case study (PB Productions branded).
  Self-contained; `?still` mode for screenshots; og:image must stay an absolute URL.
- **/am-1998** — the black-and-white am.com (1997–99) Philip designed; Wayback screenshots.
  The homepage hero was reconstructed: original HTML + the separately-recovered
  `graphics/main/on.gif` (Wayback replay never rendered it).
  - **The Screening Room** at the bottom (under the closing note) holds the 14 recovered
    TV spots and venue films. Philip did **not** produce these — they're agency work from
    the same years, and the page says so. The files still live in `vault/movies/`, so the
    references are absolute (`/vault/movies/…`).
- **/vault** — "The Vault": the '90s Shockwave/Flash games plus the few non-game pieces
  worth keeping. This absorbed the old **/arcade** in Aug 2026; `vercel.json` permanently
  redirects `/arcade/:path*` → `/vault/:path*`, so old links still work.
  - `player.html?f=<path>&t=<title>` plays anything under `vault/media/`; `&then=<path>`
    chains a preloader movie into its game (7s handoff). `play.html?f=<file>` plays the
    Six Flags shells out of `vault/shells/`.
  - `.dcr` → dirplayer (self-hosted 15MB polyfill at `vault/vendor/dirplayer-polyfill.js`).
    Quirks: some movies don't paint until first click; some crash the WASM VM (bitmap
    decoder) — player.html shows a graceful message; some throw "Invalid stage property
    picture" (dirplayer hasn't implemented `(the stage).picture`). The `xtra-registry.json`
    and `ruffle/dirplayer_ruffle.js` 404s are dirplayer probing for optional extras and
    have always been there.
  - `.swf` → Ruffle from unpkg CDN, loaded with `openUrlMode:"deny"` because era shells
    call getURL on load and would navigate the page away.
  - What survived the Aug 2026 cull: the 10 games, the 5 Six Flags shells, the three
    office contact sheets (120 stills), and Speed Zone at full quality. Gone: the other
    22 contact sheets, the site-design screenshots, the NRALive/WilTel shells (the WilTel
    games survive as game cards). The screening room moved to **/am-1998**. Everything
    removed is still in git history and in the master archive.
  - Office stills are sprite strips up to 2500px wide; `.sheet-grid img` caps them with
    `max-width:100%` + `object-fit:cover` or they drag the page into horizontal scroll.
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
