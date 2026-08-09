// Shared hamburger menu for lab.philipbaker.us.
//
// Drop this on any lab page:
//   <script src="/shared/menu.js" defer></script>
//
// It asks /api/menu for the live philipbaker.us menu — links, styles, typeface —
// and injects it. Nothing about the menu is hard-coded here, so changing the nav
// on philipbaker.us changes it here too.
//
// Everything is built with createElement and textContent rather than innerHTML:
// the content arrives over the network, and markup from a remote source should
// never be parsed as markup.

(() => {
  "use strict";
  if (window.__pbMenu) return; // never mount twice
  window.__pbMenu = true;

  const WRAP_ID = "pb-menu";

  async function load() {
    const res = await fetch("/api/menu", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`menu ${res.status}`);
    return res.json();
  }

  function mount(data) {
    if (document.getElementById(WRAP_ID)) return;

    const links = Array.isArray(data.links) ? data.links : [];
    if (!links.length) return;

    // The philipbaker.us rules read --ink / --drawer-bg / --hair. Those live on
    // the wrapper, not :root, so the lab's own variables of the same name are
    // untouched.
    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    for (const [name, value] of Object.entries(data.vars || {})) {
      if (/^--[a-z0-9-]+$/i.test(name)) wrap.style.setProperty(name, value);
    }
    if (data.fontFamily) {
      wrap.style.setProperty(
        "font-family",
        `"${data.fontFamily}", Inter, system-ui, sans-serif`,
      );
    }

    const style = document.createElement("style");
    style.id = "pb-menu-style";
    style.textContent = [
      data.fontCss || "",
      // Insulate the menu from whatever page it lands on. philipbaker.us's body
      // sets only a font, so anything a lab page sets — the root page's
      // line-height:1.55, for one — would otherwise leak in and space the drawer
      // differently from the real thing. These are the browser defaults the
      // source site relies on, restated so inheritance can't reach in.
      `#${WRAP_ID}{line-height:normal;letter-spacing:normal;font-style:normal;` +
        `font-weight:400;text-transform:none;text-align:left;font-variant:normal}`,
      `#${WRAP_ID},#${WRAP_ID} *{box-sizing:border-box}`,
      data.css || "",
      // Keep the wrapper from becoming a containing block for the fixed-position
      // hamburger and drawer. It's a zero-height static div, so it can't capture
      // clicks and needs no pointer-events handling.
      //
      // Do NOT set pointer-events here. An earlier version put
      // `pointer-events:none` on the wrapper and `auto` back on each child —
      // and `#pb-menu .drawer-scrim` (id + class) outranks the source's
      // `.drawer-scrim{pointer-events:none}`, so the scrim stayed clickable
      // while closed. Being fixed at inset:0 it then ate every click on the
      // page while remaining invisible. Let the source CSS govern the scrim.
      `#${WRAP_ID}{position:static}`,
    ].join("\n");
    document.head.appendChild(style);

    // Hamburger
    const burger = document.createElement("button");
    burger.type = "button";
    burger.className = "hamburger";
    burger.setAttribute("aria-label", "Open menu");
    burger.setAttribute("aria-expanded", "false");
    burger.append(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span"),
    );

    // Scrim
    const scrim = document.createElement("div");
    scrim.className = "drawer-scrim";
    scrim.setAttribute("aria-hidden", "true");

    // Drawer
    const drawer = document.createElement("aside");
    drawer.className = "drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Site menu");
    drawer.setAttribute("aria-hidden", "true");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "drawer-close";
    close.setAttribute("aria-label", "Close menu");
    close.textContent = "Close";

    const nav = document.createElement("nav");
    nav.className = "drawer-nav";
    for (const link of links) {
      const a = document.createElement("a");
      a.href = link.href;
      const idx = document.createElement("span");
      idx.className = "drawer-index";
      idx.textContent = link.index || "";
      a.append(idx, document.createTextNode(link.label || ""));
      a.addEventListener("click", () => setOpen(false));
      nav.appendChild(a);
    }

    const foot = document.createElement("p");
    foot.className = "drawer-footer";
    foot.textContent = "philipbaker.us";

    drawer.append(close, nav, foot);
    wrap.append(burger, scrim, drawer);
    document.body.appendChild(wrap);

    let open = false;
    function setOpen(next) {
      open = next;
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      scrim.classList.toggle("show", open);
      drawer.classList.toggle("open", open);
      drawer.setAttribute("aria-hidden", String(!open));
      if (open) close.focus({ preventScroll: true });
    }

    burger.addEventListener("click", () => setOpen(!open));
    close.addEventListener("click", () => setOpen(false));
    scrim.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open) setOpen(false);
    });
  }

  const start = () => load().then(mount).catch(() => {});
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
