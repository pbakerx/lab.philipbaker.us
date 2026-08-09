// lab.philipbaker.us/api/menu
//
// The lab is a static site on its own domain, but its hamburger menu has to be
// the one on philipbaker.us — and stay that way when that menu changes. Rather
// than keep a copy here that quietly drifts, this reads the real thing:
//
//   1. fetch philipbaker.us
//   2. pull the drawer's links out of the server-rendered HTML
//   3. pull the .hamburger/.drawer rules (and the Space Grotesk @font-face
//      blocks) out of the stylesheet that page links to
//
// So a nav change on philipbaker.us shows up here on its own, within the cache
// window below. If any of it fails we serve a baked-in copy, because a slightly
// stale menu beats no menu.
//
// This runs server-side precisely because it has to: philipbaker.us sends no
// CORS headers on its HTML, so the browser could never do this itself.

const SOURCE = "https://philipbaker.us";
const MENU_SELECTOR = /\.(hamburger|drawer)/;
const CACHE = "public, s-maxage=600, stale-while-revalidate=86400";

// Only what the menu actually reads. Scoped onto the wrapper rather than :root
// so the lab's own --ink and friends are left alone.
const WANTED_VARS = ["--ink", "--drawer-bg", "--hair"];

const FALLBACK = {
  links: [
    { index: "01", label: "Home", href: "https://philipbaker.us/" },
    { index: "02", label: "About", href: "https://philipbaker.us/about" },
    { index: "03", label: "Press", href: "https://philipbaker.us/press" },
    { index: "04", label: "Lab", href: "https://lab.philipbaker.us" },
    { index: "05", label: "Contact", href: "mailto:pbakerx@gmail.com" },
  ],
  vars: {
    "--ink": "#fdf3ea",
    "--drawer-bg": "#120702f0",
    "--hair": "#ffffff38",
  },
  // A styled copy of the menu rules as they stood when this was written. Only
  // used when the live read fails — an unstyled drawer dumped into the page
  // would be worse than no menu at all. The font is deliberately omitted: those
  // URLs carry a deployment hash and would 404 after the next deploy.
  css: `.hamburger{z-index:60;cursor:pointer;background:0 0;border:none;flex-direction:column;justify-content:center;align-items:flex-end;gap:7px;width:40px;height:40px;display:flex;position:fixed;top:26px;right:28px}
.hamburger span{background:var(--ink);border-radius:2px;height:1.5px;transition:width .3s,transform .32s,opacity .2s;display:block}
.hamburger span:first-child{width:28px}
.hamburger span:nth-child(2){width:18px}
.hamburger span:nth-child(3),.hamburger:hover span{width:28px}
.hamburger.is-open span:first-child{transform:translateY(8.5px)rotate(45deg)}
.hamburger.is-open span:nth-child(2){opacity:0}
.hamburger.is-open span:nth-child(3){width:28px;transform:translateY(-8.5px)rotate(-45deg)}
.drawer-scrim{z-index:50;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;pointer-events:none;background:#0c040080;transition:opacity .35s;position:fixed;inset:0}
.drawer-scrim.show{opacity:1;pointer-events:auto}
.drawer{z-index:55;background:var(--drawer-bg);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-left:1px solid var(--hair);flex-direction:column;width:min(380px,86vw);height:100%;padding:96px 44px 44px;transition:transform .46s cubic-bezier(.16,1,.3,1);display:flex;position:fixed;top:0;right:0;transform:translate(101%)}
.drawer.open{transform:translate(0)}
.drawer-close{color:var(--ink);letter-spacing:.26em;text-transform:uppercase;cursor:pointer;opacity:.7;background:0 0;border:none;font-family:inherit;font-size:10px;transition:opacity .2s;position:absolute;top:34px;right:44px}
.drawer-close:hover{opacity:1}
.drawer-nav{flex-direction:column;display:flex}
.drawer-nav a{color:var(--ink);letter-spacing:.28em;text-transform:uppercase;border-bottom:1px solid #ffffff14;align-items:baseline;gap:14px;padding:18px 0;font-size:12px;font-weight:500;text-decoration:none;transition:padding-left .3s,color .3s;display:flex;position:relative}
.drawer-nav a:hover{color:#ffb866;padding-left:10px}
.drawer-index{letter-spacing:.1em;opacity:.5;font-size:9px;font-weight:400}
.drawer-footer{letter-spacing:.3em;text-transform:uppercase;opacity:.45;margin-top:auto;font-size:9px}`,
  fontCss: "",
  fontFamily: null,
  stale: true,
};

// Split a stylesheet into top-level blocks, keeping @media (etc.) intact.
function topLevelBlocks(css) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (const ch of css) {
    buf += ch;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push(buf.trim());
        buf = "";
      }
    }
  }
  return out;
}

