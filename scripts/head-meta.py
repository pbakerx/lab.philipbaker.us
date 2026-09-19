#!/usr/bin/env python3
"""Sweep the <head> of every lab page from one place.

The lab has no build step and no shared template, so a tag that belongs on
every page has to be written into every page. Doing that by hand is how a page
ends up with two copies of a tag, or none. This script is the one place.

    scripts/head-meta.py ga status
    scripts/head-meta.py ga add G-XXXXXXXXXX
    scripts/head-meta.py ga remove
    scripts/head-meta.py pages          # print the page set and why

Everything it writes is wrapped in a sentinel comment pair, so it can find its
own work again to count it or take it back out:

    <!-- GA4:START -->  ...  <!-- GA4:END -->

Discipline, per `00. Technical Notes/Analytics and SEO for a Client Site.md`:

  * the anchor (`</head>`) must occur exactly once in a file, or the file is
    skipped loudly rather than guessed at;
  * a re-run changes nothing ("already present");
  * writes are atomic (temp file + os.replace), so an interrupted run cannot
    leave a half-written page;
  * files are read and written with no line-ending translation, so a CRLF file
    does not come back with every line changed;
  * `add` / `remove` / `status`, so the install is reversible and countable.

After any sweep, check all four before committing:

    git diff --stat        touches exactly the number of pages you expect
    git diff --numstat     identical insertion counts, zero deletions
    scripts/head-meta.py ga status     every page reports present, once
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
# the numbers cannot answer whether a recovered game was ever played.

GA_START = "<!-- GA4:START -->"
GA_END = "<!-- GA4:END -->"
GA_ID_RE = re.compile(r"G-[A-Z0-9]{6,}")


def ga_block(mid: str, nl: str) -> str:
    """The tag, with Google Signals and ad personalisation off."""
    return nl.join([
        GA_START,
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={mid}"></script>',
        "<script>",
        "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}",
        "gtag('js',new Date());",
        f"gtag('config','{mid}',"
        "{allow_google_signals:false,allow_ad_personalization_signals:false});",
        "</script>",
        GA_END,
        "",
    ])


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


def each_page():
    for rel in PAGES:
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


def existing_block(text: str):
    """(start, end_exclusive, count) of the sentinel block, or None."""
    count = text.count(GA_START)
    if count == 0:
        return None
    s = text.find(GA_START)
    e = text.find(GA_END, s)
    if e == -1:
        return (s, len(text), count)
    e += len(GA_END)
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


def cmd_status() -> int:
    bad = 0
    ids: set[str] = set()
    for rel, _path, text, state in each_page():
        if state != "ok":
            print(f"  !! {state:12} {rel}")
            bad += 1
            continue
        blk = existing_block(text)
        if blk is None:
            print(f"  -- absent      {rel}")
            continue
        _s, _e, count = blk
        found = GA_ID_RE.findall(text)
        ids.update(found)
        uniq = sorted(set(found))
        note = "" if count == 1 else f"  !! sentinel x{count}"
        if count != 1:
            bad += 1
        print(f"  ok present     {rel}  {','.join(uniq) or '(no id?)'}{note}")
    print()
    if len(ids) > 1:
        print(f"  !! more than one measurement ID across the site: {sorted(ids)}")
        bad += 1
    elif ids:
        print(f"  measurement ID: {sorted(ids)[0]}")
    print("  clean" if not bad else f"  {bad} problem(s)")
    return 1 if bad else 0


def cmd_add(mid: str) -> int:
    if not GA_ID_RE.fullmatch(mid):
        print(f"not a GA4 measurement ID: {mid!r} (want G-XXXXXXXXXX)", file=sys.stderr)
        return 2
    changed = present = skipped = 0
    for rel, path, text, state in each_page():
        if state != "ok":
            print(f"  !! skipped ({state}): {rel}", file=sys.stderr)
            skipped += 1
            continue
        blk = existing_block(text)
        if blk is not None:
            if mid in text:
                print(f"  -- already present: {rel}")
                present += 1
            else:
                print(f"  !! skipped: {rel} carries a DIFFERENT measurement ID "
                      f"({','.join(sorted(set(GA_ID_RE.findall(text))))}) — "
                      f"run `ga remove` first", file=sys.stderr)
                skipped += 1
            continue
        nl = newline_of(text)
        idx = text.find(ANCHOR)
        pad = indent_of(text, idx)
        at = idx - len(pad)          # start of the anchor's own line
        block = "".join(pad + ln + nl for ln in ga_block(mid, nl).split(nl) if ln)
        if at > 0 and text[at - 1] != "\n":
            block = nl + block       # anchor sits mid-line (hello/index.html)
        write_atomic(path, text[:at] + block + text[at:])
        print(f"  ++ added: {rel}")
        changed += 1
    print(f"\n  {changed} added, {present} already present, {skipped} skipped")
    return 1 if skipped else 0


def cmd_remove() -> int:
    changed = absent = skipped = 0
    for rel, path, text, state in each_page():
        if state != "ok":
            print(f"  !! skipped ({state}): {rel}", file=sys.stderr)
            skipped += 1
            continue
        out = text
        while True:
            blk = existing_block(out)
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


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "ga":
        if argv[1] == "status":
            return cmd_status()
        if argv[1] == "remove":
            return cmd_remove()
        if argv[1] == "add" and len(argv) == 3:
            return cmd_add(argv[2])
    if argv[:1] == ["pages"]:
        return cmd_pages()
    print("usage:\n"
          "  scripts/head-meta.py ga status\n"
          "  scripts/head-meta.py ga add G-XXXXXXXXXX\n"
          "  scripts/head-meta.py ga remove\n"
          "  scripts/head-meta.py pages", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
