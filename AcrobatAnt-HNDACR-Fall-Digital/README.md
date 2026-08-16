# Honda Acura Fall Digital — Version 1 (lab package)

Client-facing presentation of the Fall 2026 seasonal display work:
12 HTML5 ads (Honda A/B + Acura A/B × 728x90, 160x600, 320x50) with
storyboard reference peeks. Built for philipbaker.us/lab.

## What's in here

```
index.html      the presentation experience (single file, no build step,
                no external dependencies — fonts are system stacks)
ads/<UNIT>/     12 self-contained ad builds (each has its own index.html,
                runtime, and images; loaded one at a time in an iframe)
boards/*.jpg    6 storyboard page renders (one per brand × size; Creative
                A and B share the page, as the deck lays them out)
```

Everything is static and relative-pathed. Total ~36 MB; largest single
file ~3.3 MB (ad photography). No server logic, no env vars, no deps.

## Install on Vercel (philipbaker.us/lab)

The target URL is `philipbaker.us/lab/honda-acura-fall-v1/`.

1. Copy this whole folder into the Vercel project's static directory,
   keeping the folder name:
   - if the project serves from `public/`: `public/lab/honda-acura-fall-v1/`
   - if the lab is its own static project rooted at `/lab`: `honda-acura-fall-v1/`
2. Deploy. No build configuration is needed — it's plain static files.
3. Open `/lab/honda-acura-fall-v1/` — the page loads the Honda 728x90
   by default and plays it immediately.

Notes for the installing session:
- Do NOT flatten or rename `ads/*/` subfolders; each ad's `index.html`
  references its own `images/` and runtime files relatively.
- The trailing slash matters for the iframe-relative paths: link to the
  directory (`.../honda-acura-fall-v1/`), and let the platform serve
  `index.html`. Vercel does this by default for static dirs.
- If the project uses `cleanUrls` or custom routes, exclude this folder
  from rewrites so `ads/.../index.html?t=...` passes through untouched.

## Local check

```
cd hnd-acr-fall-v1 && python3 -m http.server 8080
```

then open http://127.0.0.1:8080/ — verify: brand tabs switch, each size
chip loads and plays its ad, Replay restarts it, See Storyboard opens the
right page, and the footer credit renders.

## Content notes

- Ads are one-shot (~8.5 s). Replay reloads the iframe — that is the
  intended replay mechanism; the units have no external replay hook.
- Dealer names are baked per package: Honda shows Norm Reeves Honda
  Superstore Huntington Beach, Acura shows Open Road Acura of East
  Brunswick. (Dealer is a build-time variable in the production pipeline.)
- Ad photography in `ads/` was downsampled for web delivery in THIS
  package only; production masters live in the build repo untouched.