function selectorOf(block) {
  return block.slice(0, block.indexOf("{"));
}

// Keep menu rules, and keep an @media/@supports wrapper only if something
// inside it is a menu rule.
function collectMenuCss(css) {
  const kept = [];
  for (const block of topLevelBlocks(css)) {
    const sel = selectorOf(block);
    if (sel.trimStart().startsWith("@")) {
      if (/^@(media|supports|layer)/.test(sel.trim())) {
        const open = block.indexOf("{");
        const inner = block.slice(open + 1, block.lastIndexOf("}"));
        const innerKept = collectMenuCss(inner);
        if (innerKept) kept.push(`${sel}{${innerKept}}`);
      }
      continue;
    }
    if (MENU_SELECTOR.test(sel)) kept.push(block);
  }
  return kept.join("\n");
}

function collectVars(css) {
  const vars = {};
  for (const block of topLevelBlocks(css)) {
    if (!selectorOf(block).includes(":root")) continue;
    const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    for (const decl of body.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (WANTED_VARS.includes(name)) vars[name] = decl.slice(i + 1).trim();
    }
  }
  return vars;
}

// next/font emits @font-face with urls relative to the stylesheet, so they have
// to be made absolute to work from another origin. (Vercel serves /_next/static
// with Access-Control-Allow-Origin: *, so the browser will accept them.)
function collectFontFaces(css, cssUrl, family) {
  const out = [];
  for (const block of topLevelBlocks(css)) {
    const sel = selectorOf(block);
    if (!sel.trim().startsWith("@font-face")) continue;
    if (family && !block.includes(family)) continue;
    out.push(
      block.replace(/url\(([^)]+)\)/g, (whole, raw) => {
        const cleaned = raw.trim().replace(/^["']|["']$/g, "");
        if (/^(https?:|data:)/.test(cleaned)) return whole;
        try {
          return `url(${new URL(cleaned, cssUrl).href})`;
        } catch {
          return whole;
        }
      }),
    );
  }
  return out.join("\n");
}

function parseLinks(html, baseUrl) {
  const nav = html.match(/<nav[^>]*class="[^"]*drawer-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
  if (!nav) return null;

  const links = [];
  for (const m of nav[1].matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const inner = m[2];
    const idx = inner.match(/<span[^>]*drawer-index[^>]*>([\s\S]*?)<\/span>/i);
    const label = inner
      .replace(/<span[^>]*drawer-index[^>]*>[\s\S]*?<\/span>/i, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .trim();
    if (!label) continue;

    // The lab is a different origin, so a bare "/about" would resolve here and
    // 404. Everything relative has to point back at philipbaker.us.
    let href = m[1];
    if (!/^(https?:|mailto:|tel:)/i.test(href)) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
    links.push({
      index: idx ? idx[1].replace(/<[^>]*>/g, "").trim() : String(links.length + 1).padStart(2, "0"),
      label,
      href,
    });
  }
  return links.length ? links : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  try {
    const pageRes = await fetch(SOURCE, {
      redirect: "follow",
      headers: { "User-Agent": "lab.philipbaker.us menu-sync" },
    });
    if (!pageRes.ok) throw new Error(`source returned ${pageRes.status}`);
    const finalUrl = pageRes.url || SOURCE;
    const html = await pageRes.text();

    const links = parseLinks(html, finalUrl);
    if (!links) throw new Error("no drawer-nav in the source page");

    let css = "";
    let vars = {};
    let fontCss = "";
    let fontFamily = null;

    const sheet = html.match(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/i);
    if (sheet) {
      const cssUrl = new URL(sheet[1], finalUrl).href;
      const cssRes = await fetch(cssUrl);
      if (cssRes.ok) {
        const sheetText = await cssRes.text();
        css = collectMenuCss(sheetText);
        vars = collectVars(sheetText);

        // Match the drawer's typeface too, when we can identify it.
        const famMatch = sheetText.match(/@font-face\{font-family:([^;]+);/);
        if (famMatch) {
          fontFamily = famMatch[1].trim().replace(/^["']|["']$/g, "");
          fontCss = collectFontFaces(sheetText, cssUrl, fontFamily);
        }
      }
    }

    res.setHeader("Cache-Control", CACHE);
    return res.status(200).json({
      links,
      css,
      fontCss,
      fontFamily,
      vars: Object.keys(vars).length ? vars : FALLBACK.vars,
      source: finalUrl,
      stale: !css, // links came through but styling didn't
    });
  } catch (err) {
    // Never leave a page without a menu because the other site had a bad moment.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    return res.status(200).json({ ...FALLBACK, error: err?.message || "sync failed" });
  }
}
