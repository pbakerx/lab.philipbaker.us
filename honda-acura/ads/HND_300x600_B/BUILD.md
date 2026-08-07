# HND_300x600_B — Honda Creative B, 300x600

Standalone build reference for this creative. Mirrors the pipeline used
for Creative A — same `build.js`, same dealer CSV format, same tokens.

## 2026-05-29 revisions

- **Background:** the wide panning `bgnd_wide.png` (690×600) was replaced by a
  new STATIC `images/WoodSandBg.png` (300×600). `.wood-bg` now fills the frame
  1:1 (`top:0 left:0 width:300 height:600`, no animation). `bgnd_wide.png`
  stays in `images/` but is unused.
- **Frame 1 headline:** the DOM text "When summer calls, expert care delivers."
  was replaced by the client's `images/headline.svg` (272.001×102.667) as a
  plain `<img>` inside `.headline`. Displayed at `width:260, left:15, top:395`.
  Same fade-up (1.2s) / fade-out (3.9s) timing. Plain `<img>` keeps it
  file://-safe (no data-URI embed).
- **Logo:** the drop-shadowed `frame1_logo.png` was replaced by the flat vector
  `images/HondaLogo.svg` (copied from Honda A, native 128.309×32). `.logo`
  displays 131×32.66 at `left:85 top:30.7`; the CSS drop-shadow filter was
  removed (flat). `frame1_logo.png` is unused.
- **Frame 2 dealer copy:** `.visit-prefix` and `.dealer-name` now match Honda A
  exactly — `Arial, Helvetica; bold; 18px; line-height 1.18; letter-spacing
  0.1px`, HARD-SET at 18px for every dealer. The `fitDealerName()` auto-shrink
  JS was removed; long names wrap instead of shrinking. `.dealer-name` sits at
  `top:439`, one 18px line below the prefix at `top:418`. (2026-06-02 client
  rev: the copy block was raised 10px — was 428/449.)
- **Fonts:** the Avenir `@font-face` is now UNUSED (headline is SVG, dealer copy
  is system Arial). It is still present in `index.html` and is removable.

## Build it

```bash
cd "HTML5 Ads/build"

# Smoke test first 3 dealers
node build.js \
  --csv       "../../Dealer Lists/honda_dealers.csv" \
  --template  "../HND_300x600_B" \
  --out       "../Output/HND_300x600_B" \
  --click-url "https://automobiles.honda.com/tools/dealership-locator" \
  --limit 3

# Full run (784 dealers in ~10-20 s)
node build.js \
  --csv       "../../Dealer Lists/honda_dealers.csv" \
  --template  "../HND_300x600_B" \
  --out       "../Output/HND_300x600_B" \
  --click-url "https://automobiles.honda.com/tools/dealership-locator"

# Add --zip for one .zip per dealer
node build.js \
  --csv       "../../Dealer Lists/honda_dealers.csv" \
  --template  "../HND_300x600_B" \
  --out       "../Output/HND_300x600_B" \
  --click-url "https://automobiles.honda.com/tools/dealership-locator" \
  --zip
```

Each per-dealer output folder under `Output/HND_300x600_B/NNN_<DealerName>/`
is fully self-contained: `index.html`, `manifest.json`, `images/` (PNGs +
`headline.svg` + `HondaLogo.svg`), `fonts/` (the now-unused `.ttf`). Dealer
name is substituted into the `#dealer-name` span and into
`window.DEALER_DATA.dealerName`.

## Tokens replaced per dealer

| Token             | Where it appears             | Comes from CSV column |
|-------------------|------------------------------|-----------------------|
| `{{DEALER_NAME}}` | `<span id="dealer-name">`, JS | `DEALER_NAME`         |
| `{{DEALER_ID}}`   | JS (`window.DEALER_DATA`)     | `DEALER_ID`           |
| `{{CLICK_URL}}`   | JS (click handler fallback)   | `--click-url` flag    |

## Assets summary

| File | Source | Size | Notes |
|------|--------|------|-------|
| `images/WoodSandBg.png` | Honda B Assets | 300×600 | Static wood deck — fills frame 1:1 (`.wood-bg`) |
| `images/postcard1.png` | Honda B Assets | 382×315 | Lined back + flag stamp (F1 peek) |
| `images/postcard2.png` | Honda B Assets | 382×315 | Service Center scene (F1 top → F2 peek) |
| `images/postcard3.png` | Honda B Assets | 375×325 | Honda technician (F2 top) |
| `images/headline.svg` | client | 272.001×102.667 | Frame 1 outlined headline (plain `<img>`, shown 260 wide) |
| `images/HondaLogo.svg` | from Creative A | 128.309×32 | Flat Honda logo (shown 131×32.66, no shadow) |
| `images/frame1_cta.png` | from Creative A | 200×40 | GET SERVICE OFFERS |
| `images/bgnd_wide.png` | Honda B Assets | 690×600 | **UNUSED** — old panning wide deck (kept in `images/`) |
| `images/frame1_logo.png` | from Creative A | 131×34 | **UNUSED** — old drop-shadowed logo PNG |
| `fonts/AvenirNextRoundedStd-Medium.ttf` | from Creative A | — | **UNUSED** — `@font-face` no longer referenced (removable) |

