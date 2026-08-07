# PB Productions — Honda × Acura Case Study (Animated)

A self-contained, scroll-driven case-study page for the Honda/Acura
Summer 2026 HTML5 display-ad program. Promotes **PB Productions /
Philip Baker** (not agency-branded). Built for LinkedIn/X sharing and
for embedding on the PB Productions site.

## Run it

Must be served over HTTP (the live-ad embeds `fetch()` their templates):

```bash
node ../.preview-server.js     # from project root, then open:
# http://localhost:8123/case-study/index.html
```

Or drop the whole `case-study/` folder on any static host. Everything
is inside this folder — no external dependencies except Google Fonts.

## What's inside

| Path | Role |
|---|---|
| `index.html` | The entire page — styles, copy, and JS in one file |
| `ads/<UNIT>/` | Live copies of the four approved 300×600 master templates, **tokens intact** (`{{DEALER_NAME}}` etc.). The page fetches these, stamps a real dealer in, and mounts them in iframes — the same substitution `build.js` does, done client-side |
| `assets/wall/*.jpg` | All 36 units rendered at 2× true size by headless Chrome, each hydrated with a different real dealer (shot via the freeze-frame harness pattern) |
| `assets/presented/*` | Client storyboard pages vs. shipped-ad renders for the review-loop section |
| `assets/dealers.json` | The real 1,012-dealer roster (from `presentation-assets/`) — drives the marquee, the random stamping, and the dealer-engine demo |
| `assets/og.jpg` | 1200×630 social share image (hero crop) |

## Notable mechanics

- **Live ad mounting** — `mountAd()` fetches a template, injects an
  absolute `<base>`, replaces the three build tokens, and sets iframe
  `srcdoc`. Replay buttons remount with a fresh random dealer.
- **Dealer-engine demo** — cycles real CSV rows every 3.6 s; the
  mounted ad is fast-forwarded to Frame 2 (`getAnimations().currentTime
  = 6800`) so the stamped dealer name is visible immediately.
- **`?still` mode** — appending `?still` to the URL reveals every
  section instantly (no scroll-triggered animation) and fixes the hero
  height; used for headless full-page screenshots and the OG image.

## Regenerating assets

- Wall renders: `scratchpad shoot_wall.py` pattern — headless Chrome,
  `--force-device-scale-factor=2`, freeze at 2.5 s (A/B) / 0.8 s (RT),
  one real dealer per unit. Re-run if any master template changes.
- OG image: shoot `?still` at 1200×860, crop 630 px starting y=112.
