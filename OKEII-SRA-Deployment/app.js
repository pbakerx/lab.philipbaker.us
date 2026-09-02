/* OKEII · Strong Readers Act — final asset presentation.
 *
 * Category > Message > Size, and nothing else. This replaced a schedule-driven
 * deployment board: no dates, no status, no specs, no notes, no sign-off. A
 * media buyer opens a category, sees the messages, and sees every size that
 * exists for each one. The only words on a tile are its dimensions.
 *
 * Files live in Vercel Blob and are matched to catalog entries by id, so the
 * catalog stays a plain description of what the campaign contains and the store
 * stays the only thing that knows about bytes.
 */
(() => {
  "use strict";

  // Cache-bust from our own script tag, so every asset URL moves together with
  // the build and a stale index.html can never pin new code to an old catalog.
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [, "1"])[1];

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    mount(n, kids);
    return n;
  };
  const mount = (n, kids) => {
    for (const k of kids.flat(9)) {
      if (k === null || k === undefined || k === false || k === true) continue;
      n.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  };
  const fill = (n, ...kids) => { n.replaceChildren(); mount(n, kids); return n; };

  let CAT = null;         // the catalog
  let FILES = {};         // id -> current file {url, kind, filename}
  let category = null;    // selected category id
  let open = null;        // { catId, msgId, idx } while the viewer is up
  let sideOpen = false;   // mobile nav

  // ── build check ──────────────────────────────────────────────────────────
  // index.html pins every asset's ?v=, so a cached index.html freezes the whole
  // page at an old build. build.txt is served no-store; if it disagrees with the
  // build we were loaded as, reload once.
  async function checkBuild() {
    try {
      const r = await fetch(`build.txt?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const live = (await r.text()).trim();
      if (live && live !== V && !sessionStorage.getItem(`reloaded-${live}`)) {
        sessionStorage.setItem(`reloaded-${live}`, "1");
        location.reload();
      }
    } catch { /* offline is not a reason to block the page */ }
  }

  // ── data ─────────────────────────────────────────────────────────────────
  async function load() {
    const [cat, st] = await Promise.all([
      fetch(`catalog.json?v=${V}`).then((r) => r.json()),
      fetch("api/okeii?action=state").then((r) => r.json()).catch(() => null),
    ]);
    CAT = cat;
    FILES = {};
    const slots = st?.state?.slots || {};
    for (const [id, s] of Object.entries(slots)) {
      const cur = (s.versions || []).find((v) => v.id === s.currentId) || (s.versions || [])[0];
      if (cur) FILES[id] = cur;
    }
  }

  const fileOf = (id) => FILES[id] || null;
  const count = (c) => c.messages.reduce((a, m) => a + m.items.length, 0);
  const have = (c) => c.messages.reduce((a, m) => a + m.items.filter((i) => fileOf(i.id)).length, 0);

  // ── nav ──────────────────────────────────────────────────────────────────
  function renderSide() {
    const here = CAT.categories.find((c) => c.id === category) || CAT.categories[0];
    fill($("#side"),
      el("button", {
        class: "side-toggle", "aria-expanded": String(sideOpen),
        onclick: () => { sideOpen = !sideOpen; renderSide(); },
      },
        el("span", { class: "name", text: here.name }),
        el("span", { class: "chev", text: sideOpen ? "▲" : "▼" })),
      el("nav", { class: `side-list${sideOpen ? " open" : ""}` },
        CAT.categories.map((c) => {
          const on = c.id === category;
          return el("button", {
            class: `cat${on ? " is-on" : ""}`,
            "aria-current": on ? "true" : null,
            onclick: () => setCategory(c.id),
          },
            el("span", { class: "name", text: c.name }),
            el("span", { class: "n", text: String(count(c)) }));
        })));
  }

  function setCategory(id) {
    category = id;
    sideOpen = false;
    renderSide();
    renderBoard();
    window.scrollTo({ top: 0 });
    history.replaceState(null, "", `#${id}`);
  }

  // ── the grid ─────────────────────────────────────────────────────────────
  function tile(cat, msg, item, idx) {
    const f = fileOf(item.id);
    const inner = f
      ? (f.kind === "video"
          ? el("video", { src: f.url, muted: "", playsinline: "", preload: "metadata", loop: "" })
          : el("img", { src: f.url, alt: "", loading: "lazy" }))
      : el("span", { class: "empty", text: "To come" });

    return el("button", {
      class: `tile${f ? "" : " is-empty"}${f?.kind === "video" ? " is-video" : ""}`,
      onclick: () => openViewer(cat.id, msg.id, idx),
    },
      el("span", { class: "frame" }, inner, f?.kind === "video" && el("span", { class: "play" })),
      el("span", { class: "size", text: item.size }));
  }

  function renderBoard() {
    const cat = CAT.categories.find((c) => c.id === category);
    fill($("#board"),
      el("header", { class: "board-head" }, el("h1", { text: cat.name })),
      cat.messages.map((m) => el("section", { class: "msg" },
        el("h2", { text: m.name }),
        el("div", { class: "grid" }, m.items.map((it, i) => tile(cat, m, it, i))))));
  }

  // ── the viewer ───────────────────────────────────────────────────────────
  function openViewer(catId, msgId, idx) {
    open = { catId, msgId, idx };
    renderViewer();
    $("#viewer").hidden = false;
    document.body.classList.add("locked");
  }
  function closeViewer() {
    open = null;
    $("#viewer").hidden = true;
    document.body.classList.remove("locked");
    fill($("#viewer-body"));
  }
  function step(d) {
    if (!open) return;
    const m = CAT.categories.find((c) => c.id === open.catId).messages.find((x) => x.id === open.msgId);
    open.idx = (open.idx + d + m.items.length) % m.items.length;
    renderViewer();
  }

  function renderViewer() {
    const cat = CAT.categories.find((c) => c.id === open.catId);
    const msg = cat.messages.find((m) => m.id === open.msgId);
    const item = msg.items[open.idx];
    const f = fileOf(item.id);

    const media = f
      ? (f.kind === "video"
          ? el("video", { src: f.url, controls: "", autoplay: "", playsinline: "", loop: "" })
          : el("img", { src: f.url, alt: "" }))
      : el("div", { class: "empty-lg", text: "To come" });

    fill($("#viewer-crumb"), `${cat.name} · ${msg.name}`);
    fill($("#viewer-size"), item.size);
    fill($("#viewer-count"), `${open.idx + 1} / ${msg.items.length}`);
    fill($("#viewer-body"), media);
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    checkBuild();
    try {
      await load();
    } catch (err) {
      fill($("#board"), el("p", { class: "err", text: "Couldn't load the assets. Reload to try again." }));
      console.error(err);
      return;
    }

    const want = location.hash.slice(1);
    category = CAT.categories.some((c) => c.id === want) ? want : CAT.categories[0].id;

    $("#viewer-close").addEventListener("click", closeViewer);
    $("#viewer-prev").addEventListener("click", () => step(-1));
    $("#viewer-next").addEventListener("click", () => step(1));
    $("#viewer").addEventListener("click", (e) => { if (e.target.id === "viewer") closeViewer(); });
    document.addEventListener("keydown", (e) => {
      if (!open) return;
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });

    renderSide();
    renderBoard();
  }

  boot();
})();