Both Frame 2 dealer-copy lines ("Visit the experts at" prefix + dealer name)
are DOM text in **system Arial** — there is no rasterized prefix PNG. The
Frame 1 headline is now an SVG `<img>` rather than DOM text or a PNG. With the
headline as SVG and the dealer copy as system Arial, the Avenir `@font-face` is
no longer used; it remains declared in `index.html` and can be removed.

## Animation timing (8 s, one play)

The wood-deck background is **static** — `WoodSandBg.png` is 300×600 and
fills the frame 1:1 at `top:0 left:0` (no pan, no transform). All motion is
in the postcards and copy.
At t=0 the three postcards are parked off-frame to the right
(`translateX(380px)` baked into the base CSS); they slide on as the
ad plays.

| Time     | Event |
|----------|-------|
| 0.0s     | All three postcards parked off-frame right (`translateX(380px)` baked into base CSS) |
| 0.3s     | **Card 1** (lined back + flag stamp) slides 380 px in from off-frame, anchored at `left:-28, top:80`. Rotation `-3° → 0°` (slides in with a slight CCW tilt then settles to perfectly horizontal at rest). Most of the card is visible with the flag stamp in the upper-right. Rendered un-mirrored. |
| 0.5s     | **Card 2** (Service Center) slides in immediately after, lands at `left:-41, top:100` — straight horizontal slide with **no rotation** during entry, sitting above the headline copy. |
| 1.2s     | Headline (`headline.svg`, shown 260 wide at `left:15 top:395`) fades up |
| 1.8s     | CTA fades in once (persists) |
| 3.9s     | Headline fades out |
| 4.0–4.6s | **Card 1 slides back out** off-frame right (mirror of its entry) |
| 4.0–5.0s | **Card 2 lifts UP by 85 px and rotates +7° CW** (`translateY 0 → -85px, rotate(0deg → 7deg)`). The LEFT side of the postcard rises, exposing more of the red Honda on the upper-left side of the peek above Card 3. |
| 4.3–5.0s | **Card 3** (technician) slides in from off-frame right and lands **on top** of Card 2 at `top:90` (raised 10px on 2026-06-02 — was 100). `z-index: 4` puts it above Card 2's `z-index: 3`. With Card 2 sitting at effective top:65 (after its upward slide) and Card 3 at top:90, Card 2's top edge (Service Center sign area) peeks above the tech card in Frame 2. |
| 4.6s     | "Visit the experts at" prefix (DOM text) fades up at `top:418, 18 px` |
| 4.85s    | Dealer name (DOM text) fades up at `top:439, 18 px` |
| 8.0s     | Hold |

Card 2 enters perfectly horizontal (no rotation). During the shuffle it
lifts UP by 85 px and rotates +7° CW so the LEFT side of the postcard
rises, exposing more of the red Honda on the upper-left side of the peek
above Card 3. Card 3 lands at top:90 (raised 10px on 2026-06-02 — was 100).

## Frame 2 dealer copy

Both copy lines — the static `.visit-prefix` ("Visit the experts at") and
the dynamic `.dealer-name` (`{{DEALER_NAME}}` + trailing period) — are DOM
text styled to **match Honda A exactly**: `font-family: Arial, Helvetica;
font-weight: bold; font-size: 18px; line-height: 1.18; letter-spacing: 0.1px`.
Identical typography so the two lines read as one block. The prefix sits at
`top:418`; the dealer name at `top:439` — one 18px line below it (both raised
10px on 2026-06-02 to sit more centered on the wood plank).

The type size is **hard-set to 18 px for every dealer** regardless of name
length. There is no auto-shrink: long dealer names wrap to more lines rather
than scaling down, keeping the type consistent across all dealers (client
rule: "the font must be a fixed size regardless of who the dealer is").

> **2026-05-29:** dealer copy switched to system **Arial 18px bold** matching
> Honda A (was Avenir Next Rounded Std 17px), hard-set at a fixed size, and the
> `fitDealerName()` auto-shrink script was removed. Long names wrap instead of
> shrinking.

## Top-level docs

See `HTML5 Ads/README.md` for the full handoff workflow (CSV format,
troubleshooting, GWD import, font embedding). This folder uses the same
pipeline; everything documented there applies.
