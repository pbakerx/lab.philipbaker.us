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
(`--headless=new` writes the screenshot and then never exits: background it, wait for the
file, `pkill` it by its `--user-data-dir`.)

**On the Mac mini neither launch config starts** (found Sep 18 2026). It has no Node, so
`lab-vercel` is out — and `npx vercel --prod` with it, so from that Mac a deploy is a push.
And a process started by the preview tool is refused *every* read on the NAS volume, not
just `os.getcwd()`: a zero-dependency server script placed in this repo — at the root or in
`.claude/` — dies with "can't open file … Operation not permitted". What works: `rsync` the
folders under test to the session scratchpad and add a **temporary** launch entry that runs a
scratchpad server script over that mirror (`/usr/bin/python3 -I <script> <mirror> <port>`),
then take **your own entry** back out. Do NOT `git checkout -- .claude/launch.json` to do it: that restores the whole
file, and when two sessions share this working copy (Sep 19 2026: City Run and Maze Wars did) it silently erases
the other session's temporary entry too. Have that script pass GET `/api/menu` through to
production and the real hamburger mounts; proxy nothing else under `/api/` (generate spends
money, the rest write shared state). Re-`rsync` after every edit — it is a copy.
A hidden pane reports `document.hidden === true` and throttles frames between tool calls;
anything that pauses when hidden needs that shimmed for the test. Its synthetic key events
carry an empty `e.code` (and an empty `key` for Space), and never trigger the browser's native
"Enter/Space clicks the focused button". When the pane is *displayed*, Philip can click in it
too — unexplained input is probably him, not a bug. Test in a background tab.

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

**Two sessions, one checkout.** Philip often has more than one Claude session working in this
repo at once, and they share this folder — so they share one branch, one index and one HEAD.
Do **not** create or switch branches here while another session may be active: it would move the
other session onto your branch mid-work. Projects are isolated by folder instead. Commit only your
own paths (`git add <paths>` then `git commit -m … -- <paths>`; never `git add -A` or `commit -a`),
check `git --no-optional-locks status` first, and make edits to the shared files (`index.html`,
`sitemap.xml`, `vercel.json`, `.gitignore`, this file) at the last moment, committing them in the
same breath so they never sit modified in a tree someone else is about to commit from. While a
project is unfinished, a line in `.git/info/exclude` keeps it out of other sessions' sweeps.

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

**Verifying a nav change** (learned Sep 18 2026, when AechTech and Catapult Creative joined
the menu): the nav lives in `app/components/Menu.tsx` on the **`main`** branch of
`pbakerx/philipbaker` — not `redesign`, whose Menu is the brand engine's shared one. The
apex 308s to `www.philipbaker.us`, so probe with `curl -L`; without it you poll an empty
redirect body and conclude the deploy failed. Then `/api/menu` here is `s-maxage=600` with
stale-while-revalidate: the first request past ten minutes still returns the OLD list
(`x-vercel-cache: STALE`) and triggers the refresh — ask again 20 seconds later. Read the
cache headers off the GET itself; a separate HEAD is cached separately and misleads. Keep
`FALLBACK.links` in `api/menu.js` in step by hand.

**Vercel Web Analytics** (added Sep 9 2026): every page-level HTML file carries
`<script defer src="/_vercel/insights/script.js"></script>` just before `</head>`
(not `widget-maker/frame.html`, which is an embedded iframe, and not the individual ad
creatives). The script is served by Vercel only once Web Analytics is switched on for the
`lab` project in the dashboard (Project → Analytics → Enable); until then it 404s.
**It was never switched on.** Checked Sep 19 2026, in a browser and with curl:
`/_vercel/insights/script.js` answered 404 on every page, so from Sep 9 to Sep 19 the tag
was on the whole site and the site collected nothing. "404s harmlessly" was the wrong word —
harmless to the page, fatal to the measurement. `.claude/seo-check.sh` now gates on it.
New pages must include the tag, and a re-dropped zip package
(`AcrobatAnt-HNDACR-Fall-Digital`, `OKEII-SRA-Deployment`) will need it re-added to its
`index.html`. Page views are per path, so the dashboard answers "did anyone open
/honda-acura" — the question that was unanswerable before this was added.

## Analytics and SEO

Built Sep 19 2026 against `00. Technical Notes/Analytics and SEO for a Client Site.md`.
Read that note before touching any of this. The short version of its discipline: install in
one place, and never call something installed until you have watched it work on production.

**Two scripts own the mechanical parts. Do not hand-edit what they generate.**

| Script | Owns |
|---|---|
| `scripts/head-meta.py` | Two sentinel blocks in the `<head>` of every swept page: **`ga`** (the GA4 tag, `<!-- GA4:START -->`…`<!-- GA4:END -->`) and **`events`** (`<script src="/shared/analytics.js" defer>`, `<!-- LAB-EVENTS:START -->`…`<!-- LAB-EVENTS:END -->`). `<block> add|remove|status`, plus bare `status` for both and `pages` for the set. Idempotent, atomic, no line-ending translation. `pages` prints the swept set **and** every deliberate omission with its reason. |
| `scripts/build-sitemap.py` | `sitemap.xml`, derived from the pages' own `<link rel="canonical">`. `--list` / `--check` / `--write`. |
| `shared/analytics.js` | What the lab counts beyond page views — see "Events" below. |

`build-sitemap.py`'s rule is the whole opt-out mechanism: **a page is in the sitemap iff it
declares a canonical and does not declare `noindex`.** There is no exception list. A page
stays out by not having a canonical (`hello/index.html`, `vault/player.html`,
`vault/play.html`) or by saying `noindex` (`honda-acura`, the two client boards,
`widget-maker/frame.html`). So adding a canonical to a page *is* adding it to the sitemap —
which is what restored `/vault`, `/widget-maker`, `/staplegun`, `/paste-plain`,
`/ai-solves-billing` and `/90s-web-ackerman-mcqueen` to canonical-backed status. Before that
pass only 5 of the 11 hand-written sitemap entries had a canonical behind them.

**`.claude/seo-check.sh` is the gate.** No arguments walks every `<loc>` in the live sitemap;
a path argument checks one page. Beyond the per-page tags it now checks `llms.txt`, that an
unknown path returns a real 404 *and* serves the custom page rather than Vercel's 79-byte
default, that the Vercel Insights script actually loads, and that no named crawler group in
`robots.txt` bypasses the wildcard's Disallow lines.

**The `robots.txt` trap, learned by writing the bug and catching it before it shipped:** a
named `User-agent:` group **replaces** the wildcard group for that crawler — it does not add
to it. A well-meant block of `User-agent: GPTBot` / `Allow: /` therefore takes GPTBot *out*
of the wildcard group and hands it `/api/`, and `/api/generate` spends real money per call.
So the AI-crawler welcome is a comment, not a group. The only two named groups are
`Google-Extended` and `Applebot-Extended`, which are training-opt-out tokens rather than
crawlers and have no crawl paths to protect. `seo-check.sh` enforces this.

**`llms.txt`** describes the site to AI assistants in prose. Every sentence in it is
verifiable against the page it describes — the note's hardest rule, and the one that
caught four claims in the first draft which had been lifted from *this file* rather than
from the pages (a widget count, a photograph count, a framebuffer size, and an attribution).
When you edit a page, re-check the llms.txt paragraph about it. Grep the page, not your
memory of it.

**JSON-LD** is on every public page, in the `@graph` + `@id` + `BreadcrumbList` house style
that `second-brain-case-study` established. Types: `VideoGame` for the three game pages
(`maze-wars` carries `playMode: [SinglePlayer, MultiPlayer]`, the others `SinglePlayer`),
`CollectionPage` + an `ItemList` of `VideoGame`s for `/vault`, `WebApplication` for
`/widget-maker`, `SoftwareApplication` for `/paste-plain`, `Article` for the two case
studies, `WebPage` for the two archive pages, and `WebSite` + `Person` + `CollectionPage` on
the root. The `Person` node (`#philip`) is the entity that name searches match against;
every other page's author points at its `@id`. Dates come from `git log`, not file mtimes.

**Events — `shared/analytics.js`** (Sep 21 2026). Philip asked whether clicks from the
landing page were tracked, and whether "a case study got a link on this page" was
answerable. It was not: **GA4's enhanced measurement sends `click` for OUTBOUND links
only.** An internal click is not collected at all, so the only evidence a project got
opened was a later `page_view` you had to attribute by hand from `page_referrer`. One file,
swept in as the `events` block, sends:

- `select_item` on every **same-origin** link click — `items[0].item_id` is the destination
  path, `item_name` the link's own text, and `item_list_name` **the page it was clicked
  from**, which is the dimension that answers the question. Cross-origin links are
  deliberately skipped: GA4 already sends `click` for those and ours would double-count.
