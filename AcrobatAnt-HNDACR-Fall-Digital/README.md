# Honda Acura Fall Digital — lab package, round-aware (Version 3)

Client-facing presentation of the Fall 2026 seasonal display work, built for
lab.philipbaker.us. The page shows the **current round** of the ads on the stage (36
since Version 3: 2 brands × 6 sizes × A / B / retargeting static), with a prominent
**Compare** button that puts the **same ad from any earlier round** next to it — side
by side for the vertical sizes, stacked for the horizontals — same dealer, one timeline
driving both in lockstep. An ad that no earlier round holds is marked **new** (in the
size chips and where the Compare button would be). A **Client notes** drawer holds the
round's feedback **word for word**, each note with what changed and a "show me" that
parks both ads on the moment it is about; the masthead link opens the whole document.

```
index.html        the presentation (single file, no build step, no external deps)
rounds.json       every round, oldest first, each with its ad list — written by Scripts/build_lab_package.py
rounds/rvN/ads/   the round's self-contained ads (template.html + index.html + runtime + art);
                  rv0 and rv1 hold the original 12, rv2 onward all 36
rounds/rvN/feedback.json   the client's notes for that round, verbatim (optional)
boards/*.jpg      12 storyboard pages (brand × size)
dealers.js        the production dealer feeds (687 Honda / 189 Acura)
```

## Adding a round

1. Revise the units as usual (Builder → Save / gen_units.py / bake).
2. Add `Ad Build/present/rounds/rvN/round.json` (`label`, `title`, `note`) and, if the
   client sent notes, `feedback.json` in the same shape as rv1's.
3. `/usr/bin/python3 Scripts/build_lab_package.py --round rvN` — snapshots the units into
   `present/rounds/rvN/ads/` (tracked), reassembles `Ad Build/Output/lab/hnd-acr-fall-v2/`
   and its zip. Nothing else to edit: the page reads `rounds.json`.

## Deploy

Mirror `Ad Build/Output/lab/hnd-acr-fall-v2/` over `AcrobatAnt-HNDACR-Fall-Digital/` in the
`lab.philipbaker.us` repo (case-sensitive path), push; Vercel deploys. Verify the LIVE URL
serves the new `?v=` stamps before sharing. Full loop in the Vault note
"Starting and Shipping a New Project.md".

## Local check

The project preview server serves the assembled package:
`http://localhost:8124/Ad%20Build/Output/lab/hnd-acr-fall-v2/`
