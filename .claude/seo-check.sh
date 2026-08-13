#!/usr/bin/env bash
# SEO smoke test for a lab page. Usage:
#   .claude/seo-check.sh                       # checks every URL in sitemap.xml
#   .claude/seo-check.sh /second-brain/        # checks one path
#   BASE=http://localhost:8902 .claude/seo-check.sh /second-brain/
#
# It answers "is this indexable?" mechanically: the things a crawler actually
# reads, checked against what the page actually serves. It does not judge copy.
set -uo pipefail
BASE="${BASE:-https://lab.philipbaker.us}"
fails=0

need() { # need <label> <pattern> <html>
  if grep -qi -- "$2" <<<"$3"; then printf '  \033[32m✓\033[0m %s\n' "$1"
  else printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails+1)); fi
}

check_page() {
  local path="$1" url="$BASE$1"
  printf '\n\033[1m%s\033[0m\n' "$url"
  local code; code=$(curl -sL -o /dev/null -w '%{http_code}' "$url")
  local hops; hops=$(curl -sL -o /dev/null -w '%{num_redirects}' "$url")
  printf '  status %s after %s redirect(s)\n' "$code" "$hops"
  [ "$code" = "200" ] || { printf '  \033[31m✗ not 200 — nothing else matters\033[0m\n'; fails=$((fails+1)); return; }
  local html; html=$(curl -sL "$url")

  need "<title>"                  '<title>[^<]\{15,\}</title>'        "$html"
  need "meta description"         'name="description" content="[^"]\{70,\}"' "$html"
  need "canonical (absolute)"     'rel="canonical" href="https://'    "$html"
  need "og:title"                 'property="og:title"'               "$html"
  need "og:description"           'property="og:description"'         "$html"
  need "og:url"                   'property="og:url" content="https://' "$html"
  need "og:image (absolute)"      'property="og:image" content="https://' "$html"
  need "twitter:card"             'name="twitter:card"'               "$html"
  need "lang attribute"           '<html lang='                       "$html"
  need "viewport"                 'name="viewport"'                   "$html"
  if grep -qi 'name="robots"[^>]*noindex' <<<"$html"; then
    printf '  \033[31m✗ page is noindex\033[0m\n'; fails=$((fails+1))
  else printf '  \033[32m✓\033[0m not noindex\n'; fi

  # exactly one h1
  local h1; h1=$(grep -o '<h1[ >]' <<<"$html" | wc -l | tr -d ' ')
  if [ "$h1" = "1" ]; then printf '  \033[32m✓\033[0m exactly one <h1>\n'
  else printf '  \033[31m✗\033[0m %s <h1> tags (want 1)\n' "$h1"; fails=$((fails+1)); fi

  # every img has non-empty alt
  local imgs noalt
  imgs=$(grep -o '<img [^>]*>' <<<"$html")
  if [ -z "$imgs" ]; then noalt=0
  else noalt=$(grep -cv 'alt="[^"]\+"' <<<"$imgs"); fi
  if [ "$noalt" = "0" ]; then printf '  \033[32m✓\033[0m all <img> have alt text\n'
  else printf '  \033[31m✗\033[0m %s <img> missing alt\n' "$noalt"; fails=$((fails+1)); fi

  # og:image must actually resolve
  local ogi; ogi=$(sed -n 's/.*property="og:image" content="\([^"]*\)".*/\1/p' <<<"$html" | head -1)
  if [ -n "$ogi" ]; then
    local ic; ic=$(curl -sL -o /dev/null -w '%{http_code}' "$ogi")
    if [ "$ic" = "200" ]; then printf '  \033[32m✓\033[0m og:image resolves (%s)\n' "$ogi"
    else printf '  \033[31m✗\033[0m og:image %s → %s\n' "$ogi" "$ic"; fails=$((fails+1)); fi
  fi

  # JSON-LD, if present, must parse
  if grep -q 'application/ld+json' <<<"$html"; then
    if python3 - "$url" <<'PY'
import json,re,sys,urllib.request
h=urllib.request.urlopen(sys.argv[1]).read().decode()
for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>',h,re.S):
    json.loads(b)
PY
    then printf '  \033[32m✓\033[0m JSON-LD parses\n'
    else printf '  \033[31m✗\033[0m JSON-LD is malformed\n'; fails=$((fails+1)); fi
  fi
}

printf '\033[1mrobots.txt / sitemap.xml\033[0m\n'
curl -sf "$BASE/robots.txt" >/dev/null && printf '  \033[32m✓\033[0m robots.txt\n' || { printf '  \033[31m✗\033[0m robots.txt\n'; fails=$((fails+1)); }
curl -sf "$BASE/sitemap.xml" >/dev/null && printf '  \033[32m✓\033[0m sitemap.xml\n' || { printf '  \033[31m✗\033[0m sitemap.xml\n'; fails=$((fails+1)); }

if [ $# -gt 0 ]; then
  for p in "$@"; do check_page "$p"; done
else
  # every <loc> in the sitemap, as a path
  while read -r loc; do
    check_page "/${loc#*://*/}"
  done < <(curl -s "$BASE/sitemap.xml" | sed -n 's:.*<loc>\(.*\)</loc>.*:\1:p')
fi

printf '\n'
[ "$fails" = "0" ] && printf '\033[32mall checks passed\033[0m\n' || printf '\033[31m%s check(s) failed\033[0m\n' "$fails"
exit $((fails > 0))