- `view_item_list` once on the home page, so a click has an impression to be a rate of.
- `game_start` — the two Missile Commands call `window.pbTrack` from their own `startGame()`
  (which every route in passes through: START, RESTART, PLAY AGAIN), and **the Vault's two
  players report it from `analytics.js` itself**, off the `?f=`/`?t=` query string. That
  counts the game that actually loaded rather than a click on a card, and it is why
  `vault/player.html` and `vault/play.html` have to be in the swept set.

It also closed two blind spots as a side effect: `/second-brain` and `/mind-harvest` are
internal hrefs that redirect to other sites, so no outbound click fired and the destination
carries none of our tags — nobody could tell whether either link had ever been used.

The file loads on pages that are games, so: it never throws (every call wrapped; `gtag` is
legitimately absent behind an ad blocker), never calls `preventDefault` or
`stopPropagation`, adds no DOM and draws nothing (so `?shot=1` hashes the same), and
defines exactly one global. Each game's call is `window.pbTrack && window.pbTrack(…)`, so
a missing file is a no-op.

**`/maze-wars` is deliberately excluded from the events block** — Philip, Sep 21 2026:
no edits to the Maze Wars game, **at all**. It keeps the GA4 tag and reports page views like
every other page; it reports no `select_item` and no `game_start`. `head-meta.py` carries
that as a per-block `skip` with the reason attached, so `events add` prints "not swept"
rather than quietly putting it back. **Do not "fix" it.** The earlier attempt touched
`js/game.js` and bumped the `?v=` stamps; both were reverted and `cmp`-verified
byte-identical, and `git diff 944ca83 -- maze-wars/` came back empty.

**Verifying a custom event** is not the same as verifying the tag, and the Browser pane
actively misleads here — its network log shows **same-origin requests only**, and
`PerformanceResourceTiming.responseStatus` is **0** for a cross-origin resource without
`Timing-Allow-Origin` (Google sends none). Read the beacon out of the page instead:
`performance.getEntriesByType('resource').filter(e => /g\/collect/.test(e.name))` — `en=`
is the event name and the `pr1…prN` parameters spell out the `items` array. To exercise a
click handler without navigating away, add a **capture-phase** `preventDefault`: capture
runs first and cancels the navigation, but propagation continues, so the real bubble-phase
handler still runs.

**Social cards.** Sources in `.claude/og-cards/*.html`, rendered with headless Chrome at
`--window-size=1200,630 --force-device-scale-factor=1` — see the `--headless=new` never-exits
gotcha near the top of this file. `/vault`, `/paste-plain`, `/ai-solves-billing`,
`/staplegun` and `/90s-web-ackerman-mcqueen` had no card at all before Sep 19 2026. The
`90s-web` card's first pass used the recovered homepage screenshot and read as an empty black
box — that page is genuinely black with tiny white type, so it is illegible at card size; it
uses the recovered `hero/` navigation widgets instead. **Look at a card before shipping it.**

**`AcrobatAnt-HNDACR-Fall-Digital/index.html` carries `noindex, nofollow`** as of Sep 19
2026 — it had none, while the OKEII board did, and it presents unreleased client creative
from a public repo. Like the Insights tag, **a re-dropped zip package will wipe it**; re-add
both after every drop.

### Still owed — needs a browser and Philip's Google account

Claude cannot create Google properties or sign in, so these four are his:

1. ~~**GA4**~~ — **done Sep 19 2026. Measurement ID `G-X8JTH9PN21`** (not a secret),
   installed on all 16 swept pages by `scripts/head-meta.py`. The tag config carries
   `allow_google_signals:false` and `allow_ad_personalization_signals:false`, which the
   stock snippet Google hands you does not. **Record here when known:** account / property /
   stream ids, which Google identity owns the account, and who else is an admin.
   Still to confirm in the GA UI: Google Signals **off** and data retention **14 months**.
2. ~~**Vercel Web Analytics**~~ — **done Sep 19 2026.** `/_vercel/insights/script.js` now
   answers 200 and a page load POSTs `/_vercel/insights/view` → 200, both seen in a browser.
3. **Search Console** — a **URL-prefix** property for `https://lab.philipbaker.us`, signed in
   as the same Google account that owns the GA property, which lets it auto-verify off the GA
   tag. This is the only thing that reports the actual search queries, which is the whole
   point of the exercise.
4. **Vercel Firewall → Bot Protection / AI bots** — read the setting. `robots.txt` is a
   request; that switch is the enforcement. If it blocks AI crawlers then `llms.txt` and the
   welcome comment mean nothing.

**Record here when done:** GA account / property / stream ids, the measurement ID (not a
secret), who owns the account and who is an admin, and the Search Console property. Then
**re-read Search Console in about four weeks** — nothing before that is an honest
measurement — and check Crawl stats → By response for a 403 share, which would mean the
firewall is challenging crawlers.

### Verifying an analytics claim

Never write "analytics is installed" off a grep of the repo. The tag being present and the
tag working are different facts, and this site spent ten days proving it. In order:

```bash
.claude/seo-check.sh                      # every sitemap URL + the root files
curl -s https://lab.philipbaker.us/ | grep -o -E 'G-[A-Z0-9]{6,}' | sort -u
```

Then, in a **clean browser profile** (ad blockers block GA outright), open a live page with
DevTools → Network filtered to `collect`: a POST to `google-analytics.com/g/collect` should
leave the page and come back `204`. Then see the row in GA → Realtime. Only that path
notices a CSP block or a consent gate. A brand-new GA property can answer `503` for a while,
so if it does, re-check the next day rather than concluding it is broken — and do not say
"collecting" until a Realtime row has been seen.

**Two traps found doing exactly this on Sep 19 2026.** The Browser pane's
`read_network_requests` shows **only same-origin requests**, so GA looks completely absent
there even while it is firing. And `PerformanceResourceTiming.responseStatus` reads **0** for
a cross-origin resource unless the server sends `Timing-Allow-Origin`, which Google does not
— so the page cannot tell you the beacon's status either. What does work, from the page:

```js
performance.getEntriesByType('resource').filter(e => /google/.test(e.name))
```

That shows `googletagmanager.com/gtag/js?id=…` loaded and each `g/collect` call with its
`tid=` and `en=` (event name) in the query string. `npa=1` there confirms
`allow_ad_personalization_signals:false` reached the tag. Verified this way on Sep 19 2026:
`gtag` a function, `dataLayer` populated, and `page_view` plus `scroll` beacons for
`tid=G-X8JTH9PN21`. A shell POST to the collect endpoint returned **204, not 503**, so the
property is provisioned — but note the endpoint accepts a made-up ID too, so that only rules
out a 503. **A Realtime row has still not been seen; that needs Philip's GA login.**

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
    - **The card plays** (Aug 22 2026). The share page is a *player* card
      (`twitter:card=player` + `og:video`, both pointing at `/widget-maker/w/<id>?player=1`
      — the same handler stripped to nothing but the running widget and a corner badge;
      the rewrite forwards the query). On X the snapshot gets a ▶ and tapping it runs the
      live widget in the timeline. Nothing about this is stored — same blob, same
      signature rules. X caches card metadata per URL, so links posted before a widget's
      card changed keep their old unfurl. Note X never *autoplays* card content —
      only media attached to the post — which is why the clip exists:
    - **The clip.** The share dialog can record ~6s of the widget via the same preview
      hook that takes the snapshot (`pb-clip`: `canvas.captureStream` + `MediaRecorder`
      inside the sandboxed frame, answered as a Blob — works on WebGL widgets whose
      `toDataURL` reads blank). The dialog closes while it records so the footage is the
      user actually driving the widget, then offers the file to attach to the post —
      attached video is the one thing timelines autoplay. Client-side only: the clip is
      never uploaded, so no new server surface. MP4 (`avc1` preferred) where the browser
      can encode it, `.webm` elsewhere with a "X only takes .mp4" caveat in the note.
      Where the Web Share API takes files (phones), the button is **Share clip** — the OS
      share sheet gets the video plus the dialog's editable "Your post" text (which also
      rebuilds the X/Threads/Bluesky intent links on every keystroke; LinkedIn/Facebook
      only accept a URL). Download and Record-again stay as note links; desktop without
      file-share keeps the old Download button. Born of a real phone test: a browser
      "download" lands in the Files app, not Photos, and nobody finds it there.
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
- **/OKEII-SRA-Deployment** — **unlisted client link** for OKEII: the deployment board for
  the Strong Readers Act (SB 1778) implementation campaign. Every deliverable in the
  approved media mix laid out against the schedule it has to hit, with a placeholder for
  each size a vendor actually asked for — 15 channels, 124 placeholders. Drag a file onto a
  placeholder and it becomes that slot's current version; the file it replaced stays in the
  slot's history. **Not on the root index and not in `sitemap.xml`, and the page carries
  `noindex`** — the creative on it hasn't run yet. Don't "fix" any of that.
  - **Source of truth is the NAS**, not here: `02. Project Files/Oklahoma Education Impact
    Initiative/SRA_Implementation_Plan/Deployment Package/site/`. Its `scripts/deploy-lab.sh`
    mirrors `site/page/` into this folder and copies `site/api/okeii.js` + `site/lib/okeii.js`
    to the repo root. Edit there, deploy from there — a hand-edit here forks from what the
    build produces.
  - `catalog.json` is **the plan** and ships with the page: channels, deliverables, and one
    slot per vendor-specified size, each carrying the `source` it was derived from. Channels
    whose spec sheets are still email attachments are flagged `specStatus: "not_captured"`
    and deliberately carry **no** dimensions — don't add plausible ones, that flag is the
    point. Rebuild it with `scripts/build-catalog.py`; the corrections applied to it, and
    why, are in `site/build/patches.json`.
  - `api/okeii.js` + `lib/okeii.js` are **the state**, on Vercel Blob under `okeii-sra/`:
    `state.json` is one manifest of every slot's version history, files live at
    `f/<slot>/<name>` with a random suffix (the store is public, so a guessable pathname
    would be a guessable URL for unreleased creative). Writes to the manifest are
    ETag-conditional — two people dropping at once must not silently erase each other.
  - **Uploads over ~3 MB go multipart**, a slice at a time through `begin`/`part`/`finish`.
    That is not premature: the campaign's :15 renders out at ~50 MB and cannot clear the
    4.5 MB Serverless Function body limit in one request. A base64 fallback exists for the
    slice path because raw-body handling is the one thing there that isn't ours to
    guarantee.
  - **Two write tiers.** Dropping a version, rolling back to an earlier one, and editing a
    note are open when `OKEII_REVIEW_KEY` is unset and key-gated when it is set. **Deleting**
    a version — the only action that can lose something — always requires the key, so an
    unkeyed visitor can never take anything out of a slot's history. Rolling back is
    deliberately NOT in the hard tier: it is reversible, and gating it behind a key nobody
    had set would have meant the board couldn't be rolled back at all. Set the key in the
    Vercel project env and **redeploy** — env vars are snapshotted into a deployment.
  - `.html` and `.svg` are refused on upload. Same rule as the widget gallery: nothing a
    browser executes as a document goes into a public blob store.
  - **The repo is public and this is a live client campaign.** `catalog.json` deliberately
    omits `contacts.json` (mobile numbers, personal addresses) and the internal
    open-commitments notes, and softens three schedule entries that quoted private email
    verbatim. Those originals stay on the NAS. Keep it that way when regenerating.

