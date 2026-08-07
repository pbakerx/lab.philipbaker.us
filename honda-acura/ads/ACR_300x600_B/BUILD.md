# ACR_300x600_B — Acura Creative B, 300x600

Standalone build reference for this creative. Same pipeline as Honda /
Acura A (shared `HTML5 Ads/build/build.js`), with Acura-B-specific
assets and timing.

**Current scope:** Full 9-second Frame 1 → Frame 2 ad. Frame 1 (white
Acura car driving past the camera over a sunset road, with a vector
heat-wave overlay rippling continuously across the sky band, white
headline) cross-fades into Frame 2 (Acura-trained technician slow
zoom-in, white "Visit the experts at" + dynamic dealer name).

## 2026-05-29 (session 2) revisions

Typography-only pass — **this creative now loads ZERO webfonts.**

- **Frame 1 headline** is no longer Futura live type. The Futura
  `@font-face` blocks were removed; the headline is now four client
  outlined-text SVGs (`images/headline-01.svg` … `headline-04.svg`), one
  line each, overlaid on a shared canvas. No drop shadow (the Acura B
  comp has none). See *Headline (Frame 1)* below.
- **Frame 2 dealer copy** (`.visit-prefix` + `.dealer-name`) unified to
  system **Arial Bold** (fallback Helvetica), **fixed 20 px** for every
  dealer. The Avenir `@font-face` and the `fitDealerName()` auto-shrink
  JS were both removed. See *Frame 2 transition* below.
- The Futura + Avenir font files remain in `fonts/` but are **unused**.

## 2026-05-29 (session 3) revisions

Frame 1 white-car positioning pass:

- **White-car background lifted UP 30 px.** The `<img class="bg">` is now
  wrapped in `<div class="bg-shift">` carrying `transform:
  translateY(-30px)`. Done via a wrapper (not by editing the car's own
  transform) so the `car-pan` animation keeps its transform-origin / pivot
  exactly — the wrapper just translates the rendered result up 30 px.
- **`car-pan` END scale bumped 1.00 → 1.05** (keyframe is now
  `scale(1.20)` → `scale(1.05)`) so the bottom of the frame stays covered
  after the 30 px lift. Coverage verified through the cross-fade window
  (bottom stays covered up to ~5.94 s). The zoom-out is now ~12.5%
  (was 16.7%).

## 2026-06-02 (round 2 — client revisions, post-presentation)

Three client notes from the presentation; ACR_300x600_B source only.
Pre-edit backups live at `*.backup-2026-06-02-pre-client-revisions`.

- **Acura logo ON from t=0.** `.logo` was `opacity:0` + `animation:
  fade-in 0.5s …; animation-delay:0.6s;` → now `opacity:1` with NO
  animation (client: "should already be on from the beginning"). Still a
  direct child of `.gwd-page-container` at `z-index:30`, so it persists
  through the cross-fade.
- **White MDX shrunk ~7% so it isn't cropped.** `.frame-1 .bg-shift`
  went `translateY(-30px)` → `translateY(-10px) scale(0.93)`. The lift was
  cut −30 → −10 at the SAME time as the scale-down: `car_wide.png` is
  fit tightly to the 600 px frame height, so a pure scale-down would have
  exposed the dark background at the bottom — the smaller lift keeps the
  bottom covered. The `car-pan` keyframe (translateX distance, duration,
  rotation) is UNCHANGED.
