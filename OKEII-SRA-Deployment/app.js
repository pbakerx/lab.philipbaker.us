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
  let campaign = null;    // selected campaign id, or null while choosing
  let FILES = {};         // id -> { current, versions } -- versions newest first
  let category = null;    // selected category id
  let open = null;        // { catId, msgId, idx, rev } while the viewer is up
  let sideOpen = false;   // mobile nav
  let scaleWatch = null;  // recomputes the viewer's fit percentage on resize

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
      // Root-absolute on purpose. The page is served from /OKEII-SRA-Deployment/,
      // so a relative "api/okeii" resolves under that folder and 404s -- the
      // function lives at the site root.
      fetch("/api/okeii?action=state").then((r) => r.json()).catch(() => null),
    ]);
    CAT = cat;
    FILES = {};
    const slots = st?.state?.slots || {};
    for (const [id, s] of Object.entries(slots)) {
      const versions = s.versions || [];
      const cur = versions.find((v) => v.id === s.currentId) || versions[0];
      if (cur) FILES[id] = { current: cur, versions };
    }
  }

  // A <video> with preload="metadata" and no poster paints nothing in Safari
  // and often nothing in Chrome either. A media fragment makes the browser
  // decode and hold that frame, which becomes the thumbnail. Two seconds in
  // clears any black or logo-only opening frame on these spots.
  const POSTER_AT = 2;
  const posterSrc = (url) => `${url}#t=${POSTER_AT}`;

  const camp = () => CAT.campaigns.find((c) => c.id === campaign) || CAT.campaigns[0];
  const cats = () => camp().categories;

  const slotOf = (id) => FILES[id] || null;
  const fileOf = (id) => FILES[id]?.current || null;

  // Revisions are numbered from the oldest upload, so the first drop is RV1 and
  // whatever supersedes it is RV2. versions[] arrives newest-first.
  const revOf = (slot, v) => slot.versions.length - slot.versions.indexOf(v);
  const revDate = (v) => {
    const d = v.uploadedAt ? new Date(v.uploadedAt) : null;
    return d && !isNaN(d) ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : "";
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const count = (c) => c.messages.reduce((a, m) => a + m.items.length, 0);
  const have = (c) => c.messages.reduce((a, m) => a + m.items.filter((i) => fileOf(i.id)).length, 0);

  // ── nav ──────────────────────────────────────────────────────────────────
  function renderSide() {
    const here = cats().find((c) => c.id === category) || cats()[0];
    fill($("#side"),
      el("button", {
        class: "side-toggle", "aria-expanded": String(sideOpen),
        onclick: () => { sideOpen = !sideOpen; renderSide(); },
      },
        el("span", { class: "name", text: here.name }),
        el("span", { class: "chev", text: sideOpen ? "▲" : "▼" })),
      el("nav", { class: `side-list${sideOpen ? " open" : ""}` },
        cats().map((c) => {
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
    history.replaceState(null, "", `#${campaign}/${id}`);
  }

  // ── the grid ─────────────────────────────────────────────────────────────
  function tile(cat, msg, item, idx) {
    const f = fileOf(item.id);
    const inner = !f
      ? el("span", { class: "empty", text: "To come" })
      : f.kind === "video"
        ? el("video", { src: posterSrc(f.url), muted: "", playsinline: "",
                        preload: "metadata", loop: "" })
        : f.kind === "audio"
          ? el("span", { class: "audio-mark", text: item.size })
          : el("img", { src: f.url, alt: "", loading: "lazy" });

    const slot = slotOf(item.id);
    const revised = slot && slot.versions.length > 1;

    return el("button", {
      class: `tile${f ? "" : " is-empty"}${f ? ` is-${f.kind}` : ""}`,
      onclick: () => openViewer(cat.id, msg.id, idx),
    },
      el("span", { class: "frame" }, inner,
        (f?.kind === "video" || f?.kind === "audio") && el("span", { class: "play" }),
        revised && el("span", { class: "rev", text: `RV${revOf(slot, f)}` }),
        // The slot is labelled at trim size; say when the file on it is a
        // different pixel size, so the label is never read as a promise.
        f && item.filepx && el("span", { class: "proof", text: "2×" })),
      el("span", { class: "size", text: item.size }));
  }

  function renderBoard() {
    const cat = cats().find((c) => c.id === category);
    fill($("#board"),
      el("header", { class: "board-head" }, el("h1", { text: cat.name })),
      cat.messages.map((m) => el("section", { class: "msg" },
        el("h2", { text: m.name }),
        el("div", { class: "grid" }, m.items.map((it, i) => tile(cat, m, it, i))))));
  }

  // ── choosing a campaign ──────────────────────────────────────────────────
  // Two campaigns now run side by side and they are NOT interchangeable -- a
  // buyer pulling Morning creative for a Scoreboard flight would be a real
  // mistake. So the choice is the whole first screen rather than a dropdown.
  const tally = (c) => {
    const items = c.categories.flatMap((x) => x.messages.flatMap((m) => m.items));
    return { total: items.length, have: items.filter((i) => fileOf(i.id)).length };
  };

  function renderChooser() {
    document.body.classList.add("choosing");
    $("#chooser").hidden = false;
    fill($("#chooser-grid"), CAT.campaigns.map((c) => {
      const t = tally(c);
      // The card crops to 16:9, so a tall 1080x1920 ad would show as a narrow
      // slice of its own middle. Pick whatever landed asset is closest to the
      // card's shape instead of simply the first one.
      const landed = c.categories.flatMap((x) => x.messages.flatMap((m) => m.items))
        .map((i) => ({ f: fileOf(i.id), w: i.w, h: i.h }))
        .filter((x) => x.f);
      const near = (x) => Math.abs((x.w / x.h) - 16 / 9);
      const pick = (kind) => landed.filter((x) => x.f.kind === kind).sort((a, b) => near(a) - near(b))[0];
      const hero = (pick("image") || pick("video") || {}).f;
      return el("button", { class: "camp", onclick: () => pickCampaign(c.id) },
        el("span", { class: "camp-art" },
          !hero ? el("span", { class: "camp-art-empty" })
            : hero.kind === "video"
              ? el("video", { src: posterSrc(hero.url), muted: "", playsinline: "",
                              preload: "metadata" })
              : el("img", { src: hero.url, alt: "", loading: "lazy" })),
        el("span", { class: "camp-body" },
          el("span", { class: "camp-name", text: c.name }),
          c.blurb && el("span", { class: "camp-blurb", text: c.blurb }),
          el("span", { class: "camp-n" },
            el("b", { text: String(t.have) }),
            ` of ${t.total} delivered`,
            t.total > t.have && el("i", { text: `· ${t.total - t.have} to come` }))));
    }));
  }

  function pickCampaign(id) {
    campaign = id;
    $("#chooser").hidden = true;
    document.body.classList.remove("choosing");
    category = cats()[0].id;
    paintTopbar();
    renderSide();
    renderBoard();
    window.scrollTo({ top: 0 });
    history.replaceState(null, "", `#${campaign}/${category}`);
  }

  function backToChooser() {
    campaign = null;
    history.replaceState(null, "", "#");
    renderChooser();
  }

  function paintTopbar() {
    fill($("#topbar-campaign"),
      el("button", { class: "camp-switch", onclick: backToChooser },
        el("b", { text: camp().name }),
        el("span", { class: "swap", text: "change" })));
  }

  // ── the viewer ───────────────────────────────────────────────────────────
  function openViewer(catId, msgId, idx) {
    open = { catId, msgId, idx, rev: null };
    // Unhide first: rendering into a display:none panel measures every element
    // at zero width, which silently defeated the fit-percentage check.
    $("#viewer").hidden = false;
    document.body.classList.add("locked");
    renderViewer();
  }
  function closeViewer() {
    open = null;
    $("#viewer").hidden = true;
    document.body.classList.remove("locked");
    fill($("#viewer-body"));
  }
  function step(d) {
    if (!open) return;
    const m = cats().find((c) => c.id === open.catId).messages.find((x) => x.id === open.msgId);
    open.idx = (open.idx + d + m.items.length) % m.items.length;
    open.rev = null;                   // a new asset starts on its current cut
    renderViewer();
  }

  function renderViewer() {
    const cat = cats().find((c) => c.id === open.catId);
    const msg = cat.messages.find((m) => m.id === open.msgId);
    const item = msg.items[open.idx];
    const slot = slotOf(item.id);
    // open.rev pins a specific version while the viewer is up; null means current.
    const f = !slot ? null
      : (open.rev && slot.versions.find((v) => v.id === open.rev)) || slot.current;

    const media = !f
      ? el("div", { class: "empty-lg", text: "To come" })
      : f.kind === "video"
        ? el("video", { src: f.url, controls: "", autoplay: "", playsinline: "", loop: "" })
        : f.kind === "audio"
          ? el("div", { class: "audio-player" },
              el("div", { class: "audio-len", text: item.size }),
              el("audio", { src: f.url, controls: "", autoplay: "" }))
          : el("img", { src: f.url, alt: "" });

    fill($("#viewer-crumb"), `${cat.name} · ${msg.name}`);
    fill($("#viewer-size"), item.size);
    // Every cut stays reachable -- a buyer looking at RV2 can check what RV1 said.
    fill($("#viewer-revs"), slot && slot.versions.length > 1
      ? slot.versions.slice().reverse().map((v) => el("button", {
          class: `rev-chip${v.id === f.id ? " is-on" : ""}`
               + (v.id === f.id && v.id !== slot.current.id ? " is-old" : ""),
          onclick: () => { open.rev = v.id; renderViewer(); },
        }, el("b", { text: `RV${revOf(slot, v)}` }), revDate(v) && el("i", { text: revDate(v) })))
      : null);
    fill($("#viewer-count"), `${open.idx + 1} / ${msg.items.length}`);
    fill($("#viewer-body"), media);

    // Report the scale once the media knows its own size. Anything under 99%
    // is a downscale worth saying out loud; a 300x50 banner that fits at 1:1
    // says nothing.
    const showScale = () => {
      const nat = media.naturalWidth || media.videoWidth || 0;
      const shown = media.getBoundingClientRect().width;
      if (!nat || !shown) return fill($("#viewer-fit"));
      const pct = Math.round((shown / nat) * 100);
      fill($("#viewer-fit"), pct < 99 ? `fit to window · ${pct}%` : "actual size");
    };
    fill($("#viewer-note"), item.filepx ? `file ${item.filepx}` : null);
    fill($("#viewer-fit"));
    if (media.tagName === "IMG") media.complete ? showScale() : media.addEventListener("load", showScale, { once: true });
    else if (media.tagName === "VIDEO") media.addEventListener("loadedmetadata", showScale, { once: true });
    // The fit changes with the window, so the percentage has to follow it.
    scaleWatch = showScale;
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

    // #campaign/category deep-links straight in; anything else starts at the
    // chooser. A bare #category is the old one-campaign form -- honour it
    // against the scoreboard so links already sent out still land.
    const [wantCamp, wantCat] = location.hash.slice(1).split("/");
    const byId = CAT.campaigns.find((c) => c.id === wantCamp);
    const legacy = !byId && wantCamp
      && CAT.campaigns.find((c) => c.categories.some((x) => x.id === wantCamp));
    if (byId || legacy) {
      campaign = (byId || legacy).id;
      const list = cats();
      category = list.some((c) => c.id === (wantCat || wantCamp))
        ? (wantCat || wantCamp) : list[0].id;
    }

    window.addEventListener("resize", () => { if (open && scaleWatch) scaleWatch(); });
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

    $("#chooser-grid").addEventListener("keydown", (e) => {
      if (e.key === "Escape" && campaign) pickCampaign(campaign);
    });

    if (!campaign) { renderChooser(); return; }
    paintTopbar();
    renderSide();
    renderBoard();
  }

  boot();
})();