- **/missile-command** — one-file tribute to the 1980 arcade game (Sep 18 2026). Canvas, no
  assets, no build. Philip made it phone-only; the desktop layer was added on top, and on a
  phone it must stay exactly as he made it (same wording, same rotate gate).
  - **The desktop controls are the cabinet's.** The mouse is the trackball: a click (or
    Space) fires using AUTO or the locked base. `1 2 3` / `A S D` are the three fire buttons —
    each launches from its own base at the pointer. The asymmetry is deliberate: the on-screen
    ALPHA/DELTA/OMEGA buttons *lock* a base, the keys *fire* from one. Keys match `e.code`
    first (physical position, so the row works on any layout) and fall back to the character,
    because on-screen keyboards and remote desktops send an empty `code`. Auto-repeat is
    ignored so a held key can't empty a base. P/Esc pause, M sound, F fullscreen — fullscreen
    on START is phones only.
  - **Only a phone or tablet held upright is gated.** `isMobile()` (touch points + UA) picks
    the wording and the gate; a desktop window of any shape plays, letterboxed. The old
    desktop gate carried a COPY ALL HTML button — gone with the gate, it had no way to appear.
  - Pointer position is tracked on `window` (`pointermove` *and* `pointerdown`), not the
    canvas: a panel covers the canvas between waves, and automated or remote clicks can land
    without a move.
  - Panels hand focus to their `.primary` button as they open (a MutationObserver on
    `#menu`) **and blur it as they close** — not every browser blurs a button that just went
    `display:none`, and Space on a hidden, still-focused WAVE button would skip a wave.
    Don't hand-roll Enter on a focused button either: a browser that failed to suppress the
    native activation would fire WAVE twice. Typed initials come first in the key handler,
    because A, S, D, P, M and F are letters too.
  - **Shared chrome.** The hamburger's stock spot (`top:26px; right:28px`) is the PAUSE
    button here, so the page seats it in the HUD (`#hud` reserves the room with
    padding-right) and lets the drawer scroll — its content outgrows a phone held sideways,
    more so as philipbaker.us adds links. The game's `button` and `p` rules are scoped with
    `:where(#app)`: zero specificity, so the cascade inside the game is unchanged, but they
    stop restyling the menu's own buttons. A click anywhere in `#pb-menu` pauses the game,
    and the game's keys stand down while the drawer is open (Esc closes it, stays paused).
  - **Sound on iPhone (Sep 19 2026).** The game was silent on iPhones in Silent Mode: a page that
    only uses Web Audio gets iOS's *ambient* audio session, which the ring switch mutes while
    `audio.state` still reads "running". On iOS only, one detached, looping, silent, **unmuted**
    `<audio>` element (a 0.5 s WAV data URI — above 0.95 s WebKit offers it to the lock screen) is
    played inside the same tap that unlocks the context, which moves the page to the *playback*
    session. One element for life: WebKit lifts the gesture requirement per element. Playback is
    not mixable (it pauses the player's own music), so only a tap that asks for the game's sound
    takes it — START GAME, RESUME, SOUND ON (`unlockAudio(true)`); every other unlock merely
    follows a context that is already running, and PAUSE, a hidden page and SOUND OFF hand the
    session back. Same technique as the AechTech instrument hero, where Philip confirmed it on
    his phone. `?ios=1` exercises the path on a desktop browser; nothing on a phone reads
    differently, and no wording changed.
  - `img/og.png` is a generated 1200×630 card, not a screenshot: source is
    `.claude/og-cards/missile-command.html`, rendered with headless Chrome at
    `--window-size=1200,630 --force-device-scale-factor=1`. High scores are `localStorage`
    (`mc-mobile-scores-v1`) — per browser, per origin.
  - `/missle-command`, `/misslecommand` and `/missilecommand` redirect here (Philip's own
    spelling of the folder; Vercel paths are case- and letter-exact). `missleCommand/` is his
    original drop — untouched, gitignored, and byte-identical to this file's first commit.

- **/missile-command-deluxe** — **City Run** (Sep 19 2026, the second deluxe). Philip's brief: "isn't deluxe enough. Throw
  all the existing graphic styles and approach out the window and design new. Make it only auto-play. Let's change game play…
  fly through a city on each level… saves each city a level at a time… flies in 3-d space and shoots from his tethered by
  wireless base camp… radar… After each level it gets harder. Match color schemes from original missile command."
  v1 — the 2D game generated into a realistic desert world (WebGPU + TSL, `port.py`/`shell.py`) — is gone from the tree and
  kept under the git tag **`deluxe-v1`** (`53ea39c`). Nothing here is generated any more; edit the files directly.
  - **The game.** Each level is one city (the arcade's folkloric six — EUREKA … SAN DIEGO — then it loops with II, III).
    The craft always flies forward along a closed circuit of avenues; the player only bends its path inside the canyon.
    It carries no weapons: a tap is a DESIGNATION, and base camp (pads ALPHA/DELTA/OMEGA, ten missiles each, tied to the
    craft by the visible uplink) fires. **"Only auto-play" was read as AUTO-only** — base camp picks the pad (fullest,
    then fastest); there is no pad selection, and the bottom control bar is gone. The title screen is also a self-playing
    attract mode (`S.demo`: silent, scoreless, a gunner that leads its shots), which covers the other reading.
    Six towers must stand when the raid ends; all six down is game over unless a reserve tower (one per 10,000) re-raises.
  - **Kept from the original on purpose:** the `WAVES` table and `PALETTES` verbatim (scaled by `CONFIG.count`/`speed`), the
    blast envelope and its three colour phases, chain kills, scoring and the ×1–×6 multiplier, a pad lost when hit,
    typed initials, the iPhone Silent-Mode keep-alive (`audio.js`), and the palette cadence — a new scheme every TWO
    levels. Every colour in the world and on the page is one of the scheme's three (`--ground/--friendly/--enemy` are
    rewritten per city by `chrome()`), plus white-hot cores.
  - **Aiming in 3D** (`solveAim`). A tap is a ray and a ray has no depth: the shot bursts where the ray passes closest to
    a missile's FUTURE path segment, so leading the target works exactly as in 2D and depth solves itself; nothing near
    the ray → it bursts on the ray at altitude. **The radar is a control**: tap it and the same solve runs down a vertical
    line from that map spot. The overlay's yellow diamond shows where the shot will actually burst.
  - **The raid follows the player** (`ahead()`/`pickTarget`). A forward camera plus city-wide targets put the battle
    off-screen (measured: 0 of 8 missiles in view). "Further along the road" is the wrong test — the circuit corners every
    few seconds. The craft is flown forward in the mind to four moments of the missile's fall and a tower is kept only if
    it sits in the forward cone for two of them; staged missiles also arrive from BEYOND the tower. Measured after: 85 %
    staged, every staged missile seen. One strike in five is unstaged on purpose — that is what the radar is for.
  - **Steering has to be a choice, never a tax:** rings (+3 missiles) and jammers (3 s without the uplink, from level 3)
    are always placed OFF the centreline (`scatter`), so a phone player who only taps flies clean and meets neither.
    A corner narrows the lateral bound so the craft cannot clip a block; the camera rides the ROUTE 15 units behind, never
    the craft's tangent, for the same reason.
  - **Round two, same day** (Philip: "all new graphics including the user interface, the sound button… The old one was
    modeled after 80s. This should feel holographic and modern. The sounds are terrible… ping eleven labs… keyboard for
    flying, mouse for shooting. We should be able to fly above. radar… more integrated higher in view… more bad guys,
    planes that drop missiles"):
    - **The interface is a hologram, not a console.** No top bar: the view runs to all four edges and everything floats on
      it — `.holo` is the one surface (a breath of glass, a hairline, two corner ticks), Rajdhani (Google Fonts) replaces
      the monospace, SOUND / PAUSE / FULLSCREEN are icon buttons, base camp is three ten-segment gauges. The lab hamburger
      keeps its stock spot; the tools sit to its left. A corner tick that OVERHANGS a scrolling panel by a pixel makes it
      scroll, and the scrollbars read as a grey bevel — panel ticks sit inside the box.
    - **The radar hangs top-centre** (top-left on a phone held sideways), has no opaque face, and **a click goes THROUGH it
      unless it lands on a blip** (`radar.blipAt` from `fireAt`) — it sits over the very sky the staged missiles fall
      through, so it must never eat a shot. `#radar` is `pointer-events:none`; all input enters through the game canvas.
    - **Flying: keys are a VELOCITY, not a position** — hold W to climb, let go and you stay. Below `CONFIG.roof` (305, above
      every spire) the craft lives in a slot 7.5 wide over the avenue; above it the slot opens like a bowl (the higher, the
      wider, to ±135) and the street route melts into THE HIGH ROAD — the same circuit low-passed by a moving average, its
      control points taken at equal distances along the street route so its parameter `t` is the same place as distance
      fraction `u` (`route.frameAt(u, s, …)` blends them by `c.s`). Off to one side the FLOOR is the roofline: you come
      back down only over an avenue. The camera tips from +25 (looking up at the raid) to −30 (down on the city) with height.
    - **Aircraft** share the craft's dart geometry, scaled (`PLANE`): bombers from city 1 (half cross your view, half come
      straight down your road overhead; they lay a STRING of missiles), raiders in a V of three from city 2, satellites
      from city 4. All are spawned relative to a point on the player's road a few seconds ahead. `isPlane = e.drops !== undefined`.
      The table's aircraft column is ignored; `CONFIG.count` came down to 1.1 because the planes bring the rest.
    - **Sound is sampled** — 17 MP3s in `sfx/` (724 KB) made with ElevenLabs' sound-generation model on Philip's Creator
      plan (commercial licence). `.claude/missile-command-deluxe-sfx.py` holds every prompt and regenerates any of them
      (`… .py blast impact`); it reads `ELEVENLABS_API_KEY` from the philipbaker.us project's `.env.local` INSIDE the
      process — never print, echo or pass that key on a command line. `audio.js` trims leading silence and level-matches
      at load (the raw files arrive 20 dB apart), pans by screen position, dulls with range, folds the engine loop's tail
      into its head, and keeps the old synth only as a fallback. **Nobody has listened to these yet** — they were judged by
      duration / peak / RMS only. The iPhone keep-alive is unchanged.
    - **World:** the wireframe mountains and desert grid (the most 80s things in it) are gone. In their place: a hex DEFENCE
      DOME that lights up around every blast (view-space halo from the light slots), avenues that are dark MIRRORS (the
      ground is see-through over a second, y-flipped draw of the same building instances — `uMirror`, BackSide), a lens pass
      (colour fringing, vignette, grain), dust motes, perimeter rings beyond the city limits.
    - **Three bugs worth remembering:** (1) the hex tiling `(1, √3)` is pointy-top — its flat distance is along **x**; with
      the axes swapped the outlines become filled wedges that look like stray triangles in the sky. (2) Motes wrap around
      the camera, and a 0.2-unit speck one unit from the lens is 100 px wide and gets sliced into a triangle by the near
      plane — skip anything within 10 units. (3) The ground became `transparent`, so every additive pool that does not write
      depth (rings, jammers, pad rings) needs a `renderOrder` above the ground's or the ground paints over it.
  - **Files:** `main.js` (rules, flight, aim, input, panels, the frame, the resolution governor), `scene.js` (everything
    three.js), `radar.js` (the scope + the flat 2D overlay: reticle, brackets, edge chevrons, score pops, altitude tape,
    thumb stick), `audio.js`, `sfx/`. Imports are ROOT-ABSOLUTE (`/missile-command-deluxe/…`): Vercel serves the bare URL too.
  - **Renderer: deliberately plain.** three.js r186 **classic `WebGLRenderer`** (WebGL2 everywhere), hand-written GLSL,
    `EffectComposer` → `UnrealBloomPass` → `OutputPass` (ACES). Four pooled instanced draws — buildings (one box, dressed
    wholly in the shader: windows, corner strips, crowns, collapse via a per-instance `aState`), BEAMS (every line of
    light; never thinner than ~2 px so far trails don't shimmer), SPRITES (every point of light), blast shells — plus
    `blastLight()`, the one light function every surface calls (8 slots, ranked by STEADY power). No textures, models or
    three.js lights. MSAA on the scene target on desktop only.
  - **Tuning that mattered:** first light was a white-out — bloom threshold 0.16 → 0.42 and windows mostly dim with a few
    hot fixed it. Anything spawned AT the craft is 15 units from the lens: the engine glow, the uplink's first third and
    the uplink pulse all have to start tiny or fade in. Blast cores above ~0.3 turn the whole disc white under ACES.
  - **QA:** `?qa=1` exposes `window.__mcd` (`start()`, `step(n, render)`, `launch(v3)`, `fireAt(x,y)`, `next()`, `S`,
    `world.project`). **Add `&hold=1`** or the page keeps playing in real time between commands and base camp is rubble by
    the time you look. `?quality=low|high`, `?dpr=`. The social card `img/og.jpg` is a staged real frame composed in-page
    and POSTed to the scratch server's `/__shot/` (see the Mac-mini preview note above).
  - **The `//` gotcha, again:** a comment spliced into the MIDDLE of a one-line statement ate `camera.lookAt(…)` and the
    camera silently faced −z for two test frames. Comments go at the END of these dense lines, always.
  - **Not verified on a real phone** — desktop Chrome and its touch emulation only (tap, drag-to-fly, two thumbs at once,
    layout at 740×360). Lost WebGL context raises a reload cover; the rotate gate and hamburger seating are the original's.

- **/maze-wars** — Maze Wars+ (MacroMind, 1986; Alan McNeil & Burt Sloane), the Macintosh descendant
  of the 1973 Maze War, rebuilt to play in a browser — online, with chat (Sep 19 2026). A 512×342
  one-bit framebuffer scaled by whole numbers; no assets, no build, and no game server: the only server-side
  parts are the clubhouse and Thumbs' voice, and the game plays without either.
  `/MaseWars` (Philip's spelling, and the ignored folder this was built from), `/mazewars`,
  `/maze-wars-plus` and friends redirect here.
  - **What is the original's and what is ours.** Philip supplied his own copy (two floppy images,
    v1.0 MFS / v1.1 HFS). The **four mazes, the rules, the key maps, the strings and every window
    and dialog rectangle** come from its resources. **Every picture is redrawn** (`js/art.js`, by
    code, fresh at each of the 9 depths) — the repo is public and the art is MacroMind's, so the
    disk images and anything extracted from them stay out. Don't "upgrade" the sprites by dropping
    the original bitmaps in. The tools that read the disks are in `.claude/maze-wars/`.
  - **The data, decoded.** Resource `maze` #1 (1024 bytes) is all four 16×16 mazes interleaved and
    column-major: cell (x,y) of level k is byte `(x*16+y)*4+k`, wall bits **E=1 S=2 W=4 N=8**
    (15 = a solid block). `whoo` #1 is two bytes per cell, same indexing: low 3 bits of byte 0 —
    4 floor, 5 solid, 6 teleporter (byte 1 = a group number), 7 lift (`byte0 >> 3` = destination
    level). Lifts pair up at the same x,y on both levels and are all dead-end closets; the app
    calls the right-hand column window `level`. `maze`/`whoo` 2–4 are an older 17×18 format — unused.
    `js/levels.js` is generated from this; zero inconsistent shared walls, and level 0 matched the
    published screenshots wall for wall.
  - **The hall is measured, not guessed.** Every cell boundary is a square centred on (140,136) with
    half-sizes 110, 77, 54, 38, 26, 18, 12… (`floor(h × 0.7071)` each step — the sprites step by the
    same 1/√2), so every wall edge is a true 45° line. One dither for all walls (the app's
    `PAT 1000`, 25% staggered), a 4-dots-per-8×8 floor weave, white ceiling. Lines only where a run
    of wall starts or stops. A side opening must NOT paint the far boundary column — it carries the
    next wall's edge line. **Fidelity check:** pose the game like a reference shot and lay the shot
    over the canvas with `mix-blend-mode: difference` (the dungeoncrawlers.org images are exact
    512×342 captures) — identical pixels go black. Hall, map, menu bar and name row are black.
    Menu titles: first at x=19, each next one 15 px after the last ends.
  - **Network = "AppleTalk".** `js/net.js` is a ~60-line MQTT 3.1.1 client over WSS to a **public
    broker** (broker.emqx.io, fallback broker.hivemq.com; both answered from here). Topic tree
    `pbmazewars/1/<zone>/s/<id>` (state, on change + 2 s heartbeat) and `…/e` (events: fire, hit,
    chat, option, teleport, bye — `bye` is also the MQTT last-will — and `home`, which `net.js` keeps to itself). Zone `lobby` is everyone;
    Options ▸ Phone… dials a private zone, mirrored in the URL as `?line=`. Like the original there
    is no server and nobody in charge: **each machine decides when its OWN man or robot is hit**
    and tells the rest (a remote missile pauses 380 ms in an occupied cell to let that ruling
    arrive). Everything inbound is range-checked, text is reduced to glyphs the bitmap fonts can
    draw, and nothing received is ever HTML. It is a public test broker: no SLA, chat is readable
    by anyone who guesses the topic — the About box says so. To move to a broker of our own, only
    the `BROKERS` list changes.
  - **Finding each other** (learned the first evening, Sep 19 2026: Philip's two devices could not see
    one another — one had clicked the phone icon and dialed, and was alone on a private line without
    knowing it). So: a roster with nobody in it now says WHY in plain words (private line / AppleTalk
    off / nobody here yet) and how to change it; every other player's row carries the level they are
    on; the tab title carries a head-count, "(3) Maze Wars+"; File ▸ Invite a Friend… shows the link
    (with `?line=` when on a private line). **Line names are scrambled before they go on the wire**
    (`net.tz`; the lobby stays `lobby`) — people type real phone numbers into that field, and a topic
    on a public broker is readable by anyone: subscribing to `pbmazewars/1/#` is how the stray
    device was found. To see who is where when debugging, do exactly that from any page's console.
  - **A window in the background fell off the network — and into an empty one** (Sep 20 2026). Philip had two
    sessions on one Mac; one saw a visitor ("RCV") and the other said "Nobody else is on the network yet" while
    connected. With two windows on one screen, one is always hidden, and Chrome slows a hidden page's timers to one
    a second and, after five minutes, to **one a MINUTE**. Three things in `net.js` then went wrong in a chain:
    the heartbeat rode on a page timer, so it slowed to one a minute while everyone else forgot a player after 9 s
    (the flicker: "tom joined / tom dropped off", all evening); the dead-line test was "nothing heard for 50 s",
    which a once-a-minute clock reads as dead on a perfectly good line; and `fail()` was simply "try the NEXT broker"
    — so the window hung up on home, connected to the backup and STAYED there, cheerful, alone, and indistinguishable
    from a quiet evening. A reload looked like a cure (`connect()` starts at home), which is why it read as a cache
    problem. The rules now, all in `net.js`:
    - **Home first, always.** `BROKERS[0]` is where people meet. It gets `HOME_TRIES` (3) goes before a backup is
      tried; a backup that fails sends you straight back to asking home; and while on a backup a second, throwaway
      connection asks home every 45 s whether it is back (`probe()`). When it answers, the client publishes
      `{t:'home'}` on the backup — everyone else stranded there looks at once rather than at their own next probe —
      and moves. `net.backup` / `net.broker` say where you are: the AppleTalk dialog names the exchange, the status
      notice and the empty-roster hint say so in words, and coming back says "Back on the main network."
    - **The line is dead only if nothing has arrived since the last ping was SENT** (`net.pinged`, `net.pingAt`,
      `net.lastRx`) — true however slowly the clock ticks. MQTT keep-alive is 120 s (the broker allows 1.5x).
      `net.tick()` rides on the game's frame, with a 5 s page timer of its own behind it.
    - **The hidden-tab tick comes from a Web Worker** (`main.js`): a worker's clock is not slowed the way the page's
      is. The old page timer stays as the fallback. "A slow timer keeps the heartbeat alive in a background tab" was
      the comment on the line that did not — it had never been tried for longer than five minutes.
    - **Hidden is said, not guessed.** State carries `h:1` while `document.hidden`, sent the moment visibility changes
      (not at the next frame, which may be a minute off). `sweep()` has two leashes: 90 s for a player who said they
      are hidden, 20 s for one who should be sending every 2 s. A clean exit says `bye` and a dropped line has it said
      by the broker (the MQTT will), so the sweep is only for the rest. The roster's where-column reads `level 2`,
      `shot, lvl 2` (was the baffling "down, 2") or `idle, lvl 2`; 65 px is all that column has — measure with
      `G.textW` before rewording ("away, lvl 4" is exactly 65 and touches the score).
    - **`performance.now()` counts from page load**, so 0 is not "long ago" on a young page: "do it at the next tick"
      is `NOW = -1e12`. The scripted test caught this one — a probe armed with `probeAt = 0` would not fire during a
      page's first 45 seconds.
    - **How it was found, and the lesson in it:** Claude's own test tab. Signing in on the local mirror joins the REAL
      lobby — the mirror runs the real network code — and "Thumbs" lay dead on level 1 in Philip's roster for 93
      minutes after the preview SERVER was stopped (a loaded page does not need its server). Its message log was the
      flight recorder that solved this, but it should never have been there: **test on a private line (`?line=…`),
      and close the tab, not just the server.** POSTs to `/api/` 501 on the mirror, so it left no score and sent no mail.
    - **Testing it** (all three were needed; the first found a bug the others could not): (1) swap `window.WebSocket`
      for a scripted fake and walk the rules — dial order, keep-alive bytes, the probe's missing will, the `home`
      event, the two liveness cases; (2) put a gate in front of the REAL WebSocket that refuses home, land on the
      real backup, open the gate, watch it hop; (3) the real thing: `open -g -n -a "Google Chrome" --args
      --user-data-dir=<scratch> …` with `about:blank` tabs at BOTH ends of the URL list (whichever end Chrome
      activates, the game tabs are background tabs), a mirror-only `t-auto.html` that signs itself in (it appends H
      or V to the name from `document.hidden`), the live build served beside the new one from `git archive HEAD`,
      and a watcher page logging every state message by arrival time. It takes ten minutes because the heavy
      throttling takes five to start. `pkill -f` the scratch profile afterwards.
      **What it showed** (both tabs hidden from load, 6.5 minutes): the live build's heartbeat stretched to one a
      minute within 90 seconds (Chrome's heavy throttling starts after ~10 s for a page that LOADS hidden, not five
      minutes), the watcher logged it dropping off and rejoining, the broker then announced its line dead, and a
      listener on the backup broker heard it there, alone — before it bounced home again. The fixed build: 208
      heartbeats, worst gap 2.6 s, 0.3% CPU.
  - **The suggestion box is public** (Sep 21 2026). Philip: "Can we make it so that folks can see all the feature requests?"
    Apple menu > Everyone's Ideas…, a **See the List** button on the form, and the list opens after you send one with
    yours on top (put there by the page — a CDN cache in between may not know about it yet). `GET ?op=ideas` is open to
    anybody and returns the idea, the GAME name and the date — **never the contact, never the card's full name** (a
    request is now `v:2` with `name` = game name and `full`/`contact` for Philip only; an old `v:1` row shows only the
    first word of its name, because that field may hold a full one). The form says so: "Your idea and game name go on a
    list all can read" — "everyone" does not fit the 336 px it has.
    - **Moderation needs no password.** Every request's email to Philip carries a signed link that takes it off the list
      (`?op=idea&id=&k=&hide=1`, HMAC of the id, the same secret as the unsubscribe links) and the page it lands on offers
      to put it back. Hidden = a marker object at `mazewars/r/_hidden/<id>.json`; nothing is rewritten. The SENDER gets the
      same key back in the POST reply, so a "take mine down" can be built on it. `GET ?op=ideabox` mails Philip the whole
      box with a link per idea — for the ones that arrived before links existed; once a day at most, safe for anybody to call.
    - New ideas are **visible at once**, not held for approval: the game already shows unmoderated names and live chat,
      he is emailed the instant one arrives, and a list that does not show your own idea is a list people stop writing
      to. If that ever goes wrong, the switch is to show only ideas with an `_ok/` marker.
    - Where a request goes has nothing to do with the form's "Reply to" box, which is only a line in the email. That box is
      pre-filled from the player's OWN saved card (`prof.email`, in their browser) — Philip saw his own address there and
      wondered who else could.
  - **The lobby, the queued obituary, and menus that stay live** (Sep 21 2026). Philip, testing Suggest a Feature: "when i'm
    in there typing text, the bot kills me and the dialog box comes on top. I can't access any menu items when the message
    box pops up when i die… I'd like to have the menu always available and maybe a 'go to lobby' button?" Three faults,
    one idea:
    - **The obituary REPLACED whatever dialog was open** (`ui.show` swaps `ui.dialog`), so his text was gone. Dying now
      sets `pendingObit`, and `frame()` shows it only when no dialog and no menu is in the way. Your chat line still
      goes out even though you died while typing it.
    - **A player filling in a form was still standing in the maze.** `lobby` is a real state — `me.inMaze = false`, so
      nothing can see, shoot or walk over you: 0 in the maze, 1 stepped out because a form is open (back the frame after
      it closes — a frame, not `ui.close`, because "close this, open that" chains must not bounce you in and out), 2 there
      by choice. Every dialog steps you out EXCEPT those marked `inWorld` — the message box (typing a message has always
      left you standing there; Thumbs does the same) and the obituary. Coming back is `materialize()`: somewhere random,
      as after a death. **No dodging:** a step out waits while a hostile missile is within five cells in a straight line
      (`threatened()`), so opening the About box is not an escape — you are hit, the form stays up, the obituary waits.
      By choice: the obituary's **Lobby** button, File > **Wait in the Lobby** (⌘L, a check mark while you are there);
      any movement key, a click in the hall, or the phone's pad brings you back. The hall shows a card; the map and the
      message box still work. `materialize()` resets the state, which is what keeps New > appearance > back-in from
      materializing twice. A GAME OVER leaves you out until New.
    - **Any dialog locked the menu bar.** While playing (`ui.menusLive`), the bar and an open menu take the pointer
      first; the pulled-down menu is drawn over the dialog (`draw()` repaints the bar last); and **a menu choice first
      dismisses the dialog the way Escape would** — its Cancel, or its default if `escDefault` — up to three deep, since
      closing the obituary can open the card prompt. A dialog with no way out (the sign-in name box) keeps the menus
      shut, and nothing changes before play: there, "Escape" on How to Play means Play.
    - Others are told, but not for a glance: `sweep()` says "X stepped out to the lobby" only after six seconds out, and
      "X is back in the maze" only if the first was said. `everIn` keeps "joined the game" for a first arrival. A player
      in the lobby is not `inMaze`, so they leave the roster and do not count as somebody for Thumbs to make way for.
    - Tested on a private line with `dev.anywhere`: his exact case (form open, Thumbs lined up for 3.5 s: not shot, text
      intact, back in on close); shot while typing a chat line (box stays, obituary follows); File pulled down over the
      obituary and High Scores chosen; the Lobby button, the key, the hall click, the menu toggle; and the missile case.
      `?shot=1` still hashes identical to production.
  - **"Where It Came From…"** (Apple menu, Sep 21 2026) — Philip's homage: "a nod to the original creators. And an homage to a
    great fun time in the late 80s… don't make it too long." Three short paragraphs and four link buttons
    (`window.open` inside the click, so no popup blocker). The 1973 paragraph is from Steve Colley's OWN account on
    DigiBarn — his maze was a 16 by 16 grid with the halls in perspective, which is exactly what this game still is, and
    he is the one who added the peek. Link `digibarn.com` WITHOUT `www`: the certificate does not cover it. The 1986
    paragraph: Burt Sloane began the Macintosh version at Apple in 1984 as a network demo; Alan McNeil — the Alan McNeil
    who made Berzerk (1951–2017) — worked on it at MacroMind, which became Macromedia. **The last paragraph is Philip's
    memory in his words** (CompuServe, friends' houses, a Mac SE, "the clank of the keyboard"); no source ties Maze Wars+
    to CompuServe (two players could play by modem), so it is stated as his, not as history. Do not "correct" it.
    The bitmap fonts have no em dash or curly apostrophe (`MW.FONT.clean` drops them): spaced hyphens and `'`.
    A `.sr` paragraph in `index.html` carries the same credit for screen readers and crawlers.
  - **The visit log and the morning digest** (Sep 21 2026). Philip: "Are [we] able to see who's played and how long they
    stayed on?" — and then "can we add game play duration?" Until then the only record of a visit was the "just came in"
    email; play time was sent with a score and thrown away. Now `club.js` keeps a visit's numbers and reports one row:
    name (and card name/place if they have one), arrival, **stay** (arrival to their last ACTIVE second — a tab left open
    all night is not a twelve-hour visit), **play** (seconds with the window showing and a hand on the controls, i.e.
    `!document.hidden` and input within the last minute), score, the most real players seen, whether Thumbs played them,
    chat lines (`club.said()`, called from the two places a player speaks), phone or desktop, the referrer's HOST only,
    and whether it was a private line (never which). No IP address, no fingerprint. It is sent when the page is hidden or
    closed (a beacon) and every two minutes in between, because a phone kills a tab without a word; a report that would say
    nothing new is not sent, so an abandoned window goes quiet.
    - Storage follows the scores: `mazewars/v/<YYYYMMDD>/<visit id>.<b64 row>.<stamp>.json`, the row in the PATHNAME so a
      digest is a listing; each report is put as a new object and the older ones for that visit are then deleted.
    - `GET /api/mazewars?op=digest` mails Philip yesterday's visits — "yesterday" in CENTRAL time (`centralDay()` finds
      Central midnight by trying 05:00 and 06:00 UTC; checked across both daylight-saving changes: 24, 25 and 23-hour
      days). Vercel Cron calls it at 13:00 UTC (`vercel.json` `crons`). It is deliberately safe for anybody to call: a
      marker (`mazewars/v/_digest/<date>.…`) written BEFORE the mail makes it once per day, and the reply carries counts
      only. `VISITS_SINCE` stops it reporting on days before the log existed — "nobody came in" would have been a lie.
      Rows older than 120 days are pruned there. `GET ?op=visits&back=N` with `x-admin-key` returns a day's rows and text.
      `digestText()` is pure: run it in `jsc` with sample rows to see an email without sending one.
    - **The instant "just came in" emails stay** — Philip, asked whether the digest should replace them: "i like those
      notifications". He then asked about getting a TEXT, heard the options (the carriers' free email-to-text gateways
      are dead or dying — T-Mobile Dec 2024, AT&T Jun 2025, Verizon Mar 2027 — real SMS needs a paid provider and
      weeks of carrier registration, and the practical route is a push app such as ntfy or Pushover) and decided:
      **"let's not do any new notifications services. email is fine for now."** Do not re-propose push or SMS unless
      he raises it.
    - Tested against a stub of the endpoint in the scratchpad `serve.py` (`GET /__mw` reads the bodies back). The test page
      shims `document.hidden` to false, because the Browser pane is a hidden page and hidden seconds are, rightly, not play.
  - **Thumbs, the house AI** (Sep 20 2026). Philip: "if there are no players in the game and a new player shows up, we
    insert an ai-player… it chats just like a real player… If a second real life player shows up, thumbs says
    goodbye… zero visible change to the user interface… His name should be thumbs." (The name is the stray test
    player above; he liked it.) He joins **4 seconds** after somebody finds the public maze empty (Philip's number: 8 for
    the first day, 4 from Sep 21 — still two heartbeats, so anyone really there has been heard) and leaves the moment
    there is a second player. **Not a robot**: the sidekicks are untouched, and yours sides with
    you against him as it would against anyone.
    - **THE RULE: he never passes as a person.** Philip's first brief was "appears as a real player… an experience
      playing someone real"; he agreed to this instead ("I love it"). Anthropic's usage policy — the key is the one
      Widget Maker runs on — forbids using output "to convince a natural person that they are communicating with a
      natural person when they are not", and requires a consumer-facing chatbot to say it is an AI at the start of each
      session; EU AI Act Art. 50 (in force 2 Aug 2026) says the same; the repo is public; and the chats are kept.
      Three locks, none to be loosened "for immersion": (1) his FIRST line is a fixed template in `thumbs.js`
      (`HELLOS`, every one contains "AI") — a disclosure must not depend on a model choosing to make it; (2) the
      system prompt in `api/thumbs.js` forbids denying it and tells him to answer "are you a bot?" plainly, in
      character; (3) `honest()` replaces any line that claims to be a person or denies being an AI — unit-tested with
      11 denials and 12 honest lines, and the first version let "i am not an AI" through because the exception for
      honest lines matched the words "an AI" inside the denial. The About box and How to Play each carry a sentence
      (the email pitch on How to Play gave up its room: that column holds 15 lines on desktop, 16 on a phone).
      What makes him feel real is behaviour, not a lie: he turns before he walks, takes a beat before he fires,
      side-steps most missiles, takes a wrong turn now and then, stands still while he types (shoot him), eases off
      when he is well ahead, never spawn-camps (6 s of mercy after a kill), leaves an idle player alone.
    - **Where he lives.** He only exists while exactly one human is present, so nothing about him crosses the
      network: his body is an entry in `others` (`id '~thumbs'`, `local: true`) that THIS browser moves, and every
      "the victim's machine decides" rule is decided here. `'~'` cannot arrive over the wire (inbound ids must match
      `[a-z0-9]{4,12}`), so nobody can send a fake one. Because he is just another entry in `others`, the roster, map,
      sprites, obituary, tab-title count and robot allegiance all treat him as a player with no interface code at all.
      `game.js` lends him a few internals as `game.x` and calls him from six places: `tick` in `frame()`; `hit` in
      `tickMissiles` (a missile reaching a `local` being is ruled on at once instead of waiting 380 ms for a machine
      that does not exist); `steppedOn` in `step()`; `scored` in `killMe` (nobody else's machine will credit him);
      `heard` from the message box and from the obituary's comment; and `sweep()` skips `local`. In a lift he is
      `alive: false` for 1.3 s, exactly as a real player's state says `v:0`.
    - **Who counts as a second player: anyone real who is not idle.** `h:1` in the state now means hidden OR nobody
      has touched the keys for 90 s (it was hidden only), because with the heartbeat fix an abandoned tab stays listed
      forever — and one forgotten window anywhere would otherwise keep Thumbs away from every visitor. The idle player
      waking up sends him off. He will not join while the visitor's own page is hidden: no greeting for nobody.
      Public maze only — never on a private line, never with AppleTalk off.
    - **His voice** is `POST /api/thumbs` (Haiku, `claude-haiku-4-5-20251001`, 100 tokens, 12 s timeout): kinds `reply`,
      `event` (a `[game]` stage direction — he was shot, he shot you, it has gone quiet; a player cannot type one, a
      leading `[game]` is rewritten), `bye`, and `hello`, which generates nothing and only records the template. The
      client sends the last 12 lines as history; the server keeps no session. The line being answered travels as
      `text` and is removed from the history wherever it sits — his reply to an EARLIER line can land after it. One
      request at a time; say more while he types and he answers the latest. About a tenth of a cent a reply.
      `THUMBS_DAILY_LINES` (default 900, roughly $1; counted with one `list()` of the day's prefix, cached 30 s),
      `THUMBS_OFF=1`, `THUMBS_MODEL` — all optional, and env changes need a redeploy. Past the cap, or on any error,
      he keeps playing and goes quiet: silence is a better failure than an error dialog. 60 requests a session,
      30 a minute per IP, 10 unprompted remarks a session and never within 20 s of his last line.
    - **The record**: `mazewars/t/<YYYYMMDD>/<sid>.<seq>.<stamp>.json`, one new object per exchange (the Vault's Blob
      note), the player's name in the BODY only, nothing linking it to a card or an email. Read a day with
      `GET /api/thumbs?op=transcripts[&day=]` and `x-admin-key` (`MAZEWARS_ADMIN_KEY`), or in the Vercel Blob browser.
      Every response carries `kept: true|false`, so storage can be checked without the key.
    - **He asks people to bring friends** (Philip, Sep 21 2026: "have him occasionally prompt the user to invite friends to
      play by using the file menu"). It is the point of him — he is there so the room is not empty, and the cure for an
      empty room is people. First pitch 2.5 to 4 minutes into a session, then 8 to 12 minutes apart, three a session at
      most; never within 20 s of his last line, never while he is mid-reply, and only while the player is actually
      playing (input in the last 30 s) — otherwise it tries again in 15 s. The model words it from a stage direction that
      tells it to name the File menu; `INVITES` in `thumbs.js` are the stand-ins when the model is quiet, capped or off
      (`ask()` takes a fallback line for this) — the invitation must not depend on it. No `>` in those lines: the chat
      font has none. `MW.thumbs.dev.invite()` makes the next one due now.
    - **Each talk is mailed to Philip when it ends** (his ask, the same night). `thumbs.js` sends `{op:'end', sid}` from
      `gone()` and on `pagehide` — a beacon, since one way a talk ends is the page closing — once per talk, and only if
      the player said anything (a visitor who never typed already produces the "player came in" notice). The server
      waits 1.5 s (his goodbye may still be landing), lists `<day>/<sid>.` for today AND yesterday (a talk can
      straddle midnight UTC), writes a `<sid>.mailed.<stamp>.json` marker BEFORE sending so a second `end` cannot
      send a second copy, and mails `MAZEWARS_OWNER_EMAIL` through the clubhouse's `sendMail`. The canned goodbye
      (used when the model is slow) is not in the record; the model's is.
    - **Testing him without haunting the lobby.** `MW.thumbs.dev.anywhere = true` lets him onto a private line (and
      past the hidden-page check — the Browser pane is a hidden page); `dev.join()`, `dev.leave()`, `dev.state`. The
      scratchpad `serve.py` grew a stub for `POST /api/thumbs` that echoes and logs every request body (`GET /__thumbs`),
      which is how the duplicated history was seen. A real arrival is `MW.net.onState('abc123', {…, i:1, h:0})`, a
      departure `MW.net.onEvent({t:'bye', id:'abc123'})`. Duels: put both in a 7-cell corridor and spin `game.frame()`.
      And the `//` trap bit a THIRD time here — a comment spliced into the middle of `tick()`'s first line ate the
      join, and the syntax check had been skipped after a "one-line" edit. Run `jsc` after EVERY edit.
  - **The clubhouse** (Sep 19 2026) — the only server-side part, and the game plays without it:
    `api/mazewars.js` + `lib/mazewars.js` on Vercel Blob, `js/club.js` in the page. A How to Play page
    before sign-in; a **high score board** (most kills in one visit, ties to fewer deaths then to
    whoever got there first; a robot's kills no longer count for its owner); an optional **card**
    (full name, location, email, two consents); a **feature-request box** (Apple menu); and
    "I just came in". Blob layout follows the Vault note to the letter — every write a new object,
    listings read from PATHNAMES: `mazewars/s/<b64 public row>.<player hash>.<stamp>.json` (the
    board is one `list()`), `mazewars/p/<hash>.<flags b|o|x>.<stamp>.json` (cards; the flags let an
    announcement find its audience without opening every body), `mazewars/b/` (announcement
    markers), `mazewars/r/` (requests — public since Sep 21, see "The suggestion box is public"; also readable in the Vercel Blob browser, or
    `GET ?op=requests` with `x-admin-key` once `MAZEWARS_ADMIN_KEY` is set; `DELETE ?id=` takes a
    row off the board with the same key).
    - **Public vs private.** Name, full name, location and score are the board, so they are public
      and ride in the pathname. **Email never appears in a pathname or in any response**; it lives
      only in a card's body as AES-256-GCM ciphertext (key derived from `MAZEWARS_SECRET`, else
      `WIDGET_MAKER_SECRET`, else the Blob token) because every object in that store is a public
      URL to whoever learns it. The browser holds a random player id; only its hash is public, and
      holding the id is what lets you edit or **Remove Me** (which deletes score and card).
    - **Email is OFF until Philip wires it**: `RESEND_API_KEY`, `MAZEWARS_MAIL_FROM` (an address on
      a domain verified in that Resend account, or Resend refuses), `MAZEWARS_OWNER_EMAIL`. Then
      REDEPLOY — env vars are snapshotted (see the Vault's Wiring note). Until then the card still
      stores addresses and says plainly that notices are not switched on. Three kinds of mail:
      every login -> the owner; bumped out of the top ten -> that player, if they ticked it; and
      "somebody is online" -> only players who ticked THAT box, only when the arriving player
      ticked "Tell the other players I am online", at most once an hour site-wide, at most 40
      recipients, paced under Resend's 2/second. Every player email carries a one-click
      unsubscribe (`?op=unsub`, HMAC-signed) and `List-Unsubscribe` headers. Do not widen the
      audience to "everyone with an address" — one public checkbox would become a spam cannon.
    - **Mail wiring, as it stood on Sep 19 2026** (done through Philip's Chrome): `philipbaker.us`
      was ADDED to his Resend account (the account already had `catapultcreative.agency`), by
      Manual setup rather than Auto-configure, so Resend holds no standing access to the DNS.
      Three records were added at **GoDaddy** (the domain's DNS host, `domaincontrol.com`):
      TXT `resend._domainkey` (DKIM), CNAME `rsend` -> `rsend.forge.rmta.net`, CNAME `send` ->
      `send.forge.rmta.net`. Resend's optional "Enable Receiving" records were deliberately NOT
      added — the domain's inbound mail is Google Workspace and must stay that way. In Vercel
      (project `lab`, Production, type Config): `MAZEWARS_MAIL_FROM` =
      `Maze Wars+ <philip@philipbaker.us>`, `MAZEWARS_OWNER_EMAIL` = Philip's Gmail.
      `RESEND_API_KEY` is Philip's to paste (type Secret) — Claude never handles it — followed
      by a redeploy. To check it worked: `POST /api/mazewars {op:"hello",…}` answers
      `email:true` once the key is live and `owner:true` once a notice actually went out
      (which also needs Resend to have finished verifying the domain). A Resend key scoped to
      another domain will not send for this one.
      **Confirmed working that same night:** Resend verified the domain within the hour; after
      Philip pasted the key and an empty-commit redeploy, `hello` answered `owner:true` and
      Resend's log showed the notice Delivered. The bumped-off notice was proven end to end
      with throwaway rows: fill the board to ten BELOW the real players (1 kill, rising deaths),
      give the tenth a card with `bump:true`, post an eleventh that beats it -> `mailed:1`;
      then `forget` every test pid (nine records). Not yet exercised with real mail: the
      "somebody is online" announcement (it would mail any real player who opted in, and rests
      the bell for an hour) and the unsubscribe link's success path — both are easy to try
      with two of Philip's own devices.
    - Scores are browser-reported and unverifiable (the game is peer-to-peer). The checks — at
      least 3 s per kill, caps, per-IP rate limits — stop accidents and lazy scripts only.
    - **The robot stands down** while its owner is dead or has not touched a key for 45 s: on the
      first evening an idle phone's robot ran its owner's score to 10-1.
  - **An editor trap that bit twice here:** writing a file through the Write tool DECODES
    `\uXXXX` escapes in the content into the literal characters. Harmless for an ellipsis (though
    later string-matching patches then miss it — match both forms); dangerous for
    `/[\u0000-\u001f]/`, which landed as raw NUL/control BYTES in `lib/mazewars.js`. Use `\p{Cc}`
    with the `u` flag, or write such files from Python, and scan new files for bytes < 0x20.
  - **Guesses, flagged as such** (the 68k code was not disassembled): ◇◇◇◇ in the name row = the
    four network-wide options (4 Mazes, Black-out, Invisible Neighbors, Stationary Radar — the code
    has a "Blacked-out by" string, so options announce who set them); the teleporter byte is a
    group (same number = pass you round the group); the inverted name row marks the leader;
    Alter-Ego = the dome robot, Teleporter = a police box that is not a booth, Hunter = the heavy
    robot, Shadow Master = its silhouette, off the radar, coming from behind; "Stationary Radar" =
    the radar only works while you stand still. The sidekick is your opponent when you are alone
    and your ally when other people are on the wire. Missiles take 190 ms a cell and a held step
    165 ms — so, as a 1984 Mac salesman remembered, a long enough hallway lets you back away from one.
  - **J and L are side-steps — Philip's call, not the original's** (Sep 19 2026): one cell to your
    left / right *relative to your facing*, and your facing does not change. He remembered a strafe;
    the original's strings only list four compass keys ("Moves your guy North/East/South/West"),
    which this build had guessed turn-then-step. I and , are still that (absolute North / South,
    turning you) — the odd pair out now; if they ever change, forward / back without turning is
    the consistent choice. Both key maps carry the change.
  - **Keys** are the original's two maps (`STR ` 1111/1112: standard, and Touch Typist) plus arrows;
    Return/Tab opens the message box; a click in the hall fires (the original's cursor there is a
    gun sight). ⌘-equivalents also answer to Ctrl, since browsers keep ⌘N/⌘T/⌘M for themselves.
  - **Text entry on the DESKTOP goes through a hidden `<input id="ime">`** that is focused whenever a
    dialog field is active — that is what makes paste and the Browser pane's `type` action work (the
    pane inserts text as input events, not keystrokes; and its **"Return" key sends an empty `key` —
    use "Enter"**). Phones do NOT use it:
  - **Text entry on a phone: a real `<input class="ime">` laid over every field the canvas draws**
    (Sep 20 2026, `ui.syncFields` / `placeIME`). Philip, on iOS 27: "the keyboard won't come up
    sometimes and won't stay up". The hidden-input trick has four separate ways to fail there and the
    build had all four: (1) iOS raises the keyboard only for `focus()` *inside a tap* — never from a
    timer or a callback, and the obituary, the card and the start-up name box all open from one;
    (2) once an input is focused WITHOUT a keyboard, focusing it again is a no-op, and `syncIME`
    skipped the call anyway because it was already `activeElement`; (3) after a touch iOS replays it
    as a mouse click, and a mousedown on something unfocusable — the canvas — takes focus OFF the
    input: up, then straight back down; (4) `html, body { -webkit-user-select: none }` reaches
    inputs in WebKit. So now the finger taps a genuine text field and the OS does the rest — its own
    path, not one of ours. The letters stay invisible (`color`/`caret-color: transparent`, NOT
    `opacity: 0`) because the canvas draws them; 16px stops the focus zoom; `user-select: text` is
    restated; each input grows toward a 44pt target but never over a neighbouring control; they are
    positioned against `#stage`, their own parent, so any offset the browser applies to the page
    cancels out. `focus()` from code happens only while `ui.inGesture` (set by the `tap()` wrapper in
    `main.js`) or when the keyboard is already up and merely changing fields. Which field is focused
    is read from `document.activeElement`, not from a `focus` event — those do not fire in a hidden
    pane, and a test caught the difference. The canvas and the pads `preventDefault` touchstart /
    touchend / mousedown (no click replay, no blur); **the envelope button is the exception — it must
    stay a real `click`**, the one event certain to raise a keyboard. Blur is deferred a tick so
    "close, then open the next dialog" does not bounce the keyboard. While a field has focus
    `fitTouch` holds still (a layout that moves under the keyboard can drop it, and on Android the
    shrunken viewport would flip the page to landscape); when it goes, `scrollTo(0,0)` + refit twice
    — iOS 26.0 shipped a bug that leaves fixed elements a few pixels out after the keyboard closes.
    In portrait the screen is pinned to the TOP so every dialog stays clear of the keyboard and iOS
    never pans the page; a canvas app that gets panned has its hit-testing knocked out
    (unoplatform/uno#24526 is this exact failure, in somebody else's canvas).
  - **The phone's controls** (Sep 20 2026; the first pad was six 58×50 buttons in a row). Philip:
    "the left and right buttons are too hard to use". Two causes, and size was the smaller one. A held
    pad button repeated on a KEY's timing — first repeat after 260 ms — and a thumb on glass stays
    down about that long, so one tap of a turn arrow was very often two turns and you were facing
    backwards. `game.press` now waits 520 ms before a held turn repeats, then 340 ms a turn; a held
    step waits 300 ms and then walks at the keyboard's 165; about-face never repeats; and FIRE keeps
    its own clock (`padFire`), so one thumb walks while the other shoots — a held key stops the key
    before it, two thumbs should not. None of it is reachable from a keyboard (`padHeld` is cleared
    in `keydown`). The layout is a gamepad: movement under the left thumb, FIRE under the right, the
    screen between them in landscape and above them in portrait. **The round pad is read by ANGLE
    from its centre, not by which arrow was hit** — "turn left" is everything to the left, the whole
    square and 14px beyond it — with a rest in the middle and 14° of stickiness past each diagonal so
    a thumb lying on the line cannot chatter. Slide from one direction to the next without lifting.
    The genre's usual six-arrow pad (Legend of Grimrock on iOS) puts side-step beside turn and is
    documented as making people hit one for the other, so STEP is a separate pair of buttons above
    the pad with straight arrows, and the turns are bent ones. `--dp`, the pad's diameter, is
    whatever room is left (108–220px); under 140 the word STEP is dropped (`.snug`).
    Everything is under `.touch` / `if (ui.touch)`: **the desktop was checked byte-identical against
    production** (`?shot=1` and the start-up screen, same screenshot hash) — do that again after
    touching `fit()` or the stage CSS. `?touch=1` shows the phone layout on a desktop. Headless
    Chrome will not go narrower than 500px, so phone proof shots load the page in a 393px iframe
    (a scratchpad `t-frame.html`). There is no simulator on the Mac mini, so none of this could be
    tried on a device before it shipped; the keyboard fix was reasoned from WebKit's rules.
    **Philip tried it on his phone the same evening (Sep 20 2026): "I tried the phone. It's great."**
    He did not itemise, so the individual keyboard paths (envelope, tapping a field, the canvas
    message box) are not separately confirmed. `navigator.vibrate` ticks on Android; iOS has no such API.
  - **Working on it from the Mac mini.** `jsc` (JavaScriptCore's shell, at
    `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`) is there even
    though Node is not: `new Function(read(file))` syntax-checks, and levels/fonts/gfx/art/world/hall
    load headlessly (`var window = this`) — sprites can be rendered to PNG without a browser. The
    preview is the scratchpad-mirror recipe above; its launch entry lives in the ignored
    `MaseWars/.claude/launch.json`. `MW.game.dev` exposes `opts`/`phase`/`log` for posing scenes.
  - `img/og.png` is a photograph of the game, not a composed card: `?shot=1` poses a scene at 2×
    pinned to the top with the menu hidden; shoot it with headless Chrome at
    `--window-size=1200,630 --force-device-scale-factor=1`. Bump the `?v=` stamps in `index.html`
    whenever a script changes.

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