- **Heat-wave treatment subtler + kept to the sky** (client: "too
  distorted… make it more subtle… should only be on the sky… mask out
  the lines bleeding into the landscape"):
  - **New cleaner SVG.** Client supplied a smoother `HeatWaveVector.svg`
    (~86 KB), embedded as a base64 data URI in index.html (TWICE — `href`
    + `xlink:href` on the `<image>`). Re-embed on every change.
  - **Filter softened** (`#heatRipple`): `feTurbulence baseFrequency`
    `0.010 0.022 → 0.006 0.013`, `numOctaves 2 → 1`; displacement scales
    horizontal `18 → 14`, vertical swell `34 → 20`.
  - **Sky band tightened.** `.heatwaves` gradient mask
    `… 18%, transparent 32% → … 16%, transparent 22%` (clipped higher so
    waves stay above the hills); `<image>` nudged `y="-16" → "-6"`.
    Verified no landscape bleed at the start of the pan (horizon highest).

The storyboard direction:

> **Frame 1** — "Heat waves animate to show mirage-like motion. Pan
> from left to right across the vehicle as if it is driving past
> camera. Headline animates in."  Copy: *SUMMER ROAD TRIPS HANDLED
> WITH PRECISION.* (white Futura)
>
> **Frame 2** — "Transition to Acura-Trained Technician, slowly
> zooming in. Text animates in."  Copy: *Visit the experts at
> {{DEALER_NAME}}.*

## Build it

```bash
cd "HTML5 Ads/build"

# Smoke test: first dealer
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_B" \
  --out       "../Output/ACR_300x600_B" \
  --click-url "https://www.acura.com/service" \
  --limit 1

# Full run (228 Acura dealers)
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_B" \
  --out       "../Output/ACR_300x600_B" \
  --click-url "https://www.acura.com/service"

# Same, with --zip
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_B" \
  --out       "../Output/ACR_300x600_B" \
  --click-url "https://www.acura.com/service" \
  --zip
```

`Dealer Lists/acura_dealers.csv` (228 rows) is shared with `ACR_300x600_A`.
See `HTML5 Ads/README.md` for the Python snippet that regenerates it from
the source Excel.

## Tokens replaced per dealer

| Token             | Where it appears                  | Comes from CSV column |
|-------------------|-----------------------------------|-----------------------|
| `{{DEALER_NAME}}` | `<span id="dealer-name">`, JS     | `DEALER_NAME`         |
| `{{DEALER_ID}}`   | JS (`window.DEALER_DATA`)         | `DEALER_ID`           |
| `{{CLICK_URL}}`   | JS (click handler fallback)       | `--click-url` flag    |

## Assets summary

| File | Source | Size | Notes |
|------|--------|------|-------|
| `images/car_wide.png` | Acura B - Assets/car_wide.png | 800×688 | White Acura on sunset road (client replaced the original 705×600). Fit to 600 px height → 697.7 px wide, `left:-199` (centered). The `<img class="bg">` is wrapped in `<div class="bg-shift">` (`translateY(-10px) scale(0.93)` — 2026-06-02 client rev: shrunk ~7% so the vehicle isn't cropped, lift reduced −30 → −10 to keep the bottom covered) to scale/lift the whole car layer without altering the pan pivot. Animates with a "driving away" move — see the timing table + `car-pan` keyframe. |
| `images/HeatWaveVector.svg` | client-supplied | ~86 KB | Vector heat-wave lines. **2026-06-02 client rev: client supplied a new, cleaner/smoother version** (replaced the earlier 32-path file). Top-center, animated ripple filter, overlay `opacity:0.5`. **EDITABLE SOURCE — but embedded TWICE as a base64 data URI in index.html** (`href` + `xlink:href` on the `<image>`; see the `file://` gotcha in the heat-wave section). Re-embed when changed. |
| `images/maskforwaves.svg` | client-supplied | 310×910 | Grayscale luminance mask (soft white blobs on black) for the "vertical lift" rising reveal. **EDITABLE SOURCE — embedded as a downscaled, gamma-brightened `data:image/png` in index.html** (`--rise-mask`). Re-embed (extract raster → gamma → base64) when changed. |
| `images/headline-01.svg` … `headline-04.svg` | client-supplied | 459.115×282.293 (each) | Frame 1 headline lines as outlined text — SUMMER / ROAD TRIPS / HANDLED WITH / PRECISION. (white). One line of text per file, but all four share the SAME canvas with each line pre-positioned, so the four `<img>` are OVERLAID at the same box and self-stack into the full headline. Plain `<img>` — **file://-safe, NOT embedded** (see headline section). |
| `images/heatwaves.png` | Acura B - Assets/heatwaves.png | 935×600 | **UNUSED** — the original mix-blend PNG shimmer. Left in the folder but no longer referenced; superseded by HeatWaveVector.svg. |
| `images/technician.png` | Acura B - Assets/technician.png | 300×600 | Frame 2 background — same shot used in Acura A. |
| `images/AcuraLogo.svg` | client-supplied | 188.089×60.108 | "ACURA / Precision Service" vector mark. **Replaced the PNG.** Displayed at 120×38.35 (scaled to the PNG's width, height from the SVG's own aspect so it isn't distorted), centered at top. |
| `images/acura_logo.png` | shared with Acura A | 120×39 | **UNUSED** — superseded by AcuraLogo.svg. Left in the folder. |
| `images/cta.png` | shared with Acura A | 228×42 | "GET SERVICE OFFERS" |

## Fonts — NONE (zero webfonts)

**This creative loads no webfonts.** As of the 2026-05-29 (session 2)
revision BOTH the Futura AND the Avenir `@font-face` blocks were removed
from `index.html`:

- Frame 1 headline = the client's `headline-0N.svg` outlined-text files
  (no live type).
- Frame 2 dealer copy = system **Arial Bold** (fallback Helvetica).

The font files below still ship in `fonts/` (build.js copies the folder
verbatim) but are **UNUSED** — nothing references or `@font-face`-loads
them. Drop them if you want a leaner package.

| File | Status |
|------|--------|
| `fonts/FuturaNowText-CnXBlk.otf` | **UNUSED** — was the Frame 1 headline; headline is now SVG |
| `fonts/FuturaStd-CondensedExtraBd.otf` | **UNUSED** — was the headline fallback |
| `fonts/AvenirNextRoundedStd-Medium.ttf` | **UNUSED** — was the Frame 2 dealer copy; now system Arial Bold |

## Animation timing (full 9 s ad)

| Time     | Event |
|----------|-------|
| 0.0s     | Warm-dark viewport, car_wide.png pinned at its starting position (vehicle slightly right of center) |
| 0.0–7.0s | `car-pan` "driving away" move (linear, single start→end so pan/scale/rotation stay in lockstep): translateX −42 → +35 px (recedes left-to-right), scale 1.20 → 1.05 (~12.5% zoom-out — end bumped 1.00 → 1.05 to keep the bottom covered after the `.bg-shift` lift), rotate 0 → −2° (subtle counter-clockwise tilt). **The `car-pan` keyframe itself is UNCHANGED.** The `<img class="bg">` is wrapped in `<div class="bg-shift">` (`translateY(-10px) scale(0.93)` — 2026-06-02 client rev: was `translateY(-30px)`; the car was scaled ~7% smaller so the vehicle isn't cropped, and the lift was reduced −30 → −10 at the same time so the tightly-fit car_wide.png still covers the bottom edge after shrinking) so the car layer renders smaller/higher without touching the pan's transform-origin/pivot. Modeled on Honda A's `bg1-pan` |
| 0.0–9.0s | Heat-wave ripple: the `#heatRipple` filter slides its noise field steadily left (`feOffset dx` 0 → −160, `repeatCount=1` `fill=freeze` — one continuous drift, NO loop/reversal). Two displacement passes wobble the vector lines (horizontal `scale=14`, vertical swell `scale=20` — 2026-06-02 client rev: softened from 18/34 for a subtler shimmer) so they ripple like rising heat |
| 0.0–6.0s | `heat-rise`: the luminance lift mask (`maskforwaves.svg`) scrolls UP `mask-position` center 0 → −200 px (linear), so the revealed lines climb and lift off — the "rising heat" read |
| 0.0s     | Acura logo ON from t=0 (2026-06-02 client rev — was a `fade-in` at `animation-delay:0.6s`; now `opacity:1`, no animation, persistent `z-index:30`) |
| 1.50s    | "SUMMER" fades up |
| 1.65s    | "ROAD TRIPS" fades up |
| 1.80s    | "HANDLED WITH" fades up |
| 1.95s    | "PRECISION." fades up |
| 2.5s     | CTA fades in (persistent — stays on screen the rest of the ad) |
| 2.5–5.5s | **Hold on Frame 1** — heat-shimmer continues, headline holds, pan is still rolling |
| 5.5–5.94s| Frame 1 cross-fades out; Frame 2 fades in (technician shot) |
| 5.5–9.0s | Technician slow zoom (`scale(1.00)` → `scale(1.06)`, origin `50% 38%`, linear over 3.5 s) |
| 6.2s     | "Visit the experts at" fades + slides up |
| 6.45s    | Dealer name (`{{DEALER_NAME}}` substituted by build.js) fades + slides up |
| 9.0s     | Hold last frame |

## Heat-wave overlay

> **2026-05-28 client rev — REPLACED the original PNG mix-blend shimmer.**
> The earlier mechanic (a `heatwaves.png` overlay with
> `mix-blend-mode: screen` + a transform keyframe) was scrapped after the
> client supplied a vector line file. The current overlay is the client's
> `images/HeatWaveVector.svg` placed top-center, with an animated SVG
> filter running a horizontal heat ripple through the lines. (The history
> of the rejected hand-built `<pattern>` overlay is omitted — it was
> abandoned mid-iteration in favour of the client's file.)

The overlay lives in an inline `<svg class="heatwaves" viewBox="0 0 600
600">` positioned `left:-150 width:600 height:600` (so user-x 300 = frame
center, and the displacement bleed never exposes a horizontal edge). The
client SVG is drawn into it via `<image href="…" x="110" y="-6"
width="380" height="362">` (top-centered: width 380, centered on x=300 →
x=110), with `filter="url(#heatRipple)"`. (2026-06-02 client rev: the
`<image>` was nudged down `y="-16" → "-6"` so the waves sit in the sky
band. The `href` is embedded TWICE — `href` + `xlink:href` — because the
client supplied a new, cleaner SVG and an external SVG inside an SVG
`<filter>` is blocked under `file://`.)

> **⚠ `file://` GOTCHA — the line + mask SVGs are EMBEDDED as data URIs,
> not linked.** Chrome blocks an external `.svg` that is pulled into an
> SVG **filter** or a CSS **mask** when the page is opened from `file://`
> (treats it cross-origin → renders nothing). It works fine served over
> http/https (and in the Claude preview), but the client double-clicking
> `index.html` saw no heat waves. Fix: the HeatWaveVector lines are
> embedded in the `<image href="data:image/svg+xml;base64,…">`, and the
> lift mask is embedded as a `data:image/png;base64,…` data URI (see the
> `--rise-mask` custom property). So `images/HeatWaveVector.svg` and
> `images/maskforwaves.svg` remain in the folder as the EDITABLE SOURCES,
> but `index.html` carries embedded copies and no longer links them.
> **When either source SVG changes, re-embed it** (extract its raster /
> base64 the file and replace the data URI) — don't just drop the new
> file in. Regular `<img>` assets (car, logo, technician, cta) are NOT
> affected and stay external.

**Sky-only mask:** `mask-image: linear-gradient(to bottom, black 0%,
black 16%, transparent 22%)` — fully opaque to ~16% of viewport height
(~96 px), feathered to transparent by 22% (~132 px). **2026-06-02 client
rev: clipped higher** (was 18%/32% = 108/192 px) so the waves stay above
the hills and do NOT bleed onto the landscape — verified at the start of
the pan (the most zoomed-in moment = horizon highest). (Earlier this was
pulled UP from 24%/40% per client; the current 16%/22% is tighter still.)
The lines never ripple over the car or road. The Acura logo (`z-index:
30`) sits on top in this band. Include both `-webkit-mask-image` and
`mask-image`.

**The `#heatRipple` filter (the whole effect):**
1. `feTurbulence` `fractalNoise` `baseFrequency="0.006 0.013"`
   `numOctaves="1"` `seed="5"` — a STATIC noise field (computed once, no
   boil/flicker). **2026-06-02 client rev:** baseFrequency lowered
   `0.010 0.022 → 0.006 0.013` (stretched horizontally + fewer vertical
   oscillations) and `numOctaves 2 → 1` (single-octave = smoother, less
   random) per client "more subtle… less distorted/irregular."
2. `feOffset` slides that noise field steadily LEFT across the 9 s
   timeline: `<animate attributeName="dx" from="0" to="-160" dur="9s"
   repeatCount="1" fill="freeze">`. `repeatCount=1` + `fill=freeze` =
   ONE fluid horizontal drift, **no loop, no ping-pong reversal** — this
   is what fixed the earlier "stop/start stutter" (the old version
   ping-ponged `baseFrequency`, and the reversal at the midpoint read as
   a stutter). Filter region is `x="-40%" y="-40%" width="180%"
   height="180%"` so the drift never pulls a transparent edge into the
   visible/masked area.
3. Two `feColorMatrix` + two `feDisplacementMap` passes split the
   displacement so HORIZONTAL ripple and VERTICAL swell tune
   independently. Each color-matrix forces the OTHER axis' channel to
   0.5 (= no shift on that axis): `nzX` keeps R / forces G→0.5; `nzY`
   forces R→0.5 / keeps G. Then pass A displaces X only (`scale=14`),
   pass B displaces Y only (`scale=20`). (2026-06-02 client rev: softened
   from `18` / `34`.)

**Tuning knobs (all in the `#heatRipple` filter, labeled with `►► ◄◄`):**
- **SWELL HEIGHT** — second `feDisplacementMap scale` (currently `20`).
  How tall peaks rise / valleys fall. Was bumped 18→34 ("exaggerate"),
  then dialed back `34 → 20` on 2026-06-02 per client ("more subtle…
  too distorted").
- **HORIZONTAL RIPPLE** — first `feDisplacementMap scale` (currently
  `14`, was `18` — softened 2026-06-02). Sideways wobble amplitude.
- **FLOW DISTANCE / SPEED** — the `feOffset` `<animate to="-160">`. More
  negative = faster / further travel over the timeline.

**Line weight + opacity:** the client vector ships with no `stroke-width`
(defaults to 1 in its 802-wide canvas). Per client we set
`stroke-width="5"` on all 32 paths IN the SVG file (was 3 → bumped 2 pt
thicker). NB it renders at ~0.47× (380 / 802.875), so 5 in-file ≈ 2.4 px
on screen; raise the in-file value for a heavier on-screen line. Overlay
`opacity` is `0.5` on `.frame-1 .heatwaves` (settled here after the
client walked it 0.8 → 0.95 → 1 then back to 0.5 for a softer,
more atmospheric shimmer); reduced-motion block carries the same value.

If the storyboard horizon shifts (a new size's car puts the treeline
higher/lower), adjust the mask gradient's 16% / 22% stops and the
`<image>` `y` to match the new sky band.

## "Vertical lift" reveal (the rising heat)

On top of the ripple, the lines get a **rising-reveal** so they read as
heat lifting off. The heat-wave `<svg>` is wrapped in
`<div class="heatwaves-rise">` (covers the 300×600 frame), which carries
a SECOND mask — the client's `images/maskforwaves.svg`, a 310×910
grayscale of soft white blobs on black — used as a **LUMINANCE** mask
(`mask-mode: luminance`; white reveals the lines, black hides them). The
inner `<svg>` keeps its own sky-band mask, so the two compose (lines show
only where BOTH allow).

- **Mask is top-aligned + centered, then scrolled UP** over Frame 1 so
  the revealed areas climb and the lines appear to rise:
  `@keyframes heat-rise { 0% { mask-position: center 0 } 100% {
  mask-position: center -200px } }`, `animation: heat-rise 6s linear`.
  `mask-size: 310px 910px`, `mask-repeat: no-repeat`.
  - **►► RISE DISTANCE / SPEED ◄◄** = the `-200px` end value (more
    negative = lifts further/faster over the 6 s). Was −130, bumped to
    −200 per client ("see more of the mask, move it faster").
- **Mask strength is dialled by a GAMMA brighten baked into the embedded
  PNG**, NOT by raising the black floor. Earlier a floor-raise ("50% less
  strong", black→50% gray) was REJECTED — it washed out / muddied the
  gaps. Instead: `out = 255·(in/255)^gamma`, `gamma = 1 − strengthCut`.
  Current **strengthCut = 0.25 (gamma 0.75)** — "25% less strength":
  brightens mids/lights so lines read more in the revealed areas, while
  **black stays 0 (gaps stay fully hidden)**. To re-tune, re-run the
  embed with a different `STRENGTH_CUT` (0 = mask as-authored; higher =
  lines more apparent). The embedded mask PNG is downscaled to 155×455
  (it's soft/blurry, so low-res is invisible) to keep `index.html` lean.
- Reduced-motion: `.frame-1 .heatwaves-rise` is in the
  `prefers-reduced-motion` reset (Frame 1 is hidden there anyway).

## Headline (Frame 1) — client outlined-text SVGs

> **2026-05-29 (session 2) — the headline is no longer a webfont.** The
> Futura `@font-face` blocks were removed. The headline is now four
> client-supplied outlined-text SVGs, one line of text each.

- Text: "SUMMER / ROAD TRIPS / HANDLED WITH / PRECISION." (white,
  `#ffffff` baked into the SVGs — distinct from Acura A's yellow headline)
- Files: `images/headline-01.svg` … `headline-04.svg` (one line per file).
  **All four share the SAME 459.115×282.293 canvas with each line
  pre-positioned**, so the `<img>` are simply OVERLAID at the same spot
  and self-stack into the full headline — there is no per-line layout in
  CSS.
- Markup: `.headline > *` (the four `<img>`) are `position:absolute;
  top:0; left:0; width:100%; height:auto` — every line fills the same box.
- Container: `.headline` is `left:34 top:358 width:228`. At 228 px wide
  the 4-line block lands ≈120 px tall, text spanning y≈366→486 — matching
  the old 32 px font block, vertically centered between the bottom of the
  car (y≈320) and the top of the CTA (y≈532).
- **No drop shadow** — deliberate. The Acura B comp has none (this differs
  from Acura A, whose comp has a hard shadow). The SVGs are plain `<img>`
  (not inside a filter or mask), so they are **file://-safe and do NOT
  need data-URI embedding** — they stay external like the car/logo/cta.

The four lines keep the original line-by-line fade-up: `.headline > *`
animates `fade-up-text` (0.55 s) with per-line delays `hl-1` 1.50 s,
`hl-2` 1.65 s, `hl-3` 1.80 s, `hl-4` 1.95 s. To re-scale, change
`.headline { width / top }` (the lines scale with the container width).

## Frame 2 transition (technician + dealer copy)

Frame 1 cross-fades into Frame 2 between 5.5 s and 5.94 s of the 9 s
timeline. Same recipe as Acura A:

- `.frame-1` has `f1-fade-out` — opacity holds at 1 until 61% of the
  9 s (5.5 s), then drops to 0 by 66% (5.94 s).
- `.frame-2` has `f2-fade-in` — opacity holds at 0 until 61% (5.5 s),
  then rises to 1 by 66% (5.94 s).

While Frame 2 is on screen:

- **Technician background** (`images/technician.png`, 300×600) zooms
  in from `scale(1.00)` to `scale(1.06)` over 3.5 s linear, with
  `transform-origin: 50% 38%` (focuses on the mechanic's upper torso).
  Animation-delay is 5.5 s — it kicks off exactly when the cross-fade
  begins.
**Type — unified Arial Bold, fixed size (2026-05-29 session 2):**
`.visit-prefix` and `.dealer-name` now share IDENTICAL type so the block
reads as ONE unit even though the dealer name is dynamic from the CSV:
`font-family: Arial, Helvetica, sans-serif; font-weight: 700;
font-size: 20px; line-height: 1.15; letter-spacing: 0`, white. This
replaced the old Avenir Next Rounded Std (no webfont is loaded anymore;
fallback is Helvetica). The `fitDealerName()` auto-shrink JS was
**REMOVED** — size is **FIXED 20 px for every dealer** (client: "fixed
size regardless of dealer"); long names just wrap to more lines.

- **"Visit the experts at"** — `.visit-prefix`, DOM text, centered,
  `top:432`. Fades + slides up at 6.2 s.
- **Dealer name** — `.dealer-name` / `<span id="dealer-name">{{DEALER_NAME}}.</span>`,
  centered, `top:455` — exactly one line-height below the prefix
  (432 + round(20×1.15)=23 = 455), so the prefix→name gap equals the
  leading inside the wrapped name and the two lines read as a single
  paragraph. `word-break: break-word` lets long names wrap. Fades +
  slides up at 6.45 s. `build.js` substitutes the dealer name into the
  span (with a trailing period in the markup).

The Acura logo and CTA are NOT inside either frame — they live as
direct children of `.gwd-page-container` at `z-index: 30` so they
persist through the cross-fade without flickering.

## Top-level docs

See `HTML5 Ads/README.md` for the full handoff workflow (CSV format,
troubleshooting, GWD import, font embedding). This folder uses the same
pipeline; everything documented there applies.
