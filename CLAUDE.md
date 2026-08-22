# lab — lab.philipbaker.us

One-off static projects, FTP-style. **Each top-level folder = a path on lab.philipbaker.us.**
Drop a folder with an `index.html`, deploy, done. Curated by Philip; keep the root index
(`index.html`) list **and `sitemap.xml`** in sync when adding/removing a project — except
**unlisted client links** (see `/AcrobatAnt-HNDACR-Fall-Digital`), which are deliberately
on neither and shared by URL only.

`robots.txt` points crawlers at `sitemap.xml` and disallows `/api/` plus the three
full-screen players (they're plumbing, not pages). A new project page wants, at minimum, a
unique `<title>`, a `<meta name="description">`, an absolute `<link rel="canonical">`, and
og/twitter tags with an absolute `og:image` — `/second-brain-case-study` is the fullest
example and is the only page carrying JSON-LD.

`.claude/seo-check.sh` checks all of that mechanically against a live URL — no arguments
walks every `<loc>` in the sitemap; a path argument checks one page. It fetches the
`og:image` too, so an absolute URL that 404s gets caught. Point it at a local `vercel dev`
with `BASE=http://localhost:8902` (the two `og:image` checks will fail there by design —
they're absolute production URLs).

Two launch configs: `lab-static` (python http.server, layout only) and `lab-vercel`
(`vercel dev`, the one that actually runs `api/menu.js` so the real hamburger mounts). The
Browser pane doesn't fire `loading="lazy"`, and it blanks out on very tall pages — render
proof shots with `Google Chrome --headless --window-size=W,H --screenshot=…` instead.

Mostly static — `/api/*.js` are Vercel Node serverless functions (see /widget-maker). The
root `package.json` exists only so Vercel installs their deps; there is no build step, and
`vercel.json` pins `"framework": null` to keep it that way.

## Deploy

**Pushing to `main` deploys to production.** The Vercel project has been connected to
`pbakerx/lab.philipbaker.us` (Aug 10 2026), so git and production are no longer
independent — a push is a deploy, and anything committed goes live. The repo is public;
that is now also the deploy path, so treat a commit as publication.

To deploy without pushing — or to ship uncommitted working-tree edits:

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
  - **Post to social** (Aug 21 2026) — the button beside Download gives a widget its
    own page at `/widget-maker/w/<id>` and a link to paste into a post. `api/widget.js`
    renders that page server-side (a `vercel.json` rewrite maps the pretty URL to
    `/api/widget?id=`) with og/twitter tags so the post unfurls into a card, and runs
    the favorite in a sandboxed iframe fetched from its blob — same rule as everywhere:
    generated code never runs on the lab origin. **Only favorites are shareable** — they
    are the one persisted, signature-checked set — so the button saves the widget first
    if it isn't one yet, which also means sharing puts it in the public gallery.
    - The card image is a photograph of the running widget: a tiny listener rides along
      in the *preview copy only* (`withHook` — never `v.html`, which the signature
      covers) and answers a postMessage with the biggest canvas as JPEG; the page fits
      it to 1200×630 and `POST /api/widget {id, snapshot}` stores it at
      `shots/<id>.<hash8>.jpg` (content-hashed so a replacement never hides behind the
      CDN cache of the old URL). First card in wins; JPEG magic bytes, ≤600 KB, and the
      id must already be a favorite — so it can't host arbitrary images. A flat frame
      (WebGL without `preserveDrawingBuffer`, or caught between clear and draw) is
      detected client-side and not sent; widgets with no canvas fall back to the
      generic `widget-maker/img/og.png`.
    - Share links are pinned to `https://lab.philipbaker.us` (except on localhost), so a
      preview deployment never hands out URLs nobody can open. The share page's
      "Remix it" goes to `/widget-maker/#w=<id>`, which opens that favorite into the
      rail once and drops the hash.
    - Share pages are `noindex` (user-generated) but deliberately **not** in
      `robots.txt` — Facebook/LinkedIn honour Disallow and would then get no card.
    - `lib/guard.js` holds the origin check + rate limiter both endpoints share.
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
- **/ai-solves-billing** — case study on the AI billing workflow (spoken timesheets → QBO
  invoices). Shipped briefly as `/billing`; `vercel.json` keeps that path redirecting.
  Single self-contained `index.html`, no local assets. **Deliberately carries no real
  financial data**: no client names, no rates, no markup detail, no A/R table, no revenue
  figures. The invoice is labelled an example with its figures struck, and the footer says
  so. Philip's call — keep it that way when editing. The unredacted original lives at
  `~/Documents/Client Work/pb/Lab/billing-case-study/index.html` (that original still has the real numbers).
- **/second-brain-case-study** — case study on the Second Brain: ten scattered places folded into one
  page you can talk to. Aimed at other operators, ends in a consulting CTA. Companion to
  `/ai-solves-billing` (they cross-link); don't let the two repeat each other.
  - Built in the **private** `~/Software Development/SecondBrain/case-study/` repo, which
    holds real client names, invoice numbers and receivable balances. Only this folder is
    public. **Everything here is already sanitized and must stay that way**: every client
    name in the screenshots is invented, every dollar figure is `$123.45` on purpose, and a
    caption says so. Do not re-shoot the screens against the live brain and do not make the
    numbers "more realistic" — earlier passes leaked through page *filenames* and a form
    placeholder, then through the prose. Grep the copy, not just the images.
  - **The numbers are load-bearing.** "Ten places" appears in the hero, a stat tile, the CTA
    and a ten-row table — edit the table and fix all four. "Zero new subscriptions" is a
    claim about replacement and lock-in, not cost; Vercel, the Anthropic API and ElevenLabs
    are all metered, so never upgrade it to "free". There is deliberately no ROI figure.
  - `img/og.png` is a generated 1200×630 social card, not a screenshot — regenerate it if
    the headline changes. The four screenshots carry intrinsic `width`/`height` so the
    stacked layout doesn't shift while they load.
  - **`/second-brain` is NOT this page and must not be taken over.** It redirects to
    `https://brain-site-tan.vercel.app/` — Philip's live Second Brain, password-gated on
    purpose. He uses that link from the lab list daily to reach the app. Those two redirect
    rules in `vercel.json` are load-bearing; leave them alone. They were once uncommitted
    (working tree only, deployed by hand) and got destroyed by a `git add -A`, so they are
    committed now precisely so a push can't drop them again.
  - **`/mind-harvest` is a DIFFERENT app** (added Aug 14 2026) — it redirects to
    `https://x-expert-poster.vercel.app/`, the story bank, which has its own password
    (`STORY_USER`/`STORY_PASSWORD`, not the brain's). Same treatment as the rules above:
    load-bearing, both bare and trailing-slash forms, hands off. It briefly pointed at the
    Second Brain on the day it was added; the two are separate apps and the names must not
    be allowed to blur again.
  - Neither `/second-brain` nor `/mind-harvest` belongs in `sitemap.xml`. That file lists
    real crawlable pages, and a redirect into a password gate is a dead end for a crawler.
  - `/ai-second-brain-case-study/*` (the staging folder's name) redirects here.
- **/90s-web-ackerman-mcqueen** — the black-and-white am.com (1997–99) Philip designed; Wayback screenshots.
  The homepage hero was reconstructed: original HTML + the separately-recovered
  `graphics/main/on.gif` (Wayback replay never rendered it).
  - The page opens on the homepage screenshot, then **the collage** (`hero/*.gif`) — the
    eleven navigation widgets from the original site, the actual interface rather than
    pictures of it. Square cells with percentage padding: the faces run both landscape
    (316x199) and portrait (200x249), and a fixed pixel inset starved the tall ones.
  - Aug 2026: the section screenshots are **all** gone — The Front Door, Capabilities,
    The Agency and The Clients emptied out and their headings went with them, so `img/`
    holds only the masthead now. What's left is the collage, the offices, the closing
    note and the reel. Everything removed is still in git history and in the master
    archive.
  - **The Offices** (before the closing note) holds 17 photographs decompiled out of the
    am.com Shockwave movies. The source had 40 frames repeated across three identically-
    named directories (byte-identical — the "three offices" were one set shown thrice);
    23 of those were text banners, rules and gradients, so only the actual building
    exteriors and interiors were kept.
  - **The Screening Room** at the bottom (under the closing note) holds the five
    Oklahoma Tourism spots. Philip did **not** produce these — they're agency work from
    the same years, and the page says so. The files live in `vault/movies/`, so the
    references are absolute (`/vault/movies/…`). The Speed Zone, Tulsa Convention Center
    and OG&E films were cut in Aug 2026; only `brunswick_video_SpeedZone_HIGH.mp4`
    survives, because the Vault still plays it.
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
  - After the Aug 2026 cull: 7 games, 4 Six Flags shells, Speed Zone at full quality.
    Gone: all 25 contact sheets, the site-design screenshots, the NRALive/WilTel shells,
    the DNA Pinball, Winner-with-Vyvx and Shockwave Bowling cards, and the Six Flags
    park template 2002.
    The screening room and the offices both moved to **/90s-web-ackerman-mcqueen**. Everything removed is
    still in git history and in the master archive.
  - **Card artwork is opt-in by file.** Each game card carries `data-shot="<slug>"`; an
    inline script probes `vault/shots/<slug>.jpg` with `new Image()` and only inserts an
    `<img>` if it loads, so a missing shot leaves no broken-image box. Drop a file in and
    the card dresses itself — no markup change. Slugs: `virtual-boomerang`,
    `darien-lake-97`, `virtual-bowling`, `attitude-arena`, `zone-pilot`, `alien-maze`,
    `brunswick-consumer-site`.
  - All seven are filled (Philip captured them in a real browser, Aug 2026). The
    Shockwave Bowling card was dropped; `media/08-adveractive/bowling_bowl7.dcr` stays in
    the archive, and that folder is still needed by Attitude Arena.
  - **Capturing these needs a real browser — don't retry it from here.** In a
    headless/hidden pane `rAF` never ticks, so dirplayer (all the `.dcr` games) never
    paints; the canvas reads 0 non-black pixels even after load, click and a 20s wait.
    Ruffle (`.swf`) *does* render on screen but its WebGL context is
    `preserveDrawingBuffer:false`, so `drawImage`/`toDataURL` read back blank. The
    decompile harvest has no game frames either. Screenshot in a normal browser window.
- **/paste-plain** — PlainPaste, a macOS menu bar app (Swift/AppKit, single file):
  ⌃⌘V pastes the clipboard as plain text anywhere; the menu's Scrub Clipboard strips
  formatting in place. Branded AechTech, LLC (About box + page credit).
  - `build.sh` compiles a universal binary and produces `PlainPaste.zip`; **that committed
    zip is the download the page serves** — rebuild and re-commit it whenever `src/`
    changes.
  - The hotkey is a **CGEvent tap**, not Carbon `RegisterEventHotKey` — Carbon silently
    delivered nothing on this machine (both app and dispatcher event targets tried).
    The tap needs Accessibility; the app prompts at launch and polls until granted.
  - **Ad-hoc signed, so every rebuild invalidates the Accessibility grant** (Settings
    shows it on but macOS re-prompts and denies). Fix:
    `tccutil reset Accessibility us.philipbaker.plainpaste`, reinstall to /Applications,
    re-grant. A stable Developer ID signature (planned, via the AechTech Apple account)
    will end this.
  - Logs to `~/Library/Logs/PlainPaste.log` (unified log is useless for ad-hoc apps).
    Scriptable scrub: `notifyutil -p us.philipbaker.plainpaste.scrub`.
- **/AcrobatAnt-HNDACR-Fall-Digital** — **unlisted client link** for AcrobatAnt: the
  Honda × Acura Fall 2026 seasonal HTML5 display ads, presented for client review.
  12 ads (HND/ACR × Creative A "Passport" / B "Fall Rush" × 728×90, 160×600, 320×50), six
  storyboard renders, a timeline scrubber, and a Dealer pulldown. **Not on the root index
  and not in `sitemap.xml` — on purpose.** Don't "fix" that; the URL is handed to the client
  directly.
  - **It's a drop-in package built elsewhere** (Philip's production ad pipeline), not
    authored here. It arrives as `hnd-acr-fall-v1.zip` on the NAS share `/Volumes/Public`.
    Deploy routine: unzip to the scratchpad → `diff -rq` against the folder (know what's
    changing before it ships) → `rsync -a --delete --exclude .DS_Store --exclude __MACOSX
    --exclude '._*'` the zip's `hnd-acr-fall-v1/` over the folder → commit → push. Keep the
    `ads/<UNIT>/` structure intact. The package's own `README.md` suggests a
    `philipbaker.us/lab/honda-acura-fall-v1/` install path — ignore that; here the folder
    name is the URL. Quirks of the share: an overwritten zip sometimes lands in
    `/Volumes/Public/#Recycle` (look there if the root is empty — the newest copy is the
    one), and a copy in flight needs its size to settle before unzipping.
  - The page loads each ad into an iframe via `srcdoc` with an injected `<base>` so one set
    of images serves every dealer (`template.html` per ad, `{{DEALER_NAME}}` etc.
    substituted client-side; `index.html` per ad is the board-dealer fallback). Chrome's
    preload scanner prefetches `ad-player.js`/`leaf-engine.js` against the *page* base first
    (two 404s per dealer change) before the real base-relative loads succeed. Cosmetic —
    not a bug, don't chase it.
  - `dealers.js` is the real production dealer feed (687 Honda / 189 Acura — public
    dealership names + feed ids). It's in this public repo; flagged to Philip at deploy.
  - Versions shipped (Aug 16–21 2026): v1 package → v2 slate theme + scrubber driving the
    ads' `__adSeek` → v3 asset-preload gate in all 12 ads → v4 dealer pulldown with full
    feeds → v5 `?v=` cache-bust on script URLs → v6 static first-paint CSS, engine reuses the
    gated images, display-weight art (pushed from another session). Each was a diff-checked
    zip replacement; the ads' runtime is theirs, the presentation page is theirs too.
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
