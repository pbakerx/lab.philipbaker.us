#!/usr/bin/env python3
"""Sweep the <head> of every lab page from one place.

The lab has no build step and no shared template, so a tag that belongs on
every page has to be written into every page. Doing that by hand is how a page
ends up with two copies of a tag, or none. This script is the one place.

    scripts/head-meta.py status                 # both blocks, every page
    scripts/head-meta.py pages                  # the page set, and every omission

    scripts/head-meta.py ga add G-XXXXXXXXXX    # the GA4 tag
    scripts/head-meta.py ga remove
    scripts/head-meta.py ga status

    scripts/head-meta.py events add             # /shared/analytics.js
    scripts/head-meta.py events remove
    scripts/head-meta.py events status

Everything it writes is wrapped in a sentinel comment pair, so it can find its
own work again to count it or take it back out:

    <!-- GA4:START -->        ...  <!-- GA4:END -->
    <!-- LAB-EVENTS:START -->  ...  <!-- LAB-EVENTS:END -->

Discipline, per `00. Technical Notes/Analytics and SEO for a Client Site.md`:

  * the anchor (`</head>`) must occur exactly once in a file, or the file is
    skipped loudly rather than guessed at;
  * a re-run changes nothing ("already present");
  * writes are atomic (temp file + os.replace), so an interrupted run cannot
    leave a half-written page;
  * files are read and written with no line-ending translation, so a CRLF file
    does not come back with every line changed;
  * `add` / `remove` / `status` per block, so each install is reversible and
    countable on its own.

After any sweep, check all four before committing:

    git diff --stat        touches exactly the number of pages you expect
    git diff --numstat     identical insertion counts, zero deletions
    scripts/head-meta.py status        every page reports present, once
    re-run the same add    reports "already present", modifies 0 files
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANCHOR = "</head>"

# Pages that get sweep-managed head tags.
#
# The set is "every page-level HTML file a visitor can navigate to", which is
# the same set that already carries the Vercel Web Analytics tag, minus the two
# exclusions below. It is written out rather than globbed so that adding a
# project is a deliberate edit here.
PAGES = [
    "index.html",
    "404.html",
    "ai-solves-billing/index.html",
    "second-brain-case-study/index.html",
    "widget-maker/index.html",
    "missile-command/index.html",
    "missile-command-deluxe/index.html",
    "maze-wars/index.html",
    "vault/index.html",
    "vault/player.html",
    "vault/play.html",
    "90s-web-ackerman-mcqueen/index.html",
    "staplegun/index.html",
    "paste-plain/index.html",
    "GPT/index.html",
    "honda-acura/index.html",
    "hello/index.html",
]

# Why each omission is an omission and not an oversight:
EXCLUDED = {
    "widget-maker/frame.html":
        "embedded iframe inside /widget-maker, not a navigation — it would "
        "double-count every widget build as a second page view",
    "AcrobatAnt-HNDACR-Fall-Digital/index.html":
        "unlisted client review link. Keeps Vercel Web Analytics, which already "
        "answers 'did the client open it'; a client reviewing unreleased creative "
        "does not get sent to Google Analytics",
    "OKEII-SRA-Deployment/index.html":
        "unlisted client review link — same reason",
    "AcrobatAnt-HNDACR-Fall-Digital/rounds/*/ads/*/*.html":
        "individual ad creatives, served inside an iframe via srcdoc",
    "honda-acura/ads/*/index.html":
        "individual ad creatives",
    ".claude/og-cards/*.html":
        "source files for generated social cards, never served",
}

# `vault/player.html` and `vault/play.html` ARE included even though robots.txt
# disallows them: "do not index this" and "do not measure this" are different
# questions, and they are how anyone actually plays a Vault game. Without them
# the numbers cannot answer whether a recovered game was ever played — and it is
# from those two pages that /shared/analytics.js reports `game_start` for the
# Vault, which is why the events block has to reach them too.

GA_ID_RE = re.compile(r"G-[A-Z0-9]{6,}")


def ga_body(nl: str, mid: str) -> list[str]:
    """The GA4 tag, with Google Signals and ad personalisation off."""
    return [
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={mid}"></script>',
        "<script>",
        "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}",
        "gtag('js',new Date());",
        f"gtag('config','{mid}',"
        "{allow_google_signals:false,allow_ad_personalization_signals:false});",
        "</script>",
    ]


def events_body(nl: str, arg: str) -> list[str]:
    """The lab's own event tracking. See shared/analytics.js for what it sends."""
    return ['<script src="/shared/analytics.js" defer></script>']


