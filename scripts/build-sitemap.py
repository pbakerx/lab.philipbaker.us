#!/usr/bin/env python3
"""Build sitemap.xml from the pages' own canonical tags.

    scripts/build-sitemap.py --check     # exit 1 if sitemap.xml has drifted
    scripts/build-sitemap.py --write     # rewrite sitemap.xml
    scripts/build-sitemap.py --list      # show the decision for every page

A hand-maintained sitemap drifts from the pages the moment someone adds a
project and forgets a line. This derives it from the pages instead, so the two
cannot disagree: a page is in the sitemap **iff** it declares a
`<link rel="canonical">` and does not declare `noindex`.

That rule is also the whole opt-out mechanism. Nothing here keeps a list of
exceptions — a page stays out of the sitemap by not having a canonical, or by
saying noindex, in the page itself:

  honda-acura/index.html            noindex   withdrawn case study, placeholder
  OKEII-SRA-Deployment/index.html   noindex   unlisted client review link
  AcrobatAnt-.../index.html         noindex   unlisted client review link
  widget-maker/frame.html           noindex   iframe, not a page
  vault/player.html, play.html      no canonical — full-screen players, and a
                                    bare URL without ?f= is not a page
  hello/index.html                  no canonical — the example stub

`lastmod` is the date of the last git commit that touched the page file. That is
a real content-modified date, unlike a file mtime, which a sitewide head sweep
sets to today on every page at once. A sweep does legitimately change these
files, so a sweep day showing up here is accurate rather than misleading. A page
git has never seen is emitted without a lastmod rather than with a guess.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITEMAP = os.path.join(ROOT, "sitemap.xml")

CANONICAL_RE = re.compile(
    r'<link\s+rel="canonical"\s+href="([^"]+)"', re.I)
NOINDEX_RE = re.compile(
    r'<meta\s+name="robots"\s+content="[^"]*noindex', re.I)

# Directories whose HTML is ad creative or vendor code, never a page of this site.
SKIP_DIRS = ("/ads/", "/rounds/", ".claude/", "vault/vendor/", "node_modules/")


def tracked_html() -> list[str]:
    out = subprocess.run(
        ["git", "-C", ROOT, "ls-files", "*.html"],
        capture_output=True, text=True, check=True).stdout.split()
    keep = []
    for rel in out:
        p = "/" + rel
        if any(s in p or rel.startswith(s) for s in SKIP_DIRS):
            continue
        keep.append(rel)
    # 404.html may not be tracked yet on its first run
    if "404.html" not in keep and os.path.exists(os.path.join(ROOT, "404.html")):
        keep.append("404.html")
    return sorted(keep)


def git_lastmod(rel: str) -> str | None:
    r = subprocess.run(
        ["git", "-C", ROOT, "log", "-1", "--format=%cs", "--", rel],
        capture_output=True, text=True)
    d = r.stdout.strip()
    return d if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) else None


def decide(rel: str):
    """-> (url, lastmod, reason) with url None when the page is excluded."""
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8", newline="") as fh:
        html = fh.read()
    head = html.split("</head>", 1)[0]
    if NOINDEX_RE.search(head):
        return None, None, "noindex"
    m = CANONICAL_RE.search(head)
    if not m:
        return None, None, "no canonical"
    url = m.group(1)
    if not url.startswith("https://lab.philipbaker.us"):
        return None, None, f"canonical is off-site: {url}"
    return url, git_lastmod(rel), "in"


def collect():
    rows = []
    for rel in tracked_html():
        url, lastmod, reason = decide(rel)
        rows.append((rel, url, lastmod, reason))
    included = [r for r in rows if r[1]]
    # home first, then by URL — order carries no meaning, but it must be stable
    included.sort(key=lambda r: (r[1] != "https://lab.philipbaker.us/", r[1]))
    return rows, included


def render(included) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for _rel, url, lastmod, _reason in included:
        out.append("  <url>")
        out.append(f"    <loc>{url}</loc>")
        if lastmod:
            out.append(f"    <lastmod>{lastmod}</lastmod>")
        out.append("  </url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    rows, included = collect()
    if not included:
        # An empty <urlset> is reported by Search Console as "Missing XML tag".
        print("refusing to write: no page yielded a canonical URL", file=sys.stderr)
        return 2

    if "--list" in argv or not argv:
        for rel, url, lastmod, reason in sorted(rows):
            mark = "in " if url else "out"
            extra = f"  {url}  {lastmod or '(no lastmod)'}" if url else f"  ({reason})"
            print(f"  {mark}  {rel}{extra}")
        print(f"\n  {len(included)} of {len(rows)} pages in the sitemap")
        if not argv:
            print("\n  (--check to gate, --write to rewrite)")
        return 0

    new = render(included)

    if "--check" in argv:
        cur = ""
        if os.path.exists(SITEMAP):
            with open(SITEMAP, "r", encoding="utf-8", newline="") as fh:
                cur = fh.read()
        if cur == new:
            print(f"  sitemap.xml is current ({len(included)} urls)")
            return 0
        print("  sitemap.xml has DRIFTED from the pages' canonicals.",
              file=sys.stderr)
        cur_urls = set(re.findall(r"<loc>([^<]+)</loc>", cur))
        new_urls = set(re.findall(r"<loc>([^<]+)</loc>", new))
        for u in sorted(new_urls - cur_urls):
            print(f"    + {u}", file=sys.stderr)
        for u in sorted(cur_urls - new_urls):
            print(f"    - {u}", file=sys.stderr)
        if cur_urls == new_urls:
            print("    (same URLs — lastmod dates differ)", file=sys.stderr)
        print("  run: scripts/build-sitemap.py --write", file=sys.stderr)
        return 1

    if "--write" in argv:
        with open(SITEMAP, "w", encoding="utf-8", newline="") as fh:
            fh.write(new)
        print(f"  wrote sitemap.xml — {len(included)} urls")
        for _rel, url, lastmod, _r in included:
            print(f"    {url}  {lastmod or '(no lastmod)'}")
        return 0

    print(__doc__.split("\n")[2].strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
