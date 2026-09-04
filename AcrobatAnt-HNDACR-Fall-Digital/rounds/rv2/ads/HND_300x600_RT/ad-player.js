/* =========================================================================
   ad-player.js — Fall 2026 HTML5 unit runtime.

   One player, every unit: reads the unit's inline AD config (layout boxes
   lifted from the client PSD audits + choreography from the creative
   brief), builds the DOM, runs entrances via the Web Animations API, and
   drives Frame 1's vehicle/leaves/streaks through the shared FallEngine
   replaying the baked recipe.json from the Fall Ad Builder.

   The recipe contract: whatever scene key the recipe references
   ('honda' / 'acura'), the player maps it to THIS unit's own vehicle art,
   so one take performed in the builder drives every unit it's assigned to.

   Freeze-frame QA: all entrances are WAAPI (seekable via getAnimations);
   the engine can be stepped deterministically via window.__adSeek(ms).
   ========================================================================= */
'use strict';

/* global AD, FallEngine, clickTag */

(async function () {
  const root = document.getElementById('ad');
  const W = AD.w, H = AD.h;
  root.style.width = W + 'px';
  root.style.height = H + 'px';

  /* ---------- asset gate ----------
     Nothing builds and no clock starts until everything the first paint
     depends on is here: every image the config references, the declared
     webfonts, the leaf sprite sheets, and — critically — recipe.json.
     Without the recipe in the gate, the drive-relative cues stayed
     unarmed for one network round-trip (the fetch is no-store, so EVERY
     load pays it) and the exit-only frame-2 pieces — the technician —
     flashed through on any real connection; localhost's ~0ms RTT is why
     it never reproduced on the preview server. The page shows only the
     unit's own bg color during the wait; a 3s cap means a missing file
     degrades to the old behavior, never a hang. */
  const recipeP = fetch('recipe.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null));
  // decoded instances survive the gate: the engine adopts these directly, so
  // its first frame never waits on a fresh Image resolving from cache
  const gateImgs = new Map();
  await (function preload() {
    const srcs = new Set();
    for (const spec of AD.els || []) {
      if (spec.src) srcs.add(spec.src);
      const a = spec.anim || {};
      for (const s of a.srcs || []) srcs.add(s);
    }
    const eng = AD.engine || {};
    for (const k in (eng.sceneSources || {})) srcs.add(eng.sceneSources[k]);
    if (eng.cutout) srcs.add(eng.cutout);
    if (eng.canvas && typeof FallEngine !== 'undefined' && FallEngine.SPRITE_SETS) {
      for (const setName in FallEngine.SPRITE_SETS) {
        for (const f of FallEngine.SPRITE_SETS[setName]) srcs.add('images/' + f);
      }
    }
    const loads = [...srcs].map(src => new Promise(res => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = src;
      gateImgs.set(src, im);
      if (im.decode) im.decode().then(res, res);
    }));
    loads.push(recipeP.catch(() => null));
    // @font-face fetches normally start only when rendered text first needs
    // them — force them now so copy never restyles mid-entrance (FOUT)
    if (document.fonts && document.fonts.forEach) {
      document.fonts.forEach((ff) => loads.push(ff.load().catch(() => null)));
    }
    return Promise.race([
      Promise.all(loads),
      new Promise(res => setTimeout(res, 3000)),
    ]);
  })();

  const S = 1000; // ms
  const timers = [];    // wall-clock cues; __adSeek clears them so a seek wins
  // anims that only ever REMOVE an element — it has to start visible.
  // Declared up here: applyInitial runs during the DOM build, above.
  const EXIT_ONLY = { out: 1, slideOutLeft: 1, slideUp: 1, hold: 1, move: 1 };
  function at(fn, ms) { timers.push(setTimeout(fn, ms)); }
  const els = {};       // id -> element
  let engine = null;
  const anims = [];     // [Animation]

  function px(v) { return v + 'px'; }
  // a radius is one number, or four corners [tl, tr, br, bl] — a window that
  // bleeds off the ad keeps square corners on the edge it touches
  function radiusCss(r) { return Array.isArray(r) ? r.map(px).join(' ') : px(r); }
  function boxStyle(el, box, z) {
    el.style.position = 'absolute';
    el.style.left = px(box[0]);
    el.style.top = px(box[1]);
    el.style.width = px(box[2]);
    el.style.height = px(box[3]);
    if (z != null) el.style.zIndex = z;
  }

  /* ---------- build DOM from config ---------- */
  for (const spec of AD.els) {
    let el;
    if (spec.type === 'img') {
      el = document.createElement('img');
      el.src = spec.src;
      el.draggable = false;
      el.style.display = 'block';
      if (spec.fit === 'contain' || spec.fit === 'cover') {
        el.style.objectFit = spec.fit;
        el.style.width = '100%'; el.style.height = '100%';
        // A MASKED photo is sized to cover its window and allowed to overflow,
        // centred, so posing it has somewhere to pan. Sized to the window with
        // object-fit instead, the crop is decided before any transform runs and
        // a pan only drags empty card into view.
        if (spec.clip && spec.fit === 'cover' && spec.natural) {
          const [nw, nh] = spec.natural;
          const s = Math.max(spec.box[2] / nw, spec.box[3] / nh);
          el.style.objectFit = '';
          el.style.position = 'absolute';
          el.style.left = '50%'; el.style.top = '50%';
          el.style.width = px(nw * s); el.style.height = px(nh * s);
          el.__centred = true;
        }
        const wrap = document.createElement('div');
        boxStyle(wrap, spec.box, spec.z);
        if (spec.clip) wrap.style.overflow = 'hidden';
        if (spec.radius) wrap.style.borderRadius = radiusCss(spec.radius);
        // imgPose moves/scales the picture inside its mask, leaving the window
        // exactly where the PSD put it
        if (spec.imgPose) {
          const p = spec.imgPose;
          el.style.transform = poseCss(el, p.dx, p.dy, p.rot, p.scale);
        } else if (el.__centred) {
          el.style.transform = poseCss(el, 0, 0, 0, 1);
        }
        // A masked photo poses its PICTURE — and that has to hold for its
        // ANIMATED poses too, not just its resting one. Scaling the wrapper
        // would grow the hole in the card instead of pushing into the shot.
        if (spec.clip) { wrap.__pic = el; wrap.__pose = spec.imgPose || null; }
        wrap.appendChild(el);
        wrap.id = spec.id;
        root.appendChild(wrap);
        els[spec.id] = wrap;
        els[spec.id + '.img'] = el;
        applyInitial(wrap, spec);
        continue;
      }
      boxStyle(el, spec.box, spec.z);
      // spec.clipTo: the PSD masks this art to another box (e.g. the photo
      // card) — wrap it in that box. spec.unclipAt releases the mask so the
      // art can travel out of the card during a transition.
      if (spec.clipTo) {
        const cw = document.createElement('div');
        boxStyle(cw, spec.clipTo, spec.z);
        cw.style.overflow = 'hidden';
        if (spec.clipRadius) cw.style.borderRadius = radiusCss(spec.clipRadius);
        boxStyle(el, [spec.box[0] - spec.clipTo[0], spec.box[1] - spec.clipTo[1],
                      spec.box[2], spec.box[3]], null);
        cw.appendChild(el);
        cw.id = spec.id + '_clip';
        root.appendChild(cw);
        el.id = spec.id;
        el.__clipWrap = cw;
        els[spec.id] = el;
        els[spec.id + '.clip'] = cw;
        if (spec.unclipAt != null) {
          at(() => { cw.style.overflow = 'visible'; }, spec.unclipAt * S);
        }
        applyInitial(el, spec);
        continue;
      }
    } else if (spec.type === 'text') {
      el = document.createElement('div');
      el.innerHTML = spec.html;
      boxStyle(el, spec.box, spec.z);
      Object.assign(el.style, spec.css || {});
    } else if (spec.type === 'rect') {
      el = document.createElement('div');
      boxStyle(el, spec.box, spec.z);
      Object.assign(el.style, spec.css || {});
    } else if (spec.type === 'canvas') {
      el = document.createElement('div');
      boxStyle(el, spec.box, spec.z);
      if (spec.clip !== false) el.style.overflow = 'hidden';
      if (spec.radius) el.style.borderRadius = radiusCss(spec.radius);
      const cv = document.createElement('canvas');
      el.appendChild(cv);
      els[spec.id + '.canvas'] = cv;
    }
    el.id = spec.id;
    root.appendChild(el);
    els[spec.id] = el;
    applyInitial(el, spec);
    if (spec.autoFit) {
      // wait for the webfont, or the fit is measured against the fallback
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => autoFit(el, spec));
      else autoFit(el, spec);
    }
  }

  // Shrink text that would overflow its box, down to spec.autoFit at most. The
  // dealer line is the only dynamic copy in the ad and its length varies wildly,
  // so the intended size holds for nearly everyone and only the longest names
  // step down instead of spilling out of the layout.
  function autoFit(el, spec) {
    if (!spec.autoFit) return;
    const box = spec.box;
    let size = parseFloat(getComputedStyle(el).fontSize) || 16;
    const floor = +spec.autoFit;
    let guard = 24;
    while (guard-- > 0 && size > floor &&
           (el.scrollHeight > box[3] + 1 || el.scrollWidth > box[2] + 1)) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
    }
  }
  function applyInitial(el, spec) {
    // art placed at an angle in the PSD (the passport sheets) carries its base
    // rotation here; animations that rotate it fold the angle into their own
    // keyframes, so this is only the resting pose.
    if (spec.rot) el.style.transform = `rotate(${spec.rot}deg)`;
    // drop-shadow (not box-shadow): follows the art's alpha, so a passport
    // sheet casts from its actual paper edge rather than its bounding box
    if (spec.shadow) el.style.filter = `drop-shadow(${spec.shadow})`;
    const a = spec.anim;
    if (!a || a.type === 'none') return;
    // pre-entrance state so nothing flashes before its cue
    if (a.type !== 'stampSeq' && a.type !== 'scaleSlow' && a.type !== 'panSlow'
        && !EXIT_ONLY[a.type]) {
      el.style.opacity = '0';
    }
  }

  /* ---------- entrance primitives (per the creative brief) ---------- */
  // On a masked photo the transform cues drive the picture inside the window;
  // everything else transforms its own box. The resting imgPose is folded into
  // the keyframes so a move starts from wherever the crop was left, rather than
  // snapping back to the untouched picture on its first frame.
  function poseTarget(el) { return el.__pic || el; }
  function poseBase(el) {
    const p = el.__pic ? el.__pose : null;
    return { dx: (p && p.dx) || 0, dy: (p && p.dy) || 0, rot: (p && p.rot) || 0,
             scale: p && p.scale != null ? p.scale : 1 };
  }
  // A picture that overflows its mask is anchored at the window's centre with
  // left/top 50%, so every pose it takes has to carry that centring with it.
  function poseCss(el, dx, dy, rot, scale) {
    return (el.__centred ? 'translate(-50%, -50%) ' : '')
      + `translate(${dx || 0}px, ${dy || 0}px) `
      + `rotate(${rot || 0}deg) scale(${scale == null ? 1 : scale})`;
  }
  function run(el, keyframes, opts) {
    const an = el.animate(keyframes, Object.assign({ fill: 'both', easing: 'cubic-bezier(.33,0,.2,1)' }, opts));
    anims.push(an);
    return an;
  }
  const ENTER = {
    upFade(el, a) {           // default: subtle up + 0→100 fade
      run(el, [
        { opacity: 0, transform: `translateY(${a.dist != null ? a.dist : 14}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: a.at * S, duration: (a.dur || 0.7) * S });
    },
    fade(el, a) {
      run(el, [{ opacity: 0 }, { opacity: 1 }], { delay: a.at * S, duration: (a.dur || 0.6) * S });
    },
    shootIn(el, a) {          // Acura B: fast side entry; dist kept small on 728 per brief
      const d = (a.dir === 'left' ? -1 : 1) * (a.dist != null ? a.dist : 90);
      run(el, [
        { opacity: 0, transform: `translateX(${d}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { delay: a.at * S, duration: (a.dur || 0.35) * S, easing: 'cubic-bezier(.17,.67,.24,1)' });
    },
    slideBottom(el, a) {      // small-format CTA button
      run(el, [
        { opacity: 0, transform: `translateY(${a.dist != null ? a.dist : 40}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: a.at * S, duration: (a.dur || 0.5) * S });
    },
    slideRight(el, a) {       // CTA slides in from the right edge
      run(el, [
        { opacity: 0, transform: `translateX(${a.dist != null ? a.dist : 60}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { delay: a.at * S, duration: (a.dur || 0.5) * S });
    },
    wordByWord(el, a) {       // Acura A "stomp": quick per-word scale-drop
      el.style.opacity = '1';
      const words = el.querySelectorAll('.w');
      words.forEach((w, i) => {
        w.style.opacity = '0';
        run(w, [
          { opacity: 0, transform: 'scale(1.9)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { delay: (a.at + i * (a.gap || 0.22)) * S, duration: (a.dur || 0.28) * S, easing: 'cubic-bezier(.2,0,.3,1)' });
      });
    },
    scaleSlow(el, a) {        // technician default: slow scale up over time
      el.style.opacity = '1';
      const b = poseBase(el);
      const img = el.__pic || el.querySelector('img') || el;
      run(img, [
        { transform: poseCss(img, b.dx, b.dy, b.rot, b.scale) },
        { transform: poseCss(img, b.dx, b.dy, b.rot, b.scale * (a.to || 1.07)) },
      ], { delay: a.at * S, duration: (a.dur || 6) * S, easing: 'linear' });
    },
    panSlow(el, a) {          // technician exception (e.g. ACR 160x600): pan, no scale
      el.style.opacity = '1';
      const b = poseBase(el);
      const img = el.__pic || el.querySelector('img') || el;
      run(img, [
        { transform: poseCss(img, b.dx, b.dy, b.rot, b.scale) },
        { transform: poseCss(img, b.dx + (a.dist != null ? a.dist : -14), b.dy, b.rot, b.scale) },
      ], { delay: a.at * S, duration: (a.dur || 6) * S, easing: 'linear' });
    },
    stampSeq(el, a) {         // Honda smalls: progressive stamp states
      el.style.opacity = '1';
      const img = el.querySelector('img') || el;
      // Each later state stacks over the first as an overlay that fades up —
      // states are supersets, so shared pixels hold still and only the new
      // stamp materialises. (The old src swap popped, and a timer-driven swap
      // was invisible to __adSeek.)
      const fadeMs = Math.max((a.fade != null ? a.fade : 0) * S, 1);
      a.srcs.forEach((src, i) => {
        if (i === 0) return;
        const ov = img.cloneNode(false);
        ov.src = src;
        ov.style.opacity = '0';
        // a static-flow base would push the clone BELOW itself (and the mask
        // clips it away) — pin the overlay over the base instead; the centred
        // variant already carries absolute + its centring transform inline
        if (!img.__centred) {
          ov.style.position = 'absolute';
          ov.style.left = '0'; ov.style.top = '0';
        }
        img.parentNode.appendChild(ov);
        ov.animate([{ opacity: 0 }, { opacity: 1 }],
                   { delay: (a.at + i * a.gap) * S, duration: fadeMs,
                     fill: 'forwards', easing: 'cubic-bezier(.33,0,.2,1)' });
      });
    },
    passportSlide(el, a) {    // Honda A transition: passport wipe/reveal
      el.style.opacity = '1';
      const [x0, y0] = a.from, [x1, y1] = a.to;
      // the passport sheet lives BEHIND the vehicle card in F1 (matches the
      // flattened comp), then lifts above everything to perform the wipe
      // when the art is masked into a card, the clip wrapper carries the z
      if (a.zTo != null) at(() => { (el.__clipWrap || el).style.zIndex = a.zTo; }, a.at * S);
      run(el, [
        { transform: `translate(${x0}px, ${y0}px) rotate(${a.rot0 || 0}deg) scale(${a.s0 || 1})`, opacity: 1 },
        { transform: `translate(${x1}px, ${y1}px) rotate(${a.rot1 || 0}deg) scale(${a.s1 || 1})`, opacity: 1 },
      ], { delay: a.at * S, duration: (a.dur || 1.1) * S, easing: 'cubic-bezier(.4,0,.2,1)' });
    },
    slideOutLeft(el, a) {     // Honda B transition: vehicle exits its container
      // The CONTENT leaves, the window stays. Animating the host moved the
      // rounded mask itself across the ad — the masked-photo disease again
      // (poseTarget for photos; here the host's inner canvas). The board is
      // explicit: "slides out to left within its container."
      const t = el.querySelector('canvas') || el;
      // Soft reveal: the trailing (right) edge of the departing scene is an
      // alpha ramp, not a hard line. The mask is OVERSIZED and parked so the
      // ramp hangs past that edge at rest — fully opaque, invisible — and a
      // second animation on the same clock slides it in as the content starts
      // to move. Both are WAAPI, so the Deck scrubber resolves them at any
      // frame. a.soft overrides the ramp width; 0 turns it off.
      const soft = a.soft != null ? a.soft : 18;
      if (soft > 0) {
        // The mask box is oversized by 2×soft and parked so the ramp BEGINS a
        // full soft-width past the canvas edge at rest. Parked at exactly the
        // edge (the old 1×), WebKit's calc/mask rounding could pull the ramp
        // a fraction inside — a ~1px translucent sliver down the right edge
        // of the resting ad in Safari. The slide travels 2×soft, so the ramp
        // lands at the same mid-slide position as before, frame for frame.
        t.style.webkitMaskImage = t.style.maskImage =
          `linear-gradient(to right, #000 calc(100% - ${soft}px), transparent)`;
        t.style.webkitMaskSize = t.style.maskSize = `calc(100% + ${2 * soft}px) 100%`;
        t.style.webkitMaskRepeat = t.style.maskRepeat = 'no-repeat';
        run(t, [
          { webkitMaskPosition: '0px 0px', maskPosition: '0px 0px' },
          { webkitMaskPosition: `${-2 * soft}px 0px`, maskPosition: `${-2 * soft}px 0px`, offset: 0.15 },
          { webkitMaskPosition: `${-2 * soft}px 0px`, maskPosition: `${-2 * soft}px 0px` },
        ], { delay: a.at * S, duration: (a.dur || 0.9) * S, easing: 'linear' });
      }
      run(t, [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${-(a.dist || W)}px)`, opacity: 1 },
      ], { delay: a.at * S, duration: (a.dur || 0.9) * S, easing: 'cubic-bezier(.4,0,.6,1)' });
      el.style.opacity = '1';
    },
    slideUp(el, a) {          // 728 B exception: vehicle exits upward
      const t = el.querySelector('canvas') || el;   // same split as slideOutLeft
      const soft = a.soft != null ? a.soft : 14;    // and the same soft edge, on the bottom
      if (soft > 0) {
        // 2×soft parking, same reason as slideOutLeft: the resting ramp must
        // start clear of the canvas edge or WebKit rounding shaves the last
        // pixel row of the resting ad
        t.style.webkitMaskImage = t.style.maskImage =
          `linear-gradient(to bottom, #000 calc(100% - ${soft}px), transparent)`;
        t.style.webkitMaskSize = t.style.maskSize = `100% calc(100% + ${2 * soft}px)`;
        t.style.webkitMaskRepeat = t.style.maskRepeat = 'no-repeat';
        run(t, [
          { webkitMaskPosition: '0px 0px', maskPosition: '0px 0px' },
          { webkitMaskPosition: `0px ${-2 * soft}px`, maskPosition: `0px ${-2 * soft}px`, offset: 0.15 },
          { webkitMaskPosition: `0px ${-2 * soft}px`, maskPosition: `0px ${-2 * soft}px` },
        ], { delay: a.at * S, duration: (a.dur || 0.9) * S, easing: 'linear' });
      }
      run(t, [
        { transform: 'translateY(0)', opacity: 1 },
        { transform: `translateY(${-(a.dist || H)}px)`, opacity: 1 },
      ], { delay: a.at * S, duration: (a.dur || 0.9) * S, easing: 'cubic-bezier(.4,0,.6,1)' });
      el.style.opacity = '1';
    },
    out(el, a) {              // generic exit (headline leaves before F2)
      // fill FORWARDS, not both: a backwards fill paints opacity 1 from t=0,
      // which silently cancelled every entrance fade this ran alongside —
      // copy that should have faded in was simply on screen from frame one.
      run(el, [{ opacity: 1 }, { opacity: 0 }],
          { delay: a.at * S, duration: (a.dur || 0.4) * S, fill: 'forwards' });
    },
    hold(el) { el.style.opacity = '1'; },   // present from t=0, no entrance
    // start pose -> end pose, authored in Layout mode. A second leg (a piece
    // that arrives, holds, then moves on) is another `move` in `also`, carrying
    // `from` so it picks up where the first one stopped — both legs measure
    // their poses from the same start, so they share one frame of reference.
    move(el, a) {
      el.style.opacity = '1';
      const [x0, y0] = a.from || [0, 0];
      const [x1, y1] = a.to || [0, 0];
      const b = poseBase(el), t = poseTarget(el);
      if (a.zTo != null) at(() => { (el.__clipWrap || el).style.zIndex = a.zTo; }, a.at * S);
      const opts = { delay: a.at * S, duration: (a.dur || 1) * S,
                     easing: a.ease || 'cubic-bezier(.4,0,.2,1)' };
      // A later leg fills FORWARDS only. Animations resolve in creation order,
      // so a backwards fill would paint leg 2's start pose over leg 1 while
      // leg 1 is still running and freeze it where it stood.
      if (a.fill) opts.fill = a.fill;
      run(t, [
        { transform: poseCss(t, b.dx + x0, b.dy + y0, b.rot + (a.rot0 || 0), b.scale * (a.s0 || 1)) },
        { transform: poseCss(t, b.dx + x1, b.dy + y1, b.rot + (a.rot1 || 0), b.scale * (a.s1 || 1)) },
      ], opts);
    },
    show(el, a) { at(() => { el.style.opacity = '1'; }, a.at * S); }
  };

  // Cues that hang off the DRIVE rather than off a fixed clock wait for
  // recipe.json, because that is what says how long the drive is. The frame-2
  // crossfade is one: the technician comes up over the drive's last beat and is
  // fully there the moment the car stops, whatever length the take made it.
  const deferred = [];
  function runCue(spec, a) {
    const fn = ENTER[a.type];
    if (fn) fn(els[spec.id], a);
    if (a.also) for (const extra of a.also) { const f2 = ENTER[extra.type]; if (f2) f2(els[spec.id], extra); }
  }
  for (const spec of AD.els) {
    const a = spec.anim;
    if (!a || a.type === 'none') { if (els[spec.id]) els[spec.id].style.opacity = '1'; continue; }
    if (spec.relTo === 'driveEnd') { deferred.push(spec); continue; }
    runCue(spec, a);
  }
  function resolveDeferred(driveEnd) {
    for (const spec of deferred) {
      const a = JSON.parse(JSON.stringify(spec.anim));
      const lead = spec.lead != null ? spec.lead : 1;
      const at = Math.max(0, driveEnd - lead);
      a.at = at;
      if (a.dur == null) a.dur = lead;
      for (const extra of (a.also || [])) { extra.at = at; if (extra.dur == null) extra.dur = lead; }
      runCue(spec, a);
    }
    deferred.length = 0;
  }

  /* ---------- Frame-1 engines ----------
     One recipe, split across two canvases:
       scene engine  — vehicle still + streaks (+ car cutout over the streaks),
                       confined to the photo container, stops after transition
       leaf overlay  — leaves only, FULL-AD canvas above the frames, so leaves
                       spill past the card and taper into Frame 2
     paramLock keeps replayed recipe events from re-enabling the other
     engine's systems; both engines share seed + event stream. */
  const engines = [];
  if (AD.engine && window.FallEngine) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function mkEngine(elId, lock, extra) {
      const host = els[elId];
      const cv = els[elId + '.canvas'];
      if (!host || !cv) return null;
      // ANY scene key the recipe references (builder now lists per-unit
      // client art) resolves to THIS unit's own vehicle — recipes stay
      // portable across units and sizes
      const srcs = new Proxy(AD.engine.sceneSources, {
        get: (t, k) => t[k] || t.custom,
      });
      const e = new FallEngine(cv, Object.assign({
        assetBase: 'images/',
        dpr,
        sceneSources: srcs,
        paramLock: lock,
      }, extra || {}));
      e.setSize(parseInt(host.style.width), parseInt(host.style.height));
      e.hostEl = host;
      return e;
    }
    // Leaves start OFF on both engines. The loop begins before recipe.json
    // lands, so the first frames would otherwise render the engine's own
    // defaults — 36 procedural leaves from the top — and then switch them off
    // when a recipe says renderLeaves:false. That was the flash on replay.
    const sceneEng = mkEngine(AD.engine.canvas,
      AD.engine.leafCanvas ? { renderLeaves: false } : null,
      { cutoutSrc: AD.engine.cutout || null,
        taperAt: AD.engine.leafCanvas ? null : AD.engine.taperAt });
    if (sceneEng) {
      sceneEng.stopAtMs = (AD.engine.stopAt != null ? AD.engine.stopAt : AD.dur) * S;
      if (AD.engine.sceneFadeAt != null) {   // smalls: the scene ramps out
        sceneEng.sceneFadeAt = AD.engine.sceneFadeAt;
        sceneEng.sceneFadeDur = AD.engine.sceneFadeDur;
      }
      if (AD.engine.streakOutAt != null) {   // …and the lines get their own
        sceneEng.streakOutAt = AD.engine.streakOutAt;     // envelope: out for
        sceneEng.streakBackAt = AD.engine.streakBackAt;   // the dealer, back
        sceneEng.streakFadeDur = AD.engine.streakFadeDur; // with the CTA
        sceneEng.streakBackAlpha = AD.engine.streakBackAlpha;
        sceneEng.streakWipe = AD.engine.streakWipe || null;   // r2: erase exit (ACR_320x50_B)
        sceneEng.streakWipeDur = AD.engine.streakWipeDur != null ? AD.engine.streakWipeDur : null;
        sceneEng.streakWipeFade = !!AD.engine.streakWipeFade;
      }
      if (AD.engine.streakOutAt2 != null) {  // r2: a SECOND, final exit (ACR B smalls:
        sceneEng.streakOutAt2 = AD.engine.streakOutAt2;   // wipe + fade as the CTA lands)
        sceneEng.streakWipe2 = AD.engine.streakWipe2 || null;
        sceneEng.streakWipe2Dur = AD.engine.streakWipe2Dur != null ? AD.engine.streakWipe2Dur : null;
        sceneEng.streakWipe2Fade = !!AD.engine.streakWipe2Fade;
      }
      if (AD.engine.streakFollow) {          // r2: the lines FOLLOW the copy
        sceneEng.streakFollow = AD.engine.streakFollow;   // (ACR_p7 B) — takes
        sceneEng.streakFollowBandH = AD.engine.streakFollowBandH;   // precedence
      }                                                   // over the envelope
      engines.push(sceneEng);
    }
    if (AD.engine.leafCanvas) {
      const leafEng = mkEngine(AD.engine.leafCanvas,
        { scene: 'none', streaksOn: false, renderStreaks: false, maskOn: false },
        { taperAt: AD.engine.taperAt != null ? AD.engine.taperAt : null });
      if (leafEng) { leafEng.stopAtMs = AD.dur * S; engines.push(leafEng); }
    }
    // car-over-leaves units: the scene engine mirrors its registered cutout
    // onto a dedicated canvas that sits ABOVE the leaf overlay — same
    // transform, same frame, and the element's own exit cue hides it at the
    // cut just like the frame-1 canvas.
    if (sceneEng && AD.engine.cutoutCanvas && els[AD.engine.cutoutCanvas + '.canvas']) {
      const mcv = els[AD.engine.cutoutCanvas + '.canvas'];
      const mhost = els[AD.engine.cutoutCanvas];
      mcv.width = parseInt(mhost.style.width) * dpr;
      mcv.height = parseInt(mhost.style.height) * dpr;
      // The CSS size too — the engine sets it on its own canvas (setSize), this
      // mirror had only the bitmap. On a Retina screen (dpr 2) the bitmap is
      // 600x1200 and a canvas with no CSS size renders at its bitmap size, so
      // the cutout car drew at DOUBLE size, offset from the plate car: the
      // 'duplicate car' the client reported on 728x90 B and Philip saw on the
      // 160x600 / 300x600 B in Chrome — invisible at dpr 1, where every check
      // ran (2026-09-03).
      mcv.style.width = mhost.style.width;
      mcv.style.height = mhost.style.height;
      sceneEng.cutoutMirror = mcv;
    }
    // Hold leaves until recipe.json says whether this unit wants them. The loop
    // starts before the fetch resolves, so otherwise the first frames render the
    // engine's defaults — 36 procedural leaves from the top — and a recipe with
    // renderLeaves:false then switches them off. That was the flash on replay.
    // Set on the instance, NOT on paramLock: applyRecipe re-applies the lock
    // after the recipe, which would silence leaves for good.
    for (const e of engines) e.P.renderLeaves = false;
    engine = engines[0] || null;

    function applyRecipe(e, recipe) {
      if (recipe && recipe.recording) {
        e.loadRecording(recipe.recording);
        e.onReplayEnd = () => {};              // hold final state
        e.startReplay();
        e.setSize(parseInt(e.hostEl.style.width), parseInt(e.hostEl.style.height));
      } else if (recipe) {
        const { seed, recording, ...params } = recipe;
        e.P = Object.assign({}, FallEngine.DEFAULTS, FallEngine.migrateParams(params));
        if (e.paramLock) Object.assign(e.P, e.paramLock);
        if (seed != null) e.setSeed(seed);
        e.setSize(parseInt(e.hostEl.style.width), parseInt(e.hostEl.style.height));
        e.rebuildStreaks();
        if (e.P.scene !== 'none') e.playScene();
      }
    }
    // resolved by the asset gate before the DOM ever built — the .then
    // below runs on the microtask queue right behind cue creation, so the
    // deferred (drive-relative) cues arm in the same frame they are born
    recipeP
      .then((recipe) => {
        if (recipe) for (const e of engines) applyRecipe(e, recipe);
        const drive = recipe && recipe.sceneDur ? +recipe.sceneDur : (AD.engine.taperAt || 4.6);
        // cutLead pulls the frame change EARLIER without shortening the drive —
        // the car keeps its full run and finishes it behind frame 2. Shifting
        // the resolved drive end (rather than each cue's own lead) keeps every
        // drive-relative cue at its authored offset from the cut, so this works
        // for the crossfade creatives and the cut ones alike.
        const cutLead = recipe && +recipe.cutLead ? +recipe.cutLead : 0;
        // Units that graduated their taper off the fixed clock: the leaf
        // fade-out ("Gone by") counts from the RESOLVED cut, so retiming the
        // take retimes the flurry's exit with it.
        if (AD.engine.taperRel) {
          const dEnd = Math.max(0, drive - cutLead);
          for (const e of engines) if (e.taperAt != null) e.taperAt = dEnd;
        }
        resolveDeferred(Math.max(0, drive - cutLead));
      })
      .catch(() => {
        // no recipe: fall back to the engine's own defaults rather than the
        // leaves-off state we started in
        for (const e of engines) if (!e.paramLock || !('renderLeaves' in e.paramLock)) {
          e.P.renderLeaves = FallEngine.DEFAULTS.renderLeaves;
        }
        resolveDeferred(AD.engine.taperAt || 4.6);
      });

    let engineStart = null;
    function engineLoop(now) {
      if (engineStart == null) engineStart = now;
      let live = false;
      for (const e of engines) {
        if (now - engineStart < e.stopAtMs) { e.tick(now); live = true; }
      }
      if (live) requestAnimationFrame(engineLoop);
    }
    requestAnimationFrame(engineLoop);
  }

  /* ---------- readiness: every DOM image + engine scene source loaded ---------- */
  const pending = [...document.images].map((im) =>
    im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }));
  if (AD.engine && engine) {
    for (const key in AD.engine.sceneSources) {
      // adopt the gate's already-decoded instance; fall back to a fresh one
      const src = AD.engine.sceneSources[key];
      const im = gateImgs.get(src) || new Image();
      if (!im.src) im.src = src;
      engine._sceneImgs[key] = im;
      pending.push(im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }));
    }
    if (AD.engine.cutout && gateImgs.has(AD.engine.cutout)) {
      for (const e of engines) if (e.cutoutImg) e.cutoutImg = gateImgs.get(AD.engine.cutout);
    }
    const sprites = engine._sprites; // warm the sprite set too
    const files = FallEngine.SPRITE_SETS[engine.P.spriteSet] || [];
    // sprite params may arrive with recipe.json; preload both sets defensively
    for (const setName in FallEngine.SPRITE_SETS) {
      for (const f of FallEngine.SPRITE_SETS[setName]) {
        const im = new Image();
        im.src = 'images/' + f;
        pending.push(new Promise((r) => { im.onload = im.onerror = r; }));
      }
    }
  }
  window.__adReady = Promise.all(pending);

  /* ---------- click-through (standard clickTag pattern) ---------- */
  root.style.cursor = 'pointer';
  root.addEventListener('click', () => {
    window.open(typeof clickTag !== 'undefined' ? clickTag : AD.clickUrl, '_blank');
  });

  /* ---------- QA hook: freeze every animation + engine at t ms ---------- */
  window.__adSeek = function (ms) {
    // kill pending wall-clock cues first — otherwise one that is still due
    // fires after the freeze and silently overwrites the seeked state
    while (timers.length) clearTimeout(timers.pop());
    for (const an of document.getAnimations()) { an.pause(); an.currentTime = ms; }
    // setTimeout-driven state (z-lifts, stamp swaps) runs on wall clock —
    // recompute it from the config so a seek is always state-correct
    for (const spec of AD.els) {
      const a = spec.anim;
      const el = els[spec.id];
      if (!a || !el) continue;
      if ((a.type === 'passportSlide' || a.type === 'move') && a.zTo != null) {
        (el.__clipWrap || el).style.zIndex = ms >= a.at * S ? a.zTo : (spec.z || 0);
      }
      if (spec.clipTo && spec.unclipAt != null && el.__clipWrap) {
        el.__clipWrap.style.overflow = ms >= spec.unclipAt * S ? 'visible' : 'hidden';
      }
      if (a.type === 'stampSeq') {
        const i = Math.min(a.srcs.length - 1, Math.max(0, Math.floor((ms / S - a.at) / a.gap)));
        (el.querySelector('img') || el).src = a.srcs[i];
      }
    }
    for (const e of engines) {
      // deterministic re-run from zero to ms
      if (e.recording) e.startReplay();
      else { e.setSeed(e.seed); e.rebuildPool(true); e.rebuildStreaks(); e.resetScene(); e.simT = 0; if (e.P.scene !== 'none') e.playScene(); }
      e.paused = true;
      const step = 1 / 60;
      let t = 0;
      const cap = Math.min(ms, e.stopAtMs != null ? e.stopAtMs : ms) / 1000;
      while (t < cap) {
        if (e.recState === 'play' && e.recording) {
          e.playT += step;
          const evs = e.recording.events;
          while (e.playIdx < evs.length && evs[e.playIdx].t <= e.playT) e.applyEvent(evs[e.playIdx++]);
        }
        e.step(step);
        t += step;
      }
      e.draw();
    }
    return 'frozen@' + ms;
  };
})();