BLOCKS = {
    "ga": {
        "start": "<!-- GA4:START -->",
        "end": "<!-- GA4:END -->",
        "body": ga_body,
        "needs_arg": True,
        "what": "GA4 tag",
    },
    "events": {
        "start": "<!-- LAB-EVENTS:START -->",
        "end": "<!-- LAB-EVENTS:END -->",
        "body": events_body,
        "needs_arg": False,
        "what": "/shared/analytics.js",
        # Per-block omissions. The GA4 tag goes everywhere; this one does not.
        "skip": {
            "maze-wars/index.html":
                "Philip's call, Sep 21 2026: no edits to the Maze Wars game, at all. "
                "It keeps the GA4 tag (page views, like every page) and nothing else. "
                "So /maze-wars reports page_view but no select_item and no game_start — "
                "do not 'fix' that by sweeping it back in.",
        },
    },
}


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def write_atomic(path: str, text: str) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".head-meta.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def newline_of(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def indent_of(text: str, idx: int) -> str:
    """The whitespace at the start of the anchor's own line."""
    bol = text.rfind("\n", 0, idx) + 1
    return text[bol:idx] if text[bol:idx].strip() == "" else ""


def each_page(spec=None):
    skip = (spec or {}).get("skip", {})
    for rel in PAGES:
        if rel in skip:
            yield rel, os.path.join(ROOT, rel), None, "skip"
            continue
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            yield rel, path, None, "MISSING"
            continue
        text = read(path)
        n = text.count(ANCHOR)
        if n != 1:
            yield rel, path, text, f"ANCHOR x{n}"
            continue
        yield rel, path, text, "ok"


def find_block(text: str, spec):
    """(start, end_exclusive, count) of the sentinel block, or None."""
    s0, e0 = spec["start"], spec["end"]
    count = text.count(s0)
    if count == 0:
        return None
    s = text.find(s0)
    e = text.find(e0, s)
    if e == -1:
        return (s, len(text), count)
    e += len(e0)
    while e < len(text) and text[e] in "\r\n":
        e += 1
    return (s, e, count)


def cmd_pages() -> int:
    print(f"{len(PAGES)} swept pages:\n")
    for rel, _path, _t, state in each_page():
        flag = "" if state == "ok" else f"   <-- {state}"
        print(f"  {rel}{flag}")
    print("\ndeliberately not swept:\n")
    for pat, why in EXCLUDED.items():
        print(f"  {pat}\n      {why}")
    return 0


def cmd_status(names) -> int:
    bad = 0
    for name in names:
        spec = BLOCKS[name]
        print(f"\n{name} — {spec['what']}\n")
        ids: set[str] = set()
        for rel, _path, text, state in each_page(spec):
            if state == "skip":
                print(f"  -- not swept   {rel}  ({spec['skip'][rel].split('.')[0]})")
                continue
            if state != "ok":
                print(f"  !! {state:12} {rel}")
                bad += 1
                continue
            blk = find_block(text, spec)
            if blk is None:
                print(f"  -- absent      {rel}")
                continue
            _s, _e, count = blk
            note = "" if count == 1 else f"  !! sentinel x{count}"
            if count != 1:
                bad += 1
            extra = ""
            if name == "ga":
                found = sorted(set(GA_ID_RE.findall(text)))
                ids.update(found)
                extra = "  " + (",".join(found) or "(no id?)")
            print(f"  ok present     {rel}{extra}{note}")
        if name == "ga":
            if len(ids) > 1:
                print(f"\n  !! more than one measurement ID site-wide: {sorted(ids)}")
                bad += 1
            elif ids:
                print(f"\n  measurement ID: {sorted(ids)[0]}")
    print("\n  clean" if not bad else f"\n  {bad} problem(s)")
    return 1 if bad else 0


