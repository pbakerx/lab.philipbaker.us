/* OKEII · Strong Readers Act — deployment board.
 *
 * catalog.json is the *plan*: every channel in the approved media mix, every
 * deliverable Lisa Ratcliff's vendor emails put a date on, and one placeholder
 * per size those vendors actually asked for. It is static and it ships with the
 * page.
 *
 * /api/okeii is the *state*: which placeholders have been filled, with what, and
 * what filled them before. Drop a file on a card and it becomes that slot's
 * current version; the one it replaced stays in the slot's history.
 *
 * Nothing here is built from a framework and nothing is fetched from a CDN —
 * this gets opened on hotel wifi and in edit bays, and it has to come up.
 */
(() => {
  "use strict";

  const API = "/api/okeii";
  const ONE_SHOT_MAX = 3_000_000;      // above this, upload goes multipart
  const LAUNCH = "2026-09-08";
  const SOON_DAYS = 7;

  const store = {
    get key()  { try { return localStorage.getItem("okeii.key") || ""; } catch { return ""; } },
    set key(v) { try { v ? localStorage.setItem("okeii.key", v) : localStorage.removeItem("okeii.key"); } catch {} },
    get who()  { try { return localStorage.getItem("okeii.who") || ""; } catch { return ""; } },
    set who(v) { try { v ? localStorage.setItem("okeii.who", v) : localStorage.removeItem("okeii.who"); } catch {} },
    get internal()  { try { return localStorage.getItem("okeii.internal") === "1"; } catch { return false; } },
    set internal(v) { try { localStorage.setItem("okeii.internal", v ? "1" : "0"); } catch {} },
  };

  let CAT = null;
  let STATE = { slots: {}, log: [] };
  let GATE = { keyRequired: false, unlocked: false, offline: false };
  let filter = "all";
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
      else if (k === "html") n.innerHTML = v;              // literals only, never data
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

  const slotVerdict = (slot, v) => {
    if (!v) return null;
    const checks = specCheck(slot, v);
    if (checks.some((c) => c.ok === false)) return "late";
    if (checks.some((c) => c.ok === "warn")) return "warn";
    return "ok";
  };

  // ── boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    $("#sections").append(el("p", { class: "loading", text: "Loading the board…" }));
    const [cat, live] = await Promise.all([
      fetch("catalog.json?v=1").then((r) => r.json()),
      pullState().catch(() => null),
    ]);
    CAT = cat;
    if (!live) GATE.offline = true;

    for (const c of CAT.categories) {
      for (const g of c.groups) {
        for (const s of g.slots) SLOTS.set(s.id, { slot: s, group: g, cat: c });
      }
    }

    renderRail();
    renderSections();
    renderSummary();
    renderSchedule();
    renderOpenItems();
    renderFoot();
    wireChrome();
    applyFilter();
    trackRail();

    // Everything on the page is rendered after two fetches, so the browser has
    // already given up on the fragment by the time the target exists. Deep links
    // into a channel, a deliverable or a single placeholder are the normal way
    // this URL gets passed around, so they are resolved here instead.
    if (location.hash.length > 1) {
      const id = decodeURIComponent(location.hash.slice(1));
      if (SLOTS.has(id)) openDrawer(id);
      else document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" });
    }
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

  // ── rendering ────────────────────────────────────────────────────────────

  function renderRail() {
    const rail = $("#rail");
    mount(rail,
      ...CAT.categories.map((c) => {
        const total = c.groups.reduce((n, g) => n + g.slots.length, 0);
        const done = c.groups.reduce((n, g) => n + g.slots.filter((s) => currentOf(s.id)).length, 0);
        return el("a", { href: `#cat-${c.id}`, "data-cat": c.id }, c.name, el("i", { text: `${done}/${total}` }));
      }),
    );
  }

  function renderSections() {
    mount($("#sections"), CAT.categories.map(section));
  }

  function section(c) {
    const total = c.groups.reduce((n, g) => n + g.slots.length, 0);
    const done = c.groups.reduce((n, g) => n + g.slots.filter((s) => currentOf(s.id)).length, 0);

    return el("section", { class: "cat", id: `cat-${c.id}`, "data-cat": c.id },
      el("div", { class: "cat-head" },
        el("h2", { text: c.name }),
        el("span", { class: "count", text: `${done} of ${total} produced` }),
      ),
      c.planRole && clamped("cat-role", c.planRole),
      c.flight && clamped("cat-flight", el("b", { text: "Flight · " }), c.flight),
      c.specStatus !== "captured" && c.specNote &&
        el("div", { class: "cat-note" }, clamped("cat-note-body",
          el("b", { text: c.specStatus === "not_captured" ? "Specs not captured. " : "Specs partial. " }),
          c.specNote)),
      ...c.groups.map((g) => group(g, c)),
    );
  }

  function group(g, c) {
    const w = whenPill(g.due, g.status);
    return el("div", { class: "grp", id: `grp-${g.id}`, "data-group": g.id },
      el("div", { class: "grp-head" },
        el("h3", { text: g.title }),
        el("span", { class: `pill ${w.cls}`, text: w.text }),
        g.vendor && el("span", { class: "pill mute", text: g.vendor }),
      ),
      g.notes && clamped("grp-notes", g.notes),
      g.copy?.length && el("dl", { class: "grp-copy" },
        ...g.copy.flatMap((line) => [el("dt", { text: line.label }), el("dd", { text: line.text })])),
      el("div", { class: "slots" }, ...g.slots.map((s) => card(s, g, c))),
    );
  }

  function card(slot, g) {
    const v = currentOf(slot.id);
    const versions = historyOf(slot.id);
    const verdict = slotVerdict(slot, v);

    const media = el("div", { class: "slot-media" }, frameFor(slot, v));
    const bar = el("div", { class: "slot-bar" }, el("i"));

    const foot = el("div", { class: "slot-foot" });
    if (v) {
      foot.append(el("span", { class: `tag ${verdict}`, text: verdict === "ok" ? "Meets spec" : verdict === "warn" ? "Check scale" : "Off spec" }));
      if (versions.length > 1) foot.append(el("span", { class: "tag v", text: `v${versions.length}` }));
      foot.append(el("span", { class: "tag", text: bytes(v.size) }));
    } else {
      foot.append(el("span", { class: "tag", text: "Placeholder" }));
      if (slot.required === false) foot.append(el("span", { class: "tag", text: "Optional" }));
      // A seed is creative that already exists on the NAS but hasn't been
      // published here. Saying so beats an empty box that implies nothing exists.
      if (slot.seed) foot.append(el("span", { class: "tag warn", text: "On the NAS" }));
    }

    const node = el("div", {
      class: "slot", tabindex: "0", role: "button", "data-slot": slot.id,
      "aria-label": `${slot.label} — ${v ? v.filename : "placeholder"}`,
      onclick: () => openDrawer(slot.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(slot.id); } },
    },
      media,
      verdict && el("span", { class: `slot-flag ${verdict}` }),
      el("div", { class: "slot-body" },
        el("span", { class: "slot-label", text: slot.label }),
        slot.use && el("span", { class: "slot-use", text: slot.use }),
        foot,
      ),
      bar,
    );

    dropTarget(node, slot.id);
    node._search = [slot.label, slot.use, slot.note, g.title, g.vendor, v?.filename].filter(Boolean).join(" ").toLowerCase();
    CARDS.set(slot.id, node);
    return node;
  }

  /* The frame is drawn at the slot's true aspect ratio inside a fixed-height
     box, so a Story reads as a tall sliver and a billboard as a wide band. That
     shape is most of what tells a reviewer which placeholder they're looking at. */
  function frameFor(slot, v) {
    const ratio = slot.w && slot.h ? slot.w / slot.h : ratioFromString(slot.ratio) || 1;
    const shape = ratio >= 1.18 ? "wide" : "tall";
    const style = `--ar:${slot.w && slot.h ? `${slot.w}/${slot.h}` : ratio}`;

    if (!v) {
      const size = slot.w && slot.h ? `${slot.w}×${slot.h}` : (slot.ratio || slot.kind || "").toUpperCase();
      return el("div", { class: `frame empty ${shape}`, style }, el("span", { text: size || "Drop file" }));
    }

    const frame = el("div", { class: `frame ${shape}`, style });
    if (v.kind === "image") {
      frame.append(el("img", { src: v.url, alt: v.filename, loading: "lazy", decoding: "async",
        onerror: (e) => e.target.replaceWith(docTile(v)) }));
    } else if (v.kind === "video") {
      frame.append(
        el("video", { src: v.url, muted: true, playsinline: true, preload: "metadata", tabindex: "-1" }),
        el("div", { class: "slot-play" }, el("span", { text: "▶" })),
      );
    } else {
      frame.append(docTile(v));
    }
    return frame;
  }

  /* The notes are the difference between a placeholder and a brief — they carry
     the vendor's actual words and the reason a date is what it is. They are also
     long. Clamped to three lines with a toggle, and the toggle only appears when
     the text really is taller than the clamp. */
  function clamped(cls, ...kids) {
    const body = el("p", { class: `${cls} clamp` }, ...kids);
    const wrap = el("div", { class: "clampwrap" }, body);
    requestAnimationFrame(() => {
      if (body.scrollHeight - body.clientHeight < 6) return;
      const more = el("button", { class: "clamp-more", text: "More", "aria-expanded": "false" });
      more.addEventListener("click", () => {
        const open = body.classList.toggle("open");
        more.textContent = open ? "Less" : "More";
        more.setAttribute("aria-expanded", String(open));
      });
      wrap.append(more);
    });
    return wrap;
  }

  const docTile = (v) => el("div", { class: "doc" }, el("b", { text: `.${extOf(v.filename) || "file"}` }), v.kind || "file");

  function ratioFromString(r) {
    if (!r) return null;
    const m = String(r).match(/^([\d.]+)\s*[:x/]\s*([\d.]+)$/i);
    return m && +m[2] ? +m[1] / +m[2] : null;
  }

  function renderSummary() {
    const all = [...SLOTS.values()];
    const done = all.filter(({ slot }) => currentOf(slot.id));
    const offSpec = done.filter(({ slot }) => slotVerdict(slot, currentOf(slot.id)) !== "ok");

    const dated = CAT.schedule.deliverables.filter((d) => d.due && d.status !== "delivered");
    const overdue = dated.filter((d) => daysUntil(d.due) < 0);
    const soon = dated.filter((d) => { const n = daysUntil(d.due); return n >= 0 && n <= SOON_DAYS; });
    const launchIn = daysUntil(CAT.meta?.launch || LAUNCH);

    const recent = (STATE.log || []).filter((l) => l.action === "added" || l.action === "replaced").slice(0, 4);

    mount($("#clock"),
      el("div", { class: `tile ${launchIn <= 14 ? "warm" : ""}` },
        el("b", { text: launchIn > 0 ? launchIn : launchIn === 0 ? "TODAY" : "LIVE" }),
        el("small", { text: launchIn > 0 ? "days to launch" : "campaign launch" })),
      overdue.length ? el("div", { class: "tile hot" }, el("b", { text: overdue.length }), el("small", { text: "overdue" })) : null,
      soon.length ? el("div", { class: "tile warm" }, el("b", { text: soon.length }), el("small", { text: `due in ${SOON_DAYS} days` })) : null,
    );

    const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
    mount($("#summary"),
      el("div", { class: "stat" },
        el("h3", { text: "Creative produced" }),
        el("p", { class: "big", text: `${done.length} / ${all.length}` }),
        el("p", { text: `${all.length - done.length} placeholders still empty` }),
        el("div", { class: "meter" }, el("i", { style: `width:${pct}%` }))),
      el("div", { class: offSpec.length ? "stat alarm" : "stat" },
        el("h3", { text: "Needs a look" }),
        el("p", { class: "big", text: offSpec.length }),
        el("p", { text: offSpec.length ? "files that don't yet meet the size or weight the vendor asked for" : "every published file meets its spec" })),
      el("div", { class: "stat" },
        el("h3", { text: "Next deadline" }),
        el("p", { class: "big", text: nextDue(dated) }),
        el("p", { text: nextDueWhat(dated) })),
      el("div", { class: "stat" },
        el("h3", { text: "Latest in" }),
        recent.length
          ? el("div", {}, ...recent.map((l) => el("p", { style: "font-size:12px;margin-top:3px",
              text: `${shortish(l.filename)} · ${ago(l.at)}` })))
          : el("p", { text: GATE.offline ? "The store isn't reachable from here — the board is showing placeholders only." : "Nothing dropped yet. Drag a file onto any placeholder." })),
    );
  }

  const shortish = (s) => (String(s || "").length > 30 ? String(s).slice(0, 29) + "…" : String(s || ""));

  function nextDue(dated) {
    const upcoming = dated.filter((d) => daysUntil(d.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0];
    const late = dated.filter((d) => daysUntil(d.due) < 0).sort((a, b) => a.due.localeCompare(b.due))[0];
    const pick = late || upcoming;
    if (!pick) return "—";
    const n = daysUntil(pick.due);
    return n < 0 ? `${Math.abs(n)}d late` : n === 0 ? "Today" : shortDate(pick.due);
  }
  function nextDueWhat(dated) {
    const late = dated.filter((d) => daysUntil(d.due) < 0).sort((a, b) => a.due.localeCompare(b.due))[0];
    const upcoming = dated.filter((d) => daysUntil(d.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0];
    return (late || upcoming)?.title || "Nothing scheduled";
  }

  function renderSchedule() {
    const s = CAT.schedule;
    const rows = [...s.deliverables].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    mount($("#schedule"),
      el("h2", { text: "The schedule" }),
      el("p", { class: "lede" }, `Vendor deadlines as emailed by ${s.media_buyer || "the media buyer"}, who owns the buy. Media flights start ${shortDate(s.launch_date)}.`),
      el("div", { class: "tablewrap" },
        el("table", { class: "sched" },
          el("thead", {}, el("tr", {},
            el("th", { text: "Due" }), el("th", { text: "Deliverable" }),
            el("th", { text: "Vendor" }), el("th", { text: "Status" }), el("th", { text: "Detail" }))),
          el("tbody", {}, ...rows.map(scheduleRow)))),
      s.conflicts?.length && el("div", { class: "internal" },
        el("h4", { text: "Dates still to reconcile" }),
        el("ul", {}, ...s.conflicts.map((c) => el("li", {}, el("b", { text: c.issue + " — " }), c.detail)))),
    );
  }

  function scheduleRow(d) {
    const w = whenPill(d.due, d.status);
    const late = d.due && daysUntil(d.due) < 0 && d.status !== "delivered";
    const cls = [d.channel === "milestone" ? "is-launch" : "", late ? "is-late" : ""].filter(Boolean).join(" ");
    const anchor = [...SLOTS.values()].find((x) => x.group.deliverableId === d.id);
    return el("tr", { class: cls || null },
      el("td", { class: "when", text: d.due ? shortDate(d.due) : "TBD" }),
      el("td", {}, anchor ? el("a", { href: `#grp-${anchor.group.id}`, text: d.title }) : d.title),
      el("td", { text: d.vendor || "—" }),
      el("td", {}, el("span", { class: `pill ${w.cls}`, text: w.text })),
      el("td", { class: "why", text: d.notes || "" }));
  }

  function renderOpenItems() {
    const o = CAT.openItems;
    if (!o) return;
    const pane = $("#openitems");
    const blockers = el("div", { class: "blockers" },
      ...o.blockers.map((b) => el("div", { class: `blocker ${b.severity}` },
        el("h4", {}, el("span", { class: `pill ${b.severity === "critical" ? "late" : b.severity === "high" ? "warn" : "go"}`, text: b.severity }), " ", b.title),
        el("p", { text: b.detail }),
        el("small", { text: `Owner: ${b.owner} · Waiting on: ${b.waiting_on}` }))));

    const kids = [
      el("h2", { text: "What's in the way" }),
      el("p", { class: "lede", text: "Every one of these blocks something on the schedule above." }),
      blockers,
      el("div", { style: "margin-top:18px" },
        el("h4", { class: "sub", text: "Standing direction — non-negotiable" }),
        el("ul", { style: "list-style:none;display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink-dim)" },
          ...o.standing_direction.map((t) => el("li", { text: "· " + t }))))
    ];

    // Unanswered replies and who owes whom are working notes, not client-facing
    // ones — HANDOFF.md is explicit that open-items.json is internal. Off by
    // default, and labelled when it's on.
    if (store.internal) {
      kids.push(el("div", { class: "internal" },
        el("h4", { text: "Internal only — open commitments and what we're waiting on" }),
        el("ul", {},
          ...o.open_commitments.map((c) => el("li", {},
            el("b", { text: `${shortDate(c.date)} → ${c.to}: ` }), c.quote ? `"${c.quote}" — ${c.detail}` : c.detail)),
          ...o.awaiting_others.map((a) => el("li", {},
            el("b", { text: `Waiting on ${a.from}: ` }), a.detail)))));
    }
    mount(pane, kids);
  }

  function renderFoot() {
    const m = CAT.meta || {};
    mount($("#foot"),
      el("p", {}, `${m.campaign || "OKEII"} · compiled ${m.compiled || ""} · every ad points at `,
        el("a", { href: m.destination || "#", target: "_blank", rel: "noopener", text: m.destination || "" })),
      el("p", { text: "Internal review board. Creative on this page is unreleased — the link is unlisted and deliberately not indexed." }),
      el("p", {},
        el("button", { class: "tool", id: "internal-toggle",
          text: store.internal ? "Hide internal notes" : "Show internal notes",
          onclick: (e) => { store.internal = !store.internal; renderOpenItems();
            e.target.textContent = store.internal ? "Hide internal notes" : "Show internal notes"; } })),
    );
  }

  // ── filtering ────────────────────────────────────────────────────────────

  function matches(slotId) {
    const entry = SLOTS.get(slotId);
    const v = currentOf(slotId);
    if (query && !CARDS.get(slotId)._search.includes(query)) return false;
    switch (filter) {
      case "todo": return !v;
      case "done": return Boolean(v);
      case "flag": return (v && slotVerdict(entry.slot, v) !== "ok") || entry.group.status === "blocked";
      case "due": {
        if (entry.group.status === "delivered" || entry.group.status === "reference") return false;
        const n = daysUntil(entry.group.due);
        return entry.group.status === "blocked" || (n !== null && n <= SOON_DAYS);
      }
      default: return true;
    }
  }

  function applyFilter() {
    for (const [id, node] of CARDS) node.hidden = !matches(id);
    // A group or channel with nothing left showing is noise, so it folds away.
    for (const grp of $$(".grp")) {
      const any = $$(".slot", grp).some((n) => !n.hidden);
      grp.hidden = !any;
    }
    for (const cat of $$(".cat")) {
      const any = $$(".grp", cat).some((n) => !n.hidden);
      cat.hidden = !any;
      const link = $(`.rail a[data-cat="${cat.dataset.cat}"]`);
      if (link) link.style.opacity = any ? "" : ".35";
    }
  }

  // ── drawer ───────────────────────────────────────────────────────────────

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
    history.replaceState(null, "", location.pathname + location.search);
  }

  function drawerBody(slot, group) {
    const v = currentOf(slot.id);
    const versions = historyOf(slot.id);

    const stage = el("div", { class: "stage" });
    if (!v) {
      stage.append(el("div", { class: "empty-stage" },
        el("p", { text: "Nothing here yet." }),
        slot.seed
          ? el("p", { style: "margin-top:8px;font-size:12px" }, "A file for this exists on the NAS at ", el("code", { text: slot.seed }), " — it just hasn't been published to the board.")
          : el("p", { style: "margin-top:8px;font-size:12px", text: "Drop the file below, or on the card itself." })));
    } else if (v.kind === "image") {
      stage.append(el("img", { src: v.url, alt: v.filename }));
    } else if (v.kind === "video") {
      stage.append(el("video", { src: v.url, controls: true, playsinline: true, preload: "metadata" }));
    } else {
      stage.append(el("div", { class: "empty-stage" },
        el("p", { text: `${v.filename} — ${bytes(v.size)}` }),
        el("p", { style: "margin-top:8px" }, el("a", { href: v.url, target: "_blank", rel: "noopener", text: "Open it in a new tab" }))));
    }

    const dz = el("div", { class: "dz" },
      el("b", { text: v ? "Drop a new version here" : "Drop the file here" }),
      el("span", {}, "or ", el("label", {}, "choose a file",
        el("input", { type: "file", class: "vh", onchange: (e) => { const f = e.target.files?.[0]; if (f) startUpload(f, slot.id); e.target.value = ""; } }))),
      v ? el("p", { style: "margin-top:6px;font-size:12px;color:var(--ink-faint)", text: `${versions.length} version${versions.length === 1 ? "" : "s"} on file. The one it replaces stays below.` }) : null);
    dropTarget(dz, slot.id, "is-over");

    const spec = el("dl", { class: "kv" });
    const add = (k, val) => { if (val !== null && val !== undefined && val !== "") spec.append(el("dt", { text: k }), el("dd", { text: String(val) })); };
    add("Channel", group.vendor || "");
    add("Due", group.due ? `${shortDate(group.due)} (${whenPill(group.due, group.status).text.toLowerCase()})` : "no vendor date yet");
    add("Format", slot.w && slot.h ? `${slot.w} × ${slot.h} px${slot.ratio ? ` · ${slot.ratio}` : ""}` : slot.ratio || "");
    add("File types", slot.formats?.length ? slot.formats.join(", ") : "");
    add("Weight cap", slot.maxBytes ? bytes(slot.maxBytes) : "");
    add("Runs as", slot.use || "");
    add("Required", slot.required === false ? "Optional" : "Yes — the vendor spec asks for it");
    if (slot.note) add("Note", slot.note);
    if (slot.source) spec.append(el("dt", { text: "Spec from" }), el("dd", { class: "mono", text: slot.source }));

    const kids = [
      stage,
      dz,
      el("div", {}, el("h4", { class: "sub", text: "What this placeholder has to be" }), spec),
    ];

    if (v) {
      const checks = specCheck(slot, v);
      kids.push(el("div", {},
        el("h4", { class: "sub", text: "Does the current file clear it?" }),
        checks.length
          ? el("div", { class: "check" }, ...checks.map((c) => el("div", { class: c.ok === true ? "pass" : c.ok === false ? "fail" : c.ok === "warn" ? "fail" : "idk" },
              el("b", { text: c.ok === true ? "✓" : c.ok === false ? "✕" : c.ok === "warn" ? "!" : "?" }), el("span", { text: c.text }))))
          : el("p", { style: "font-size:13px;color:var(--ink-faint)", text: "No measurable spec is captured for this one yet — judge it on the creative." })));
    }

    if (versions.length) {
      kids.push(el("div", {},
        el("h4", { class: "sub", text: `History — ${versions.length} version${versions.length === 1 ? "" : "s"}` }),
        el("div", { class: "vers" }, ...versions.map((ver) => versionRow(slot, ver, ver.id === (STATE.slots[slot.id]?.currentId))))));
    }
    return kids;
  }

  function versionRow(slot, v, isCurrent) {
    const thumb = el("div", { class: "thumb" },
      v.kind === "image"
        ? el("img", { src: v.url, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(el("span", { text: extOf(v.filename).toUpperCase() })) })
        : el("span", { text: extOf(v.filename).toUpperCase() }));

    const acts = el("div", { class: "acts" },
      el("a", { href: v.downloadUrl || v.url, download: v.filename, text: "Download" }),
      !isCurrent && el("button", { text: "Make current", onclick: () => act("restore", { slotId: slot.id, versionId: v.id, by: store.who }, "Restored.") }),
      // Deletion is the one thing the key always gates, so when no key is
      // configured the button can never work — say why instead of failing.
      GATE.keyRequired
        ? el("button", { class: "danger", text: "Remove", onclick: () => {
            if (!confirm(`Remove ${v.filename} from this slot's history? The file is deleted from the store.`)) return;
            act("remove", { slotId: slot.id, versionId: v.id, by: store.who }, "Removed.");
          } })
        : el("span", { class: "acts-off", title: "Set OKEII_REVIEW_KEY on the project to enable deletion.", text: "No delete" }));

    return el("div", { class: `ver${isCurrent ? " is-current" : ""}` },
      thumb,
      el("div", { class: "meta" },
        el("b", { text: v.filename }),
        el("small", { text: [
          isCurrent ? "Current" : null,
          v.width && v.height ? `${v.width}×${v.height}` : null,
          bytes(v.size),
          v.by,
          ago(v.uploadedAt),
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
    CARDS.clear();
    renderSections();
    renderRail();
    renderSummary();
    applyFilter();
    trackRail();
    if (openSlot && SLOTS.has(openSlot)) {
      const { slot, group } = SLOTS.get(openSlot);
      mount($("#drawer-body"), drawerBody(slot, group));
    }
  }

  // ── dropping files ───────────────────────────────────────────────────────

  function dropTarget(node, slotId, cls = "is-over") {
    let depth = 0;
    node.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth++; node.classList.add(cls); });
    node.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; });
    node.addEventListener("dragleave", (e) => { e.stopPropagation(); if (--depth <= 0) { depth = 0; node.classList.remove(cls); } });
    node.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      depth = 0; node.classList.remove(cls);
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
    }
    const note = "";
    const card = CARDS.get(slotId);
    const bar = card && $(".slot-bar i", card);
    card?.classList.add("is-busy");
    const progress = (p) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; };

    try {
      progress(0.02);
      const dims = await probe(file);
      const sha = await checksum(file);
      const base = { slotId, filename: file.name, size: file.size, by: store.who, note, sha, ...dims };

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
     slice should show as a stalled bar, not as three of them fighting for the
     same uplink. */
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
     duplicate drop is cheaper to just accept than to guard against. */
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
    $("#filters").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      filter = b.dataset.filter;
      $$(".chip", $("#filters")).forEach((c) => c.classList.toggle("is-on", c === b));
      applyFilter();
    });

    let t;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { query = e.target.value.trim().toLowerCase(); applyFilter(); }, 120);
    });

    const who = $("#who");
    who.textContent = store.who || "Sign in";
    who.addEventListener("click", () => {
      const v = prompt("Your name — it rides along with anything you drop.", store.who);
      if (v === null) return;
      store.who = v.trim();
      who.textContent = store.who || "Sign in";
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
    // obvious that the drop has to land on a specific placeholder.
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
      toast(GATE.keyRequired ? (GATE.unlocked ? "Unlocked." : "That key wasn't accepted.") : "No key is required on this project.", GATE.keyRequired && !GATE.unlocked ? "bad" : "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  }

  function trackRail() {
    const links = new Map($$(".rail a").map((a) => [a.dataset.cat, a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.remove("is-here"));
        links.get(e.target.dataset.cat)?.classList.add("is-here");
      }
    }, { rootMargin: "-180px 0px -70% 0px" });
    $$(".cat").forEach((c) => io.observe(c));
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
