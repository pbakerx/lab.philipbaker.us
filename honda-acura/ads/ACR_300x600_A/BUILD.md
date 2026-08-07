# ACR_300x600_A — Acura Creative A, 300x600

Standalone build reference for this creative. Same pipeline as Honda
(shared `HTML5 Ads/build/build.js`), with Acura-specific assets, fonts,
and dealer list.

**Current scope:** Full 9-second Frame 1 → Frame 2 ad. Frame 1 (fade-up
from black, 10-layer car fan, yellow headline SVGs) cross-fades
into Frame 2 (Acura-trained technician slow zoom-in, white "Visit the
experts at" + dynamic dealer name).

## 2026-05-29 (session 2) revisions

- **Headline is now SVG, not a webfont.** The Futura `@font-face` blocks
  were removed; the headline is four client SVGs (`images/headline-01..04.svg`,
  one text line each) sharing one 953.333×569.333 canvas, overlaid as a
  self-stacking block. Original line-by-line fade-up preserved.
- **Stark hard drop-shadow** on `.headline`:
  `drop-shadow(3px 4px 0 rgba(0,0,0,0.9))` (sharp, no blur). It's a CSS
  filter on `<img>`, so it's `file://`-safe — the SVGs stay plain `<img>`
  (no data-URI embedding needed).
- **`.headline-scale` wrapper** scales/positions the whole block:
  `transform-origin: top center; transform: translateY(5px) scale(0.9)`.
- **Logo** scaled down 5% → 114×36.43 at `left:93 top:26.3` (top edge
  unchanged, re-centered to x=150).
- **The fan**: all 10 `.car` images are wrapped in `<div class="fan">`
  (`transform-origin: 50% 55%`). At rest the fan is `translateX(-15px)
  scale(0.7954)` (2026-06-02: reduced 3% from 0.82 + shifted left so the
  front grille isn't clipped). A `fan-shift` keyframe starts it at
  `translateX(0)` (blue car centered) and settles it to the −15px outpoint
  as one unit.
- **Gradient scrim**: `images/darkgradientoverlay.png` (300×600, black
  top+bottom, white middle) via `.fan-scrim` (z-index 11, `mix-blend-mode:
  multiply`, inside Frame 1).
- **Frame 2 dealer copy** is now Arial Bold (fallback Helvetica) 17 px,
  **fixed size for every dealer** — `fitDealerName()` auto-shrink removed.
- The Futura `@font-face` blocks are gone; the Avenir `@font-face` remains
  but is now unused (Frame 2 uses system Arial).

## Build it

```bash
cd "HTML5 Ads/build"

# Smoke test: first 3 dealers
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_A" \
  --out       "../Output/ACR_300x600_A" \
  --click-url "https://www.acura.com/service" \
  --limit 3

# Full run (228 Acura dealers)
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_A" \
  --out       "../Output/ACR_300x600_A" \
  --click-url "https://www.acura.com/service"

# Same, with --zip
node build.js \
  --csv       "../../Dealer Lists/acura_dealers.csv" \
  --template  "../ACR_300x600_A" \
  --out       "../Output/ACR_300x600_A" \
  --click-url "https://www.acura.com/service" \
  --zip
```

`Dealer Lists/acura_dealers.csv` (228 rows) was generated from
`Acura Full LIst.xlsx`. To regenerate after the client sends an updated
Excel, see the Python snippet in `HTML5 Ads/README.md`.

## Tokens replaced per dealer

| Token             | Where it appears                  | Comes from CSV column |
|-------------------|-----------------------------------|-----------------------|
| `{{DEALER_NAME}}` | `<span id="dealer-name">`, JS     | `DEALER_NAME`         |
| `{{DEALER_ID}}`   | JS (`window.DEALER_DATA`)         | `DEALER_ID`           |
| `{{CLICK_URL}}`   | JS (click handler fallback)       | `--click-url` flag    |

## Assets summary

| File | Source | Size | Notes |
|------|--------|------|-------|
| `images/car_base.png` | Acura A Assets/car_base_1.png | 487×325 | Cityscape + blue Acura car. Used 10× in the fan (`car-0`…`car-9`). |
| `images/AcuraLogo.svg` | client-supplied | 188.089×60.108 | "ACURA / Precision Service" vector mark. **Replaced the PNG** (same swap as Acura B). Displayed at 114×36.43 (scaled DOWN 5% from the prior 120×38.35; height from the SVG's own aspect so it isn't distorted), `left:93 top:26.3`, re-centered to x=150. |
| `images/acura_logo.png` | Acura A Assets/Acura_Logo.png | 120×39 | **UNUSED** — superseded by AcuraLogo.svg. Left in the folder. |
| `images/headline-01.svg` … `headline-04.svg` | client-supplied | 953.333×569.333 (shared canvas) | Outlined-text headline, one text line each ("PRECISION SERVICE FOR" / "SUMMER" / "THRILLS" / "ON REPEAT.", yellow `#f3c516`). All four share ONE canvas with each line pre-positioned, so the four `<img>` are OVERLAID at the same spot and self-stack into the full headline. **Replaced the Futura webfont.** |
| `images/darkgradientoverlay.png` | client-supplied | 300×600 | Gradient scrim — black top AND bottom, white through the middle. Applied via `.fan-scrim` (z-index 11, `mix-blend-mode: multiply`) to darken the fan's top/bottom edges for logo/headline/CTA legibility. (Originally supplied in Acura B's images folder by mistake, copied here.) |
| `images/cta.png` | Acura A Assets/cta.png | 228×42 | "GET SERVICE OFFERS" |
| `images/technician.png` | Acura A Assets/techncician.png | 300×600 | Frame 2 source (slow zoom-in). |

## Embedded fonts (all ship inside per-dealer output)

| File | Family registered as | Used for |
|------|---------------------|----------|
| `fonts/FuturaNowText-CnXBlk.otf` | — (no `@font-face`) | **UNUSED** — Frame 1 headline is now `headline-0N.svg`; the Futura `@font-face` block was removed. File left in `fonts/`. |
| `fonts/FuturaStd-CondensedExtraBd.otf` | — (no `@font-face`) | **UNUSED** — Futura `@font-face` removed. File left in `fonts/`. |
| `fonts/AvenirNextRoundedStd-Medium.ttf` | `"Avenir Next Rounded Std"` (weight 500) | **UNUSED in Acura A** — Frame 2 copy is now system Arial Bold. The `@font-face` is still registered (left in place) but nothing references the family. |

The Futura `@font-face` blocks were removed in session 2; only the Avenir
`@font-face` remains in `index.html`, and it is no longer referenced
(Frame 2 uses system Arial). `build.js` still copies the `fonts/` folder
verbatim to each per-dealer output.

## Animation timing (full 9 s ad)

| Time     | Event |
|----------|-------|
| 0.0s     | Black viewport. The 10-layer fan is ALREADY full (all `opacity:1`, rotationally aligned) and the `car-cascade` CCW rotation begins immediately — no fade-up intro. Runs over 6 s. |
| 0.0s     | Acura logo is ON from the first frame (persistent, no fade-in — 2026-06-02 client rev) |
| 1.50s    | Headline "PRECISION SERVICE FOR" (`headline-01.svg`, `.hl-pre`) fades up |
| 1.65s    | "SUMMER" (`headline-02.svg`, `.hl-1`) fades up |
| 1.80s    | "THRILLS" (`headline-03.svg`, `.hl-2`) fades up |
| 1.95s    | "ON REPEAT." (`headline-04.svg`, `.hl-3`) fades up |
| 2.5s     | CTA fades in (persistent — stays on screen the rest of the ad) |
| ~2.5–5.5s| **Hold on Frame 1** so the headline + fan can breathe |
| 5.5–5.94s| Frame 1 cross-fades out; Frame 2 fades in (technician shot). Scrim (inside Frame 1) fades with it. |
| 5.5–9.0s | Technician slow zoom (`scale(1.00)` → `scale(1.06)`, origin `50% 38%`) — gentler push-in than the earlier 1.10 rev |
| 6.2s     | "Visit the experts at" fades + slides up |
| 6.45s    | Dealer name (`{{DEALER_NAME}}` substituted by build.js) fades + slides up |
| 9.0s     | Hold last frame |

## Fan / cascade math

There are **10** car layers (`car-0` front, z-index 10 → `car-9` back,
z-index 1), all `car_base.png` at its natural 487×325 size, positioned
`left:-94 top:168` (vertically dropped 30 px from geometric center so the
fan reads with more space at the top for the headline), `transform-origin:
50% 50%`, `opacity: 1` from frame 1 (no fade-up intro).

At t=0 the stack is full but rotationally **aligned** — every layer at 0°,
only the START scale stepped (`1.10 × 1.11^N`), so `car-9` is ~2.815× and
covers the whole frame (no black). A single `@keyframes car-cascade` plays
over 6 s, rotating each layer CCW from 0° to its END angle while pushing
in; deeper layers rotate farther/faster, so the fan OPENS out of the
rotation. Per-layer values come from CSS custom props on `.car-N`:

- `--end-rot`: `-(4N + 6)°` (car-0 −6° … car-9 −42°)
- `--start-scale`: `1.10 × 1.11^N`; `--end-scale`: `start × 1.5`

**Fan wrapper:** all 10 cars are wrapped in `<div class="fan">`
(`position:absolute; z-index:1; full 300×600; transform-origin: 50% 55%`).
At rest the fan is `translateX(-15px) scale(0.7954)` (2026-06-02 client rev:
reduced 3% from 0.82 and shifted left 15px so the front grille is no longer
clipped at the right edge). The whole cascade scales as ONE unit. A
`fan-shift` keyframe runs the fan from `translateX(0)` at t=0 (blue car
centered in frame) to the −15px outpoint, reaching it by 90% (~5.4 s) and
HOLDING so the cross-fade outpoint is unchanged. The per-car `car-cascade`
still plays at this overall scale. Coverage was verified at 0.7954 (back
layer `car-9` still overflows all frame edges → no black). **Constraint:**
scaling much below ~0.73, or pushing the fan down more than ~40 px, makes
`car-9` stop covering the frame and exposes black edges.

**Gradient scrim:** `.fan-scrim` (`images/darkgradientoverlay.png`,
300×600, black top+bottom, white middle) sits ONE step above the fan
(z-index 11; cars are z-index 1–10) with `mix-blend-mode: multiply`,
INSIDE Frame 1 so it fades out with the cross-fade. The gradient's black
top/bottom darken the fan's top/bottom edges (white middle leaves the car
untouched) so the logo (z-index 30), headline (z-index 20) and CTA
(z-index 30) read clearly.

