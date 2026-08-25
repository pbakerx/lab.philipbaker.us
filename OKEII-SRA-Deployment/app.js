/* OKEII · Strong Readers Act — deployment board.
 *
 * catalog.json is the *plan*: every channel in the approved media mix, every
 * deliverable Lisa Ratcliff's vendor emails put a date on, and one placeholder
 * per size those vendors actually asked for. It is static and ships with the
 * page.
 *
 * /api/okeii is the *state*: which placeholders have been filled, with what, and
 * what filled them before. Drop a file on a card and it becomes that slot's
 * current version; the one it replaced stays in the slot's history.
 *
 * The board shows a deliverable, its title, the spec and the placeholder — and
 * nothing else. Notes, copy, provenance and history all live in the inspector,
 * one click away, so the grid stays readable at a glance.
 *
 * Nothing here is built from a framework and nothing is fetched from a CDN —
 * this gets opened on hotel wifi and in edit bays, and it has to come up.
 */
(() => {
  "use strict";

  const API = "/api/okeii";
  const ONE_SHOT_MAX = 3_000_000;      // above this, the upload is sliced
  const SOON_DAYS = 7;
  const ALL = "__all";

  const store = {
    get key()  { try { return localStorage.getItem("okeii.key") || ""; } catch { return ""; } },
    set key(v) { try { v ? localStorage.setItem("okeii.key", v) : localStorage.removeItem("okeii.key"); } catch {} },
    get who()  { try { return localStorage.getItem("okeii.who") || ""; } catch { return ""; } },
    set who(v) { try { v ? localStorage.setItem("okeii.who", v) : localStorage.removeItem("okeii.who"); } catch {} },
  };

  let CAT = null;
  let STATE = { slots: {}, log: [] };
  let GATE = { keyRequired: false, unlocked: false, offline: false };
  let channel = null;                  // category id, or ALL
  let query = "";
  let openSlot = null;

  const SLOTS = new Map();   // slotId -> { slot, group, cat }
  const CARDS = new Map();   // slotId -> card element

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // replaceChildren stringifies a stray null or false into a visible "null", so
  // every top-level mount goes through here rather than calling it directly.
  const mount = (node, ...kids) => node.replaceChildren(...kids.flat().filter(Boolean));

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  // ── dates ────────────────────────────────────────────────────────────────
  // Parsed at local midnight. "2026-09-08" through the Date constructor is UTC,
  // which reads as Sept 7 for anyone west of Greenwich — including Oklahoma.

  const day = (iso) => {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const daysUntil = (iso) => { const d = day(iso); return d ? Math.round((d - today()) / 86400000) : null; };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (iso) => { const d = day(iso); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : "TBD"; };

  function whenPill(iso, status) {
    if (status === "delivered" || status === "approved") return { cls: "ok", text: "Delivered" };
    if (status === "reference") return { cls: "mute", text: "Reference" };
    if (status === "blocked") return { cls: "late", text: "Blocked" };
    if (!iso) return { cls: "mute", text: "No date yet" };
    const n = daysUntil(iso);
    if (n < 0) return { cls: "late", text: `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue` };
    if (n === 0) return { cls: "late", text: "Due today" };
    if (n <= SOON_DAYS) return { cls: "warn", text: `Due in ${n} day${n === 1 ? "" : "s"}` };
    return { cls: "mute", text: `Due ${shortDate(iso)}` };
  }

  const bytes = (n) => {
    if (!Number.isFinite(n)) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  };
  const ago = (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    const d = new Date(t);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };
  const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [, ""])[1];

  // ── media kinds ──────────────────────────────────────────────────────────
  // What a placeholder is *for* has to be obvious before anything is read, so
  // each kind carries its own ribbon, accent and media-well treatment.

  // `ratio` is only the fallback shape for a slot with no pixel spec — a script
  // reads as a page, a radio spot as a strip, a film as a screen. A slot that
  // carries real dimensions always uses those instead.
  const KIND = {
    image: { label: "Static", accent: "var(--k-image)", ratio: 1 },
    video: { label: "Video",  accent: "var(--k-video)", ratio: 16 / 9 },
    audio: { label: "Audio",  accent: "var(--k-audio)", ratio: 3 },
    pdf:   { label: "PDF",    accent: "var(--k-doc)",   ratio: 8.5 / 11 },
    doc:   { label: "Doc",    accent: "var(--k-doc)",   ratio: 8.5 / 11 },
    copy:  { label: "Copy",   accent: "var(--k-copy)",  ratio: 1.6 },
  };
  const kindOf = (slot) => (KIND[slot.kind] ? slot.kind : "doc");

  // ── state helpers ────────────────────────────────────────────────────────

  const historyOf = (slotId) => STATE.slots[slotId]?.versions || [];
  function currentOf(slotId) {
    const s = STATE.slots[slotId];
    if (!s || !s.versions.length) return null;
    return s.versions.find((v) => v.id === s.currentId) || s.versions[0];
  }

  /* Does the file actually satisfy what the vendor asked for? This is the
     difference between "we like it" and "it is deliverable", and it is the one
     check nobody performs by eye — the TikTok 100 KB cap in particular has been
     silently violated on this campaign before. */
  function specCheck(slot, v) {
    const out = [];
    if (!v) return out;

    if (slot.w && slot.h) {
      if (v.width && v.height) {
        if (v.width === slot.w && v.height === slot.h) {
          out.push({ ok: true, text: `${v.width} × ${v.height} — exactly the spec` });
        } else if (Math.abs(v.width / v.height - slot.w / slot.h) < 0.01) {
          out.push({ ok: "warn", text: `${v.width} × ${v.height} — right ratio, wrong scale (spec is ${slot.w} × ${slot.h})` });
        } else {
          out.push({ ok: false, text: `${v.width} × ${v.height} — spec is ${slot.w} × ${slot.h}` });
        }
      } else {
        out.push({ ok: null, text: `Spec is ${slot.w} × ${slot.h}; this file's dimensions weren't readable in the browser` });
      }
    }

    if (slot.maxBytes) {
      const under = v.size <= slot.maxBytes;
      out.push({
        ok: under,
        text: under
          ? `${bytes(v.size)} — under the ${bytes(slot.maxBytes)} cap`
          : `${bytes(v.size)} — OVER the ${bytes(slot.maxBytes)} cap. This will be rejected.`,
      });
    }

    if (slot.formats?.length) {
      const ext = extOf(v.filename);
      const want = slot.formats.map((f) => f.toLowerCase().replace(/^\./, ""));
      const ok = want.includes(ext) || (ext === "jpg" && want.includes("jpeg")) || (ext === "jpeg" && want.includes("jpg"));
      out.push({ ok, text: ok ? `.${ext} — an accepted format` : `.${ext} — the spec lists ${slot.formats.join(", ")}` });
    }
    return out;
  }

  /* The three states a media buyer cares about. Approval rides on the version,
     so dropping a new file drops the slot back to "In review" by itself —
     nothing has to remember to revoke a sign-off. */
  const STATUS = {
    needs:  { label: "Needs content",    cls: "needs" },
    review: { label: "In review",        cls: "review" },
    ready:  { label: "Ready to traffic", cls: "ready" },
  };
  function statusOf(slotId) {
    const v = currentOf(slotId);
    if (!v) return STATUS.needs;
    return v.approvedAt ? STATUS.ready : STATUS.review;
  }

  const slotVerdict = (slot, v) => {
    if (!v) return null;
    const checks = specCheck(slot, v);
    if (checks.some((c) => c.ok === false)) return "late";
    if (checks.some((c) => c.ok === "warn")) return "warn";
    return "ok";
  };

  // ── boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    mount($("#sections"), el("p", { class: "loading", text: "Loading the board…" }));
    const [cat, live] = await Promise.all([
      fetch("catalog.json?v=2").then((r) => r.json()),
      pullState().catch(() => null),
    ]);
    CAT = cat;
    if (!live) GATE.offline = true;

    for (const c of CAT.categories) {
      for (const g of c.groups) {
        for (const s of g.slots) SLOTS.set(s.id, { slot: s, group: g, cat: c });
      }
    }

    // #c=<channel> is how a channel gets shared; #<slotId> opens one placeholder.
    const hash = decodeURIComponent(location.hash.slice(1));
    const wanted = hash.startsWith("c=") ? hash.slice(2) : SLOTS.has(hash) ? SLOTS.get(hash).cat.id : null;
    channel = CAT.categories.some((c) => c.id === wanted) || wanted === ALL ? wanted : CAT.categories[0].id;

    renderSide();
    renderBoard();
    wireChrome();

    if (SLOTS.has(hash)) openDrawer(hash);
  }

  async function pullState() {
    const res = await fetch(`${API}?action=state`, { headers: keyHeader(), cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `state ${res.status}`);
    STATE = data.state;
    GATE = { ...GATE, ...data.gate, offline: false };
    return data;
  }

  const keyHeader = () => (store.key ? { "x-okeii-key": store.key } : {});

  async function api(action, body, extraQuery = "") {
    const res = await fetch(`${API}?action=${action}${extraQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...keyHeader() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
    if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { needsKey: data.needsKey, status: res.status });
    return data;
  }

  // ── the channel nav ──────────────────────────────────────────────────────

  /* "Checked off" means cleared to traffic, not merely uploaded — so the number
     counts approvals and the box fills with what has landed. A part-filled box
     reading 0/33 is exactly right: the files are in, none are signed off. */
  const tally = (c) => {
    const slots = c.groups.flatMap((g) => g.slots);
    return {
      total: slots.length,
      done: slots.filter((s) => statusOf(s.id) === STATUS.ready).length,
      landed: slots.filter((s) => currentOf(s.id)).length,
    };
  };

  function renderSide() {
    const all = CAT.categories.reduce((acc, c) => {
      const t = tally(c);
      return { done: acc.done + t.done, total: acc.total + t.total };
    }, { done: 0, total: 0 });

    mount($("#side"),
      el("h2", { text: "Channels" }),
      row(ALL, "Everything", all),
      el("div", { class: "sep" }),
      CAT.categories.map((c) => row(c.id, c.name, tally(c))),
    );
  }

  /* A line per channel with a box beside it. The box is the whole point — empty,
     part-filled in proportion to what has landed, or ticked when the channel is
     complete — so the list can be run down at a glance rather than read. */
  function row(id, name, t) {
    const on = channel === id;
    const done = t.total > 0 && t.done === t.total;
    return el("button", {
      class: [on && "is-on", done && "is-done"].filter(Boolean).join(" ") || null,
      "data-tab": id,
      "aria-current": on ? "true" : null,
      title: `${t.landed} of ${t.total} delivered · ${t.done} ready to traffic`,
      onclick: () => setChannel(id),
    },
      el("span", { class: "box", "aria-hidden": "true" },
        !done && t.landed > 0 && el("i", { style: `height:${Math.round((t.landed / t.total) * 100)}%` })),
      el("span", { class: "name", text: name }),
      el("span", { class: "n", text: `${t.done}/${t.total}` }),
    );
  }

  function setChannel(id) {
    channel = id;
    query = "";
    $("#q").value = "";
    history.replaceState(null, "", `#c=${encodeURIComponent(id)}`);
    renderSide();
    renderBoard();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // ── the board ────────────────────────────────────────────────────────────

  function renderBoard() {
    CARDS.clear();
    const shown = query
      ? CAT.categories
      : CAT.categories.filter((c) => channel === ALL || c.id === channel);

    const sections = shown.map(section).filter(Boolean);
    mount($("#sections"), sections.length
      ? sections
      : el("p", { class: "nothing", text: query ? `Nothing matches “${query}”.` : "Nothing here yet." }));
  }

  function section(c) {
    const groups = c.groups.map((g) => group(g, c)).filter(Boolean);
    if (!groups.length) return null;
    const t = tally(c);
    return el("section", { class: "cat", id: `cat-${c.id}` },
      el("div", { class: "cat-head" },
        el("h2", { text: c.name }),
        el("span", { class: "count", text: `${t.landed} of ${t.total} delivered · ${t.done} ready to traffic` }),
      ),
      groups,
    );
  }

  function group(g, c) {
    const slots = g.slots.filter(visible);
    if (!slots.length) return null;
    const w = whenPill(g.due, g.status);
    return el("div", { class: "grp", id: `grp-${g.id}` },
      el("div", { class: "grp-head" },
        el("h3", { text: g.title }),
        el("span", { class: `pill ${w.cls}`, text: w.text }),
      ),
      el("div", { class: "slots" }, slots.map((s) => card(s, g, c))),
    );
  }

  // Labels are typeset with a real multiplication sign; nobody types one. Both
  // sides are flattened so "1200x628" finds "1200×628".
  const flatten = (s) => String(s).toLowerCase().replace(/\u00d7/g, "x");

  function visible(slot) {
    if (!query) return true;
    const entry = SLOTS.get(slot.id);
    const v = currentOf(slot.id);
    return flatten([slot.label, slot.use, slot.note, entry.group.title, entry.cat.name, v?.filename]
      .filter(Boolean).join(" ")).includes(query);
  }

  function card(slot, g) {
    const kind = kindOf(slot);
    const v = currentOf(slot.id);
    const versions = historyOf(slot.id);
    const verdict = slotVerdict(slot, v);

    const media = el("div", { class: "slot-media", "data-kind": kind },
      el("span", { class: "ribbon", text: KIND[kind].label }),
      frameFor(slot, v, kind),
      v && (kind === "video" || kind === "audio") &&
        el("div", { class: `slot-play${kind === "audio" ? " audio" : ""}` },
          el("span", { text: kind === "audio" ? "♪" : "▶" })),
    );

    const st = statusOf(slot.id);
    const foot = el("div", { class: "slot-foot" },
      el("span", { class: `status ${st.cls}`, text: st.label }));
    if (v) {
      // An off-spec file can still be approved — that is the reviewer's call —
      // but it must never stop saying so.
      if (verdict !== "ok") foot.append(el("span", { class: `tag ${verdict}`, text: verdict === "warn" ? "Check scale" : "Off spec" }));
      if (versions.length > 1) foot.append(el("span", { class: "tag v", text: `v${versions.length}` }));
    } else if (slot.seed) {
      // A seed is creative that exists on the NAS but hasn't been published here.
      foot.append(el("span", { class: "tag warn", text: "On the NAS" }));
    }

    const node = el("div", {
      class: "slot", tabindex: "0", role: "button", "data-slot": slot.id,
      style: `--kind:${KIND[kind].accent}`,
      "aria-label": `${KIND[kind].label} — ${slot.label} — ${st.label}`,
      onclick: () => openDrawer(slot.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(slot.id); } },
    },
      media,
      el("div", { class: "slot-body" },
        el("span", { class: "slot-label", text: slot.label }),
        foot,
      ),
      el("div", { class: "slot-bar" }, el("i")),
    );

    dropTarget(node, slot.id);
    CARDS.set(slot.id, node);
    return node;
  }

  /* The frame is drawn at the slot's true aspect ratio inside a fixed-height
     well, so a Story reads as a tall sliver and a billboard as a wide band.
     Which edge binds depends on the ratio, and CSS can't choose between
     max-width and max-height once aspect-ratio is in play — so the class says
     which edge is constrained and CSS pins only that one. */
  function frameFor(slot, v, kind) {
    const ratio = slot.w && slot.h ? slot.w / slot.h : ratioFromString(slot.ratio) || KIND[kind].ratio;
    const shape = ratio >= 1.18 ? "wide" : "tall";
    const style = `--ar:${slot.w && slot.h ? `${slot.w}/${slot.h}` : ratio}`;

    if (!v) {
      const size = slot.w && slot.h ? `${slot.w}×${slot.h}` : (slot.ratio || "").toUpperCase();
      return el("div", { class: `frame empty ${shape}`, style },
        (kind === "video" || kind === "audio") && el("b", { class: "glyph", text: kind === "audio" ? "♪" : "▶" }),
        el("span", { text: size || "Not produced" }));
    }

    const frame = el("div", { class: `frame ${shape}`, style });
    if (v.kind === "image") {
      frame.append(el("img", { src: v.url, alt: v.filename, loading: "lazy", decoding: "async",
        onerror: (e) => e.target.replaceWith(docTile(v)) }));
    } else if (v.kind === "video") {
      frame.append(el("video", { src: v.url, muted: true, playsinline: true, preload: "metadata", tabindex: "-1" }));
    } else {
      frame.append(docTile(v));
    }
    return frame;
  }

  // The ribbon already says PDF or DOC and the label already names the file, so
  // the tile only carries the extension.
  const docTile = (v) => el("div", { class: "doc" }, el("b", { text: `.${extOf(v.filename) || "file"}` }));

  function ratioFromString(r) {
    if (!r) return null;
    const m = String(r).match(/^([\d.]+)\s*[:x/]\s*([\d.]+)$/i);
    return m && +m[2] ? +m[1] / +m[2] : null;
  }

  // ── inspector ────────────────────────────────────────────────────────────
  //
  // Everything the board deliberately doesn't show — the deliverable's notes,
  // its copy, the spec's provenance, the channel's caveats, the version history
  // — is here, one click from the placeholder it belongs to.

  function openDrawer(slotId) {
    const entry = SLOTS.get(slotId);
    if (!entry) return;
    openSlot = slotId;
    const { slot, group, cat } = entry;

    $("#drawer-crumb").textContent = `${cat.name} · ${group.title}`;
    $("#drawer-title").textContent = slot.label;
    mount($("#drawer-body"), drawerBody(slot, group));
    $("#drawer").hidden = false;
    $("#scrim").hidden = false;
    document.body.style.overflow = "hidden";
    history.replaceState(null, "", `#${slotId}`);
    $("#drawer-close").focus();
  }

  function closeDrawer() {
    openSlot = null;
    $("#drawer").hidden = true;
    $("#scrim").hidden = true;
    document.body.style.overflow = "";
    history.replaceState(null, "", `#c=${encodeURIComponent(channel)}`);
  }

  /* The inspector is for a media buyer, not for us. They assume the specs were
     followed, so the only questions worth answering are "what size is this" and
     "does the file clear it". Everything else — the deliverable's notes, its
     copy lockup, the channel's caveats, where the spec came from — was noise on
     a page whose job is to say yes or no. */
  function drawerBody(slot, group) {
    const kind = kindOf(slot);
    const v = currentOf(slot.id);
    const versions = historyOf(slot.id);

    const stage = el("div", { class: `stage${kind === "video" ? " video" : ""}` });
    if (!v) {
      stage.append(el("div", { class: "empty-stage" },
        el("p", { text: `${KIND[kind].label} — not produced yet.` })));
    } else if (v.kind === "image") {
      stage.append(el("img", { src: v.url, alt: v.filename }));
    } else if (v.kind === "video") {
      stage.append(el("video", { src: v.url, controls: true, playsinline: true, preload: "metadata" }));
    } else if (v.kind === "audio") {
      stage.append(el("audio", { src: v.url, controls: true, style: "width:100%" }));
    } else {
      stage.append(el("div", { class: "empty-stage" },
        el("p", {}, el("a", { href: v.url, target: "_blank", rel: "noopener", text: `Open ${v.filename}` }))));
    }

    const dz = el("div", { class: "dz" },
      el("b", { text: v ? "Drop a new version here" : "Drop the file here" }),
      el("span", {}, "or ", el("label", {}, "choose a file",
        el("input", { type: "file", class: "vh", onchange: (e) => { const f = e.target.files?.[0]; if (f) startUpload(f, slot.id); e.target.value = ""; } }))));
    dropTarget(dz, slot.id);

    const st = statusOf(slot.id);
    const banner = el("div", { class: `banner ${st.cls}` },
      el("span", { class: "dot" }),
      el("b", { text: st.label }),
      v?.approvedAt && el("small", { text: `${v.approvedBy || "Unattributed"} · ${ago(v.approvedAt)}` }));

    const actions = v && el("div", { class: "acts-row" },
      el("button", {
        class: v.approvedAt ? "btn" : "btn go",
        text: v.approvedAt ? "Withdraw approval" : "Approve — ready to traffic",
        onclick: () => act("approve",
          { slotId: slot.id, versionId: v.id, approved: !v.approvedAt, by: store.who },
          v.approvedAt ? "Approval withdrawn." : "Approved — ready to traffic."),
      }),
      el("button", {
        class: "btn danger",
        text: "Remove this file",
        onclick: () => {
          const rest = versions.length - 1;
          const after = rest ? `The slot falls back to the previous version — ${rest} left in history.` : "The slot goes back to a placeholder.";
          if (!confirm(`Remove ${v.filename}?\n\n${after}\nThe file is deleted from the store and can't be recovered.`)) return;
          act("remove", { slotId: slot.id, versionId: v.id, by: store.who }, "Removed.");
        },
      }));

    return [banner, stage, actions, dz, specLines(slot, v), versions.length && el("div", {},
      el("h4", { class: "sub", text: `History — ${versions.length} version${versions.length === 1 ? "" : "s"}` }),
      el("div", { class: "vers" }, versions.map((ver) => versionRow(slot, ver, ver.id === STATE.slots[slot.id]?.currentId))))];
  }

  /* One line per requirement: what it has to be, and a tick or a cross. Nothing
     is filled in yet, so every line reads as outstanding rather than failed. */
  function specLines(slot, v) {
    const rows = [];
    const push = (need, state) => rows.push({ need, state });

    if (slot.w && slot.h) {
      const got = v && v.width && v.height;
      push(`${slot.w} × ${slot.h}`,
        !v ? null : !got ? "unknown" : (v.width === slot.w && v.height === slot.h) ? "pass" : "fail");
    } else if (slot.ratio) {
      push(slot.ratio, v ? "pass" : null);
    }

    if (slot.maxBytes) push(`Under ${bytes(slot.maxBytes)}`, !v ? null : v.size <= slot.maxBytes ? "pass" : "fail");

    if (slot.formats?.length) {
      const ext = v ? extOf(v.filename) : "";
      const want = slot.formats.map((f) => f.toLowerCase().replace(/^\./, ""));
      const ok = want.includes(ext) || (ext === "jpg" && want.includes("jpeg")) || (ext === "jpeg" && want.includes("jpg"));
      push(slot.formats.join(" / "), !v ? null : ok ? "pass" : "fail");
    }

    // A slot with no captured spec still needs one line, or the panel is blank.
    if (!rows.length) push(slot.label, v ? "pass" : null);

    return el("div", { class: "spec" }, rows.map(({ need, state }) =>
      el("div", { class: `spec-row ${state || "todo"}` },
        el("span", { class: "need", text: need }),
        el("span", { class: "mark", text: state === "pass" ? "✓" : state === "fail" ? "✕" : state === "unknown" ? "?" : "" }))));
  }

  function versionRow(slot, v, isCurrent) {
    const thumb = el("div", { class: "thumb" },
      v.kind === "image"
        ? el("img", { src: v.url, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(el("span", { text: extOf(v.filename).toUpperCase() })) })
        : el("span", { text: extOf(v.filename).toUpperCase() }));

    const acts = el("div", { class: "acts" },
      el("a", { href: v.downloadUrl || v.url, download: v.filename, text: "Download" }),
      !isCurrent && el("button", { text: "Make current", onclick: () => act("restore", { slotId: slot.id, versionId: v.id, by: store.who }, "Restored.") }),
      !isCurrent && el("button", { class: "danger", text: "Remove", onclick: () => {
        if (!confirm(`Remove ${v.filename} from this slot's history? The file is deleted from the store.`)) return;
        act("remove", { slotId: slot.id, versionId: v.id, by: store.who }, "Removed.");
      } }));

    return el("div", { class: `ver${isCurrent ? " is-current" : ""}` },
      thumb,
      el("div", { class: "meta" },
        el("b", { text: v.filename }),
        el("small", { text: [
          isCurrent ? "Current" : null,
          v.approvedAt ? "Approved" : null,
          v.width && v.height ? `${v.width}×${v.height}` : null,
          bytes(v.size), v.by, ago(v.uploadedAt),
        ].filter(Boolean).join(" · ") }),
        v.note ? el("q", { text: v.note }) : null),
      acts);
  }

  async function act(action, body, okMsg) {
    try {
      await api(action, body);
      await pullState();
      refreshAll();
      toast(okMsg, "good");
    } catch (err) {
      if (err.needsKey) return unlockPrompt(err.message);
      toast(err.message, "bad");
    }
  }

  function refreshAll() {
    renderSide();
    renderBoard();
    if (openSlot && SLOTS.has(openSlot)) {
      const { slot, group } = SLOTS.get(openSlot);
      mount($("#drawer-body"), drawerBody(slot, group));
    }
  }

  // ── dropping files ───────────────────────────────────────────────────────

  function dropTarget(node, slotId) {
    let depth = 0;
    node.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth++; node.classList.add("is-over"); });
    node.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; });
    node.addEventListener("dragleave", (e) => { e.stopPropagation(); if (--depth <= 0) { depth = 0; node.classList.remove("is-over"); } });
    node.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      depth = 0; node.classList.remove("is-over");
      $("#dropveil").hidden = true;
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      if (files.length > 1) toast(`${files.length} files — only the first goes on this placeholder.`, "bad");
      startUpload(files[0], slotId);
    });
  }

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  async function startUpload(file, slotId) {
    if (!store.who) {
      const who = prompt("Who's dropping this? (shows in the version history)", "");
      if (who === null) return;
      store.who = who.trim() || "Unattributed";
      $("#who").textContent = store.who;
      $("#who").classList.add("is-set");
    }
    const card = CARDS.get(slotId);
    const bar = card && $(".slot-bar i", card);
    card?.classList.add("is-busy");
    const progress = (p) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; };

    try {
      progress(0.02);
      const dims = await probe(file);
      const sha = await checksum(file);
      const base = { slotId, filename: file.name, size: file.size, by: store.who, note: "", sha, ...dims };

      let out;
      if (file.size <= ONE_SHOT_MAX) {
        const data = await toBase64(file);
        progress(0.5);
        out = await api("put", { ...base, data });
      } else {
        out = await chunked(file, base, progress);
      }

      progress(1);
      await pullState();
      refreshAll();
      toast(out?.already
        ? `${file.name} is already the current version here — nothing changed.`
        : `${file.name} is on the board.`, "good");
    } catch (err) {
      if (err.needsKey) unlockPrompt(err.message);
      else toast(err.message || "That upload didn't go through.", "bad");
    } finally {
      card?.classList.remove("is-busy");
      if (bar) setTimeout(() => { bar.style.width = "0"; }, 400);
    }
  }

  /* Slices go up one at a time and the server reassembles them. They are not
     Blob multipart parts — Blob rejects anything under 5 MiB, which is more than
     a Vercel function can receive in one body, so the two limits can't be
     satisfied by the same number. Sequential rather than parallel: a stalled
     slice should show as a stalled bar, not as three fighting for the uplink. */
  async function chunked(file, base, progress) {
    const opened = await api("begin", base);
    if (opened.already) return opened;      // same bytes already current — nothing to send
    const { ticket, partSize } = opened;
    const size = partSize || 4_000_000;
    const count = Math.ceil(file.size / size);
    let b64 = false;

    for (let i = 0; i < count; i++) {
      const slice = file.slice(i * size, Math.min((i + 1) * size, file.size));
      const q = `&id=${encodeURIComponent(ticket.id)}&n=${i + 1}${b64 ? "&enc=b64" : ""}`;
      try {
        await sendPart(slice, q, b64);
      } catch (err) {
        // Raw octet-stream bodies depend on how the runtime hands the request
        // back to us. If the first slice comes back empty, fall through to the
        // JSON/base64 path, which is parsed the same way everywhere.
        if (i === 0 && !b64 && /empty|body|decode/i.test(err.message || "")) {
          b64 = true; i--; continue;
        }
        throw err;
      }
      progress(0.05 + 0.85 * ((i + 1) / count));
    }
    return api("finish", { ...base, ticket, parts: count });
  }

  async function sendPart(slice, q, b64) {
    const url = `${API}?action=part${q}`;
    const res = b64
      ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...keyHeader() },
          body: JSON.stringify({ data: await toBase64(slice) }) })
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...keyHeader() },
          body: await slice.arrayBuffer() });
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
    if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { needsKey: data.needsKey });
    return data;
  }

  /* Identity for the duplicate check. Capped because this reads the whole file
     into memory — WebCrypto has no streaming digest — and past the cap a
     duplicate drop is cheaper to accept than to guard against. */
  const SHA_MAX = 64 * 1024 * 1024;
  async function checksum(file) {
    if (file.size > SHA_MAX || !crypto?.subtle) return null;
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;                          // not available over plain http
    }
  }

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("The browser couldn't read that file."));
    r.onload = () => resolve(String(r.result).split(",", 2)[1] || "");
    r.readAsDataURL(blob);
  });

  /* Dimensions and duration are read here rather than on the server because the
     browser already has the bytes and the server would have to decode the file
     to learn the same thing. They're what the spec check runs on. */
  function probe(file) {
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); return v; };
    if (/^image\//.test(file.type) || /\.(jpe?g|png|gif|webp|avif)$/i.test(file.name)) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(done({ width: img.naturalWidth, height: img.naturalHeight }));
        img.onerror = () => resolve(done({}));
        img.src = url;
      });
    }
    if (/^video\//.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name)) {
      return new Promise((resolve) => {
        const vid = document.createElement("video");
        vid.preload = "metadata";
        vid.onloadedmetadata = () => resolve(done({ width: vid.videoWidth, height: vid.videoHeight, duration: vid.duration }));
        vid.onerror = () => resolve(done({}));
        vid.src = url;
        setTimeout(() => resolve(done({})), 8000);
      });
    }
    URL.revokeObjectURL(url);
    return Promise.resolve({});
  }

  // ── chrome ───────────────────────────────────────────────────────────────

  function wireChrome() {
    let t;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(t);
      // Searching reaches across every channel, not just the one on screen —
      // otherwise "1200x628" would miss most of what it should find.
      t = setTimeout(() => { query = flatten(e.target.value.trim()); renderBoard(); }, 130);
    });

    // Not a login — there is nothing to log in to. It is the name that gets
    // stamped on anything you drop or approve, so the history says who did it.
    const who = $("#who");
    const paintWho = () => {
      who.textContent = store.who || "Add your name";
      who.title = store.who
        ? `Anything you drop or approve is stamped "${store.who}". Click to change it.`
        : "Your name gets stamped on anything you drop or approve. Not a login.";
      who.classList.toggle("is-set", Boolean(store.who));
    };
    paintWho();
    who.addEventListener("click", () => {
      const v = prompt("Your name — it gets stamped on anything you drop or approve.\n\nThis isn't a login; nothing on this page is behind one.", store.who);
      if (v === null) return;
      store.who = v.trim();
      paintWho();
    });

    const lock = $("#lock");
    const paintLock = () => {
      if (!GATE.keyRequired) { lock.textContent = "Open"; lock.title = "No review key is set on this project — anyone with the link can add files."; lock.classList.remove("is-on"); }
      else { lock.textContent = GATE.unlocked ? "Unlocked" : "Unlock"; lock.classList.toggle("is-on", GATE.unlocked); }
    };
    paintLock();
    lock.addEventListener("click", () => unlockPrompt());

    $("#drawer-close").addEventListener("click", closeDrawer);
    $("#scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openSlot) closeDrawer();
      if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
    });

    // A full-window veil while a file is in flight over the page, so it is
    // obvious the drop has to land on a specific placeholder.
    let dragDepth = 0;
    window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; dragDepth++; $("#dropveil").hidden = false; });
    window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropveil").hidden = true; } });
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); dragDepth = 0; $("#dropveil").hidden = true; });

    window.__okeiiPaintLock = paintLock;
  }

  async function unlockPrompt(msg) {
    const v = prompt(msg ? `${msg}\n\nReview key:` : "Review key for this board:", store.key);
    if (v === null) return;
    store.key = v.trim();
    try {
      await pullState();
      window.__okeiiPaintLock?.();
      refreshAll();
      toast(GATE.keyRequired ? (GATE.unlocked ? "Unlocked." : "That key wasn't accepted.") : "No key is required on this project.",
            GATE.keyRequired && !GATE.unlocked ? "bad" : "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  }

  function toast(text, kind) {
    const t = el("div", { class: `toast ${kind || ""}`, text });
    $("#toasts").append(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, kind === "bad" ? 7000 : 3600);
  }

  boot().catch((err) => {
    mount($("#sections"), el("p", { class: "loading" },
      "The board couldn't load: ", el("code", { text: String(err.message || err) })));
  });
})();