def cmd_add(name: str, arg: str) -> int:
    spec = BLOCKS[name]
    if name == "ga" and not GA_ID_RE.fullmatch(arg or ""):
        print(f"not a GA4 measurement ID: {arg!r} (want G-XXXXXXXXXX)", file=sys.stderr)
        return 2
    changed = present = skipped = 0
    for rel, path, text, state in each_page(spec):
        if state == "skip":
            print(f"  -- not swept: {rel}")
            continue
        if state != "ok":
            print(f"  !! skipped ({state}): {rel}", file=sys.stderr)
            skipped += 1
            continue
        blk = find_block(text, spec)
        if blk is not None:
            if name == "ga" and arg not in text:
                print(f"  !! skipped: {rel} carries a DIFFERENT measurement ID "
                      f"({','.join(sorted(set(GA_ID_RE.findall(text))))}) — "
                      f"run `ga remove` first", file=sys.stderr)
                skipped += 1
            else:
                print(f"  -- already present: {rel}")
                present += 1
            continue
        nl = newline_of(text)
        idx = text.find(ANCHOR)
        pad = indent_of(text, idx)
        at = idx - len(pad)          # start of the anchor's own line
        lines = [spec["start"]] + spec["body"](nl, arg) + [spec["end"]]
        block = "".join(pad + ln + nl for ln in lines)
        if at > 0 and text[at - 1] != "\n":
            block = nl + block       # anchor sits mid-line (hello/index.html)
        write_atomic(path, text[:at] + block + text[at:])
        print(f"  ++ added: {rel}")
        changed += 1
    print(f"\n  {changed} added, {present} already present, {skipped} skipped")
    return 1 if skipped else 0


def cmd_remove(name: str) -> int:
    spec = BLOCKS[name]
    changed = absent = skipped = 0
    for rel, path, text, state in each_page(spec):
        if state == "skip":
            continue
        if state != "ok":
            print(f"  !! skipped ({state}): {rel}", file=sys.stderr)
            skipped += 1
            continue
        out = text
        while True:
            blk = find_block(out, spec)
            if blk is None:
                break
            s, e, _c = blk
            bol = out.rfind("\n", 0, s) + 1
            if out[bol:s].strip() == "":
                s = bol
            out = out[:s] + out[e:]
        if out == text:
            print(f"  -- absent: {rel}")
            absent += 1
            continue
        write_atomic(path, out)
        print(f"  -- removed: {rel}")
        changed += 1
    print(f"\n  {changed} removed, {absent} had none, {skipped} skipped")
    return 1 if skipped else 0


USAGE = """usage:
  scripts/head-meta.py status
  scripts/head-meta.py pages
  scripts/head-meta.py ga add G-XXXXXXXXXX | ga remove | ga status
  scripts/head-meta.py events add | events remove | events status"""


def main(argv: list[str]) -> int:
    if argv[:1] == ["pages"]:
        return cmd_pages()
    if argv[:1] == ["status"]:
        return cmd_status(list(BLOCKS))
    if len(argv) >= 2 and argv[0] in BLOCKS:
        name, verb = argv[0], argv[1]
        if verb == "status":
            return cmd_status([name])
        if verb == "remove":
            return cmd_remove(name)
        if verb == "add":
            if BLOCKS[name]["needs_arg"] and len(argv) != 3:
                print(USAGE, file=sys.stderr)
                return 2
            return cmd_add(name, argv[2] if len(argv) > 2 else "")
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