Tune the fan depth via the per-layer custom props on `.car-N`; tune the
overall size/position via `.fan`'s `transform`.

## Headline typography (Frame 1)

The headline is **no longer a webfont** — it is four client outlined-text
SVGs, one text line each:

- `images/headline-01.svg` — "PRECISION SERVICE FOR"
- `images/headline-02.svg` — "SUMMER"
- `images/headline-03.svg` — "THRILLS"
- `images/headline-04.svg` — "ON REPEAT."

All four share **one** 953.333×569.333 canvas with each line
pre-positioned, so the four `<img>` are OVERLAID at the same spot
(`.headline > *` is `position: absolute; top:0; left:0; width:100%`)
and self-stack into the full headline. Color is baked into the SVGs
(yellow `#f3c516`).

- **Hard drop-shadow** on `.headline`:
  `filter: drop-shadow(3px 4px 0 rgba(0, 0, 0, 0.9))` — sharp, no blur,
  per the comp. It's a CSS visual filter on `<img>`, which is
  `file://`-safe (unlike SVG-internal filters/masks), so the headline
  SVGs stay plain `<img src>` and do NOT need data-URI embedding.
- **`.headline-scale` wrapper** scales/positions the whole block as a
  unit without touching the per-line layout: `transform-origin: top
  center; transform: translateY(5px) scale(0.9)`. Dial overall size via
  `scale()`, vertical position via `translateY()`.

The lines keep the original line-by-line fade-up: the `fade-up-text`
keyframe on `.headline > *`, with per-line delays
`.hl-pre` 1.50 s, `.hl-1` 1.65 s, `.hl-2` 1.80 s, `.hl-3` 1.95 s.

## Frame 2 transition (technician + dealer copy)

Frame 1 cross-fades into Frame 2 between 5.5 and 5.94 seconds. The
mechanic happens via two synchronized keyframe animations on the frame
wrappers:

- `.frame-1` has `f1-fade-out` — opacity holds at 1 until 61% of the
  9 s timeline (5.5 s), then drops to 0 by 66% (5.94 s).
- `.frame-2` has `f2-fade-in` — opacity holds at 0 until 61% (5.5 s),
  then rises to 1 by 66% (5.94 s).

While Frame 2 is on screen:

- **Technician background** (`images/technician.png`, 300×600 — fills
  the viewport) slowly zooms in from `scale(1.00)` to `scale(1.06)`
  over 3.5 s linear, with `transform-origin: 50% 38%` (focuses on the
  mechanic's upper torso). The earlier rev zoomed to 1.10 in 4 s;
  reduced both the scale endpoint and the per-second rate for a
  gentler push-in per client review.
- **"Visit the experts at"** (`.visit-prefix`) — DOM text, white,
  **Arial Bold (fallback Helvetica) 17 px**, centered at `top:430`.
  Fades + slides up at 6.2 s.
- **Dealer name** (`.dealer-name`) — DOM
  `<span id="dealer-name">{{DEALER_NAME}}.</span>` (trailing period sits
  inside the span so it travels with the name), white, **Arial Bold
  (fallback Helvetica) 17 px**, centered at `top:450`, word-wraps for
  long names with `hyphens: auto`. Fades + slides up at 6.45 s.
  `build.js` substitutes the dealer name; the rendered HTML has the
  actual name in the span.
- **Fixed size for every dealer.** The old `fitDealerName()` auto-shrink
  JS was removed — the size is HARD-SET at 17 px regardless of name
  length (client: "the font must be a fixed size regardless of who the
  dealer is"). Long names wrap to more lines instead of shrinking.

The Acura logo and CTA are NOT inside either frame — they live as
direct children of `.gwd-page-container` at `z-index: 30` so they
persist through the cross-fade without flickering.

## Top-level docs

See `HTML5 Ads/README.md` for the full handoff workflow (CSV format,
troubleshooting, GWD import, font embedding). This folder uses the same
pipeline; everything documented there applies.
