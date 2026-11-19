/* =========================================================================
   leaf-engine.js — Fall 2026 shared animation runtime (UI-free)

   One engine, two hosts:
     · Fall Ad Builder (Design Lab) — authoring: knobs, recorder, guides
     · Ad units (Ad Build/units/*) — playback: replay a baked recipe

   The physics are lifted VERBATIM from leaves-lab.html v5.3 so takes
   recorded in the builder replay pixel-identically inside shipped ads:
   same seeded RNG, same wind field, same flutter/tumble math, same
   scene-rig cover/slack geometry, same event replay semantics.

   New in the engine (beyond the lab):
     · leafStyle 'sprite' — bitmap leaves from the client PSDs (2–4 per
       brand, per the creative brief) with the same flutter transforms
     · streak system — Acura B speed lines: angled, perspective-scaled,
       blurred trails driven by knobs; recordable like everything else
     · renderLeaves / renderStreaks toggles so an ad can split systems
       across two canvases (streaks behind the vehicle, leaves above)

   API (window.FallEngine):
     const eng = new FallEngine(canvas, { assetBase, seed, params, onParam });
     eng.setStage('728x90') | eng.setSize(w, h)
     eng.set(key, value) / eng.setParams(patch)
     eng.playScene() / eng.resetScene() / eng.burstAt(x, y)
     eng.loadRecording(rec); eng.startReplay(); eng.stopReplay()
     eng.tick(now)            — step + draw, call from rAF
     eng.state                — read-only-ish internals for host overlays
   ========================================================================= */
(function (global) {
'use strict';

const STAGES = {
  '600x600': [600, 600], '300x600': [300, 600], '160x600': [160, 600],
  '300x250': [300, 250], '728x90': [728, 90], '320x50': [320, 50], '300x50': [300, 50],
};

/* ---------- seeded RNG (mulberry32) — identical to lab ---------- */
function rngFactory(s) {
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- procedural leaf geometry — identical to lab ---------- */
const LEAF_SHAPES = {
  maple: {
    base: 46,
    path: new Path2D('M50 4 L57 20 L71 10 L67 28 L87 24 L75 41 L94 49 L73 55 L81 73 L61 65 L57 86 L50 71 L43 86 L39 65 L19 73 L27 55 L6 49 L25 41 L13 24 L33 28 L29 10 L43 20 Z'),
    stem: [[50, 71], [50, 96]],
  },
  oak: {
    base: 38,
    path: new Path2D('M50 5 C62 9 64 19 57 25 C70 23 74 33 63 39 C78 39 80 51 65 55 C76 59 73 71 59 69 C63 81 54 87 50 79 C46 87 37 81 41 69 C27 71 24 59 35 55 C20 51 22 39 37 39 C26 33 30 23 43 25 C36 19 38 9 50 5 Z'),
    stem: [[50, 82], [50, 97]],
  },
  aspen: {
    base: 30,
    path: new Path2D('M50 6 C74 6 90 28 83 50 C77 70 63 82 50 90 C37 82 23 70 17 50 C10 28 26 6 50 6 Z'),
    stem: [[50, 90], [50, 99]],
  },
  elm: {
    base: 24,
    path: new Path2D('M50 4 C68 16 75 42 68 63 C63 79 56 88 50 94 C44 88 37 79 32 63 C25 42 32 16 50 4 Z'),
    stem: [[50, 94], [50, 100]],
  },
};

/* cubic-bezier(x1, 0, x2, 1) sampled at t — Newton with a bisection fallback,
   the standard approach for inverting the curve's x for a given progress. */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function bezAt(a, b, t) {          // value of a 1-D cubic bezier with p0=0, p3=1
  const mt = 1 - t;
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
}
function cubicBezierEase(x1, x2, p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let t = p;
  for (let i = 0; i < 6; i++) {    // Newton
    const x = bezAt(x1, x2, t) - p;
    if (Math.abs(x) < 1e-5) return bezAt(0, 1, t);
    const d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(d) < 1e-6) break;
    t -= x / d;
  }
  let lo = 0, hi = 1;              // bisection if Newton stalls
  t = p;
  for (let i = 0; i < 24; i++) {
    const x = bezAt(x1, x2, t);
    if (Math.abs(x - p) < 1e-5) break;
    if (x > p) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  return bezAt(0, 1, t);
}

const PALETTES = {
  mixed:  [[8, 72, 42], [22, 80, 48], [35, 85, 50], [45, 78, 52], [16, 65, 35], [55, 60, 45]],
  red:    [[4, 75, 40], [10, 78, 46], [16, 72, 50], [355, 60, 38], [20, 70, 44]],
  golden: [[38, 88, 52], [45, 85, 55], [50, 80, 58], [32, 82, 48], [42, 75, 50]],
  brown:  [[24, 55, 34], [28, 50, 40], [18, 45, 30], [32, 48, 44], [22, 40, 37]],
};

/* ---------- sprite sets: curated client-PSD leaf bitmaps ----------
   Recordings store only the set NAME, so takes stay portable — each host
   resolves file names against its own assetBase (builder → shared assets
   folder, ad unit → its local images/). */
const SPRITE_SETS = {
  honda: ['hnd_leaf_1.png', 'hnd_leaf_2.png', 'hnd_leaf_3.png', 'hnd_leaf_4.png'],
  acura: ['acr_leaf_1.png', 'acr_leaf_2.png', 'acr_leaf_3.png', 'acr_leaf_4.png'],
};

const DEFAULTS = {
  stage: '600x600', customW: 600, customH: 600, spawnMode: 'top',
  scene: 'none', sceneDur: 5, sceneStartX: -25, sceneEndX: 25,
  sceneStartZoom: 1.15, sceneEndZoom: 1.24,   // crop-in at each end of the drive
  sceneStartY: 0, sceneEndY: 0,           // vertical travel, ± % of card height
  sceneStartRot: 0, sceneEndRot: 1.5,     // rotation animates start -> end (deg)
  sceneEaseIn: 60, sceneEaseOut: 60,   // 0 = hits the ground running / stops dead
  sceneLoop: false, sceneSafeCover: false,
  // How long BEFORE the drive ends frame 2 takes over. The engine never reads
  // it — it is carried in the take so it reaches the ad through the recipe, and
  // the player pulls its drive-relative cues back by this much. 0 = the frame
  // changes exactly when the car stops; 1 = the car drives on for a second
  // behind the technician.
  cutLead: 0,
  syncWake: false, wakeBursts: 6, wakeY: 0.62, recAutoScene: true,
  maskOn: false, maskInset: 16, maskRadius: 24, maskClipLeaves: false, maskShow: true,
  kick: 280, kickAngle: -95, spread: 70, radius: 46, burstCount: 18, showEmitter: true,
  emitterX: 0.5, emitterY: 0.86,
  windSpeed: 35, windLift: 0, gustStrength: 55, gustFreq: 0.14, turbulence: 0.45,
  fallSpeed: 62, speedVar: 0.5,
  count: 36, sizeScale: 1, sizeVar: 0.55, opacity: 0.95, opacityVar: 0.25, depth: true,
  tumble: 90, flutter: 0.55, swayAmp: 34, swaySpeed: 0.7,
  types: ['maple', 'oak', 'aspen', 'elm'],
  palette: 'mixed', bgSelect: 'bg-sky',
  leafLife: 'taper',                // 'taper' | 'f1' | 'continuous' — how leaves
                                    // behave past engine.taperAt (ads set taperAt
                                    // to the frame transition; null = no effect)
  leafClearS: 0,                    // seconds after taperAt by which leaves are
                                    // COMPLETELY gone (forced fade); 0 = natural
                                    // fall-out, no deadline
  leafFadeIn: 0,                    // seconds over which the whole flurry fades
                                    // up from nothing at ad start; 0 = present
                                    // from the first frame
  spawnStagger: 0,                  // 'top' mode: seconds over which arrivals are
                                    // spread — the start band above the frame grows
                                    // by the distance a leaf falls in that time, so
                                    // the pool trickles in instead of dropping as
                                    // one wave that exits and respawns together
                                    // (client R2, the smalls' leaf gaps). 0 = as before
  /* --- engine additions --- */
  leafStyle: 'procedural',          // 'procedural' | 'sprite'
  spriteSet: 'honda',               // key into SPRITE_SETS
  spriteBaseSize: 40,               // px height of a z=1, sizeMul=1 sprite leaf
  streaksOn: false,                 // Acura B speed lines
  streakCount: 14,
  streakAngle: -8,                  // degrees; negative = up-to-the-right lines
  streakSpeed: 900,                 // px/s along the angle (sign = direction)
  streakLen: 120,                   // base length px
  streakLenVar: 0.6,
  streakThickness: 3,
  streakBlur: 4,                    // shadowBlur px — the "motion blur"
  streakOpacity: 0.75,
  streakBandTop: 0.25,              // spawn band, fraction of H
  streakBandBottom: 0.85,
  streakPerspective: 0.6,           // 0 = uniform; 1 = strong depth scaling in band
  streakBend: 0,                    // px of perpendicular arc on each stroke;
                                    // the pen follows the curve, 0 = straight
  streakOffX: 0,                    // place the WHOLE field: px offsets…
  streakOffY: 0,
  streakScale: 1,                   // …and one group scale, about the field's
                                    // own centre (lengths, weights, spacing)
  streakRotate: 0,                  // …and one group rotation (deg) about the
                                    // same pivot — on top of each stroke's Angle
  streakGroupBend: 0,               // px: bends the WHOLE FIELD as one arc — a
                                    // smooth warp of the flow, so neighbouring
                                    // strokes curve together (Bend arcs each
                                    // stroke individually)
  streakFieldW: 1,                  // squeeze the CLUSTER's footprint about the
  streakFieldH: 1,                  // pivot — anchors compress, strokes keep
                                    // their own size (Group scale shrinks both)
  streakColor: '#ffffff',
  renderLeaves: true,
  renderStreaks: true,
};

/* older recipes: scenePan+sceneDir -> start/end X; static sceneOffY ->
   start/end Y; one-way sceneRotDrift -> 0 -> end rotation */
function migrateParams(p) {
  if (p && p.scenePan != null && p.sceneStartX == null) {
    const half = p.scenePan / 2;
    const d = p.sceneDir === 'rtl' ? -1 : 1;
    p.sceneStartX = -half * d;
    p.sceneEndX = half * d;
  }
  if (p && p.sceneOffY != null && p.sceneStartY == null) {
    p.sceneStartY = p.sceneOffY;
    p.sceneEndY = p.sceneOffY;
  }
  // sceneZoom + sceneScaleDrift (a base crop plus a % growth across the drive)
  // became sceneStartZoom / sceneEndZoom, so zoom reads like every other pair
  // in the panel — and can pull OUT, which a positive-only drift could not.
  // the old single "ease in-out" checkbox becomes the two-handle pair
  if (p && p.sceneEase != null && p.sceneEaseIn == null) {
    p.sceneEaseIn = p.sceneEase ? 60 : 0;
    p.sceneEaseOut = p.sceneEase ? 60 : 0;
  }
  if (p && p.sceneZoom != null && p.sceneStartZoom == null) {
    p.sceneStartZoom = p.sceneZoom;
    p.sceneEndZoom = +(p.sceneZoom * (1 + (p.sceneScaleDrift || 0) / 100)).toFixed(3);
  }
  if (p && p.sceneRotDrift != null && p.sceneEndRot == null) {
    p.sceneStartRot = 0;
    p.sceneEndRot = p.sceneRotDrift;
  }
  return p;
}

const KICK_DRAG = 1.8;
const GRAVITY_BLEND = 0.25;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

class FallEngine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = opts.dpr != null ? opts.dpr : Math.min(global.devicePixelRatio || 1, 2);
    this.assetBase = opts.assetBase || '';          // for sprite sets
    /* Scene viewport: the sub-rect of this canvas that the vehicle scene,
       streaks and cutout live in. null = the whole canvas (how each ad's
       dedicated scene canvas behaves). The Fall Ad Builder sets it to the
       unit's real photo window, so one canvas composites what the ad shows:
       scene inside the window, leaves across the whole ad. */
    this.sceneRect = opts.sceneRect || null;
    /* Fades the SCENE only — vehicle, streaks, cutout — leaving leaves at full
       strength. The ads keep those on two separate canvases; the Builder has
       one, so without this its transition preview dimmed the leaves too, right
       at the moment leafLife's taper over the cut needs judging. */
    this.sceneAlpha = 1;
    /* Corner radius for the scene viewport's clip. The ads round their scene
       canvas in CSS and never set this; the Builder draws everything on one
       canvas, so without it the car sat in a square window while the ad's was
       round. */
    this.sceneRadius = 0;
    this.sceneSources = opts.sceneSources || {};    // {key: url} scene stills
    this.onParam = opts.onParam || null;            // host UI sync hook
    this.onStage = opts.onStage || null;

    this.P = Object.assign({}, DEFAULTS, migrateParams(opts.params || {}));
    this.seed = opts.seed != null ? opts.seed : 1337;
    this.rng = rngFactory(this.seed);
    // locked params survive set()/replay — lets an ad split one recipe across
    // a scene engine (renderLeaves:false) and a leaf overlay (scene:'none')
    this.paramLock = opts.paramLock || null;
    if (this.paramLock) Object.assign(this.P, this.paramLock);
    this.taperAt = opts.taperAt != null ? opts.taperAt : null;
    this.cutoutImg = null;
    if (opts.cutoutSrc) { this.cutoutImg = new Image(); this.cutoutImg.src = opts.cutoutSrc; }

    this.W = 600; this.H = 600;
    this.leaves = [];
    this.burstCursor = 0;
    this.streaks = [];
    this.simT = 0;
    this.paused = false;
    this.lastFrame = null;
    this.fpsSmooth = 60;

    this.sceneT = 0; this.scenePlaying = false; this.sceneDone = false; this.wakeFired = 0;
    this._sceneImgs = {};
    this._sprites = {};       // set name -> [Image]
    this._recording = null;
    this.recState = null;     // 'play' | null (capture lives in the host)
    this.playT = 0; this.playIdx = 0;

    if (opts.stage) this.setStage(opts.stage);
    else this.setSize(this.W, this.H);
  }

  /* ---------- sizing ---------- */
  setStage(key) {
    const P = this.P;
    const [w, h] = key === 'custom'
      ? [clamp(parseInt(P.customW) || 600, 50, 1600), clamp(parseInt(P.customH) || 600, 50, 1600)]
      : (STAGES[key] || STAGES['600x600']);
    P.stage = key;
    this.setSize(w, h);
    if (this.onStage) this.onStage(key, w, h);
  }
  setSize(w, h) {
    this.W = w; this.H = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // optional second canvas that takes the LEAVES (the Builder's stage: the ads
    // give leaves their own canvas at z18 above the scrims; one shared canvas
    // put them under every scrim instead). Unset in the ads — inert there.
    if (this.leafCanvas) {
      this.leafCanvas.width = w * this.dpr;
      this.leafCanvas.height = h * this.dpr;
      this.leafCanvas.style.width = w + 'px';
      this.leafCanvas.style.height = h + 'px';
      this.leafCtx = this.leafCanvas.getContext('2d');
      this.leafCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.rebuildPool(true);
    this.rebuildStreaks();
  }

  setSeed(s) { this.seed = s; this.rng = rngFactory(s); }

  /* ---------- params ---------- */
  set(key, value) {
    const P = this.P;
    if (this.paramLock && key in this.paramLock) value = this.paramLock[key];
    P[key] = value;
    if (key === 'count') this.adjustPool();
    else if (key === 'types' || key === 'palette' || key === 'spawnMode' ||
             key === 'leafStyle' || key === 'spriteSet') this.rebuildPool(true);
    else if (key === 'stage') this.setStage(value);
    else if (key.indexOf('streak') === 0) this.rebuildStreaks();
    if (this.onParam) this.onParam(key, value);
  }
  setParams(patch) { for (const k in patch) this.set(k, patch[k]); }

  /* ---------- assets ---------- */
  spriteImages() {
    const setName = this.P.spriteSet;
    const files = SPRITE_SETS[setName] || [];
    if (!this._sprites[setName]) {
      this._sprites[setName] = files.map((f) => {
        const im = new Image();
        im.src = this.assetBase + f;
        return im;
      });
    }
    return this._sprites[setName].filter((im) => im.complete && im.naturalWidth);
  }
  setCutout(url) {
    if (!url) { this.cutoutImg = null; return; }
    this.cutoutImg = new Image();
    this.cutoutImg.src = url;
  }
  sceneImg() {
    const key = this.P.scene;
    if (key === 'none') return null;
    const src = this.sceneSources[key];
    if (!src) return null;
    if (!this._sceneImgs[key]) { const im = new Image(); im.src = src; this._sceneImgs[key] = im; }
    const im = this._sceneImgs[key];
    return im.complete && im.naturalWidth ? im : null;
  }

  /* ---------- leaf pool — algorithms identical to lab ---------- */
  baseProps() {
    const P = this.P, rng = this.rng;
    const types = P.types.length ? P.types : ['maple'];
    const pal = PALETTES[P.palette] || PALETTES.mixed;
    const sprites = this.P.leafStyle === 'sprite' ? this.spriteImages() : [];
    return {
      type: types[(rng() * types.length) | 0],
      spriteIdx: sprites.length ? (rng() * sprites.length) | 0 : 0,
      color: pal[(rng() * pal.length) | 0],
      z: P.depth ? 0.35 + rng() * 0.65 : 1,
      sizeMul: 1 + (rng() * 2 - 1) * P.sizeVar * 0.6,
      speedMul: 1 + (rng() * 2 - 1) * P.speedVar * 0.6,
      alphaMul: 1 - rng() * P.opacityVar,
      angle: rng() * Math.PI * 2,
      spinDir: rng() < 0.5 ? -1 : 1,
      spinMul: 0.4 + rng() * 1.2,
      swayPhase: rng() * Math.PI * 2,
      swayMul: 0.7 + rng() * 0.6,
      flipPhase: rng() * Math.PI * 2,
      flipMul: 0.5 + rng() * 1.1,
      turbSeed: rng() * 100,
      kvx: 0, kvy: 0,
      active: true,
    };
  }
  spawnTop(leaf, scatter) {
    const P = this.P;
    // the band above the frame that arrivals are drawn from: half a frame, plus
    // the fall distance of spawnStagger seconds (0 = the old half-frame band)
    const band = this.H * 0.5 + P.fallSpeed * Math.max(0, +P.spawnStagger || 0);
    Object.assign(leaf, this.baseProps(), {
      x: this.rng() * this.W,
      y: scatter ? this.rng() * this.H : -60 - this.rng() * band,
    });
  }
  spawnKicked(leaf, px, py) {
    const P = this.P, rng = this.rng;
    const r = Math.sqrt(rng()) * P.radius;
    const t = rng() * Math.PI * 2;
    const a = (P.kickAngle + (rng() * 2 - 1) * P.spread / 2) * Math.PI / 180;
    const sp = P.kick * (0.4 + rng() * 0.9);
    Object.assign(leaf, this.baseProps(), {
      x: px + Math.cos(t) * r,
      y: py + Math.sin(t) * r,
      kvx: Math.cos(a) * sp,
      kvy: Math.sin(a) * sp,
    });
  }
  emitterPx() { return [this.P.emitterX * this.W, this.P.emitterY * this.H]; }
  // Emitter mode with spawnStagger: instead of every leaf leaving the spot at
  // once (and the whole pool exiting and returning together), each leaf waits
  // a random slice of the window before it goes, and draws a new wait every
  // time it respawns — a trickle from the spot. 0 = at once, as before.
  spawnFromEmitter(leaf) {
    const P = this.P, stagger = Math.max(0, +P.spawnStagger || 0);
    if (stagger > 0) {
      leaf.active = false;
      leaf.wakeAt = this.simT + this.rng() * stagger;
      return;
    }
    const [ex, ey] = this.emitterPx();
    this.spawnKicked(leaf, ex, ey);
  }
  // past taperAt (+ leafClearS) nothing new may appear — the same rule respawn() applies
  spawningStopped() {
    const P = this.P;
    if (P.leafLife === 'continuous' || this.taperAt == null) return false;
    const stopAt = P.leafClearS ? this.taperAt + P.leafClearS : this.taperAt;
    return this.simT >= stopAt;
  }
  respawn(leaf) {
    const P = this.P;
    // taper: past taperAt, leaves stop respawning and the flurry settles out.
    // With a "gone by" deadline (leafClearS) the flurry keeps spawning THROUGH
    // the fade window instead: on a 90px banner the leaves drain off the
    // bottom in under a second, so cutting respawn at taperAt made any longer
    // deadline unreachable — the alpha ramp fades the live flurry, and by
    // taperAt + leafClearS everything is gone either way.
    if (P.leafLife !== 'continuous' && this.taperAt != null) {
      const stopAt = P.leafClearS ? this.taperAt + P.leafClearS : this.taperAt;
      if (this.simT >= stopAt) {
        leaf.active = false;
        return;
      }
    }
    if (P.spawnMode === 'top') this.spawnTop(leaf, false);
    else if (P.spawnMode === 'emitter') this.spawnFromEmitter(leaf);
    else leaf.active = false;
  }
  rebuildPool(scatter) {
    const P = this.P;
    this.leaves = [];
    this.burstCursor = 0;
    for (let i = 0; i < P.count; i++) {
      const leaf = this.baseProps();
      if (P.spawnMode === 'top') this.spawnTop(leaf, scatter);
      else if (P.spawnMode === 'emitter') this.spawnFromEmitter(leaf);
      else { leaf.active = false; leaf.x = -999; leaf.y = -999; }
      this.leaves.push(leaf);
    }
  }
  adjustPool() {
    const P = this.P;
    while (this.leaves.length < P.count) {
      const leaf = this.baseProps();
      if (P.spawnMode === 'top') this.spawnTop(leaf, true);
      else if (P.spawnMode === 'emitter') this.spawnFromEmitter(leaf);
      else leaf.active = false;
      this.leaves.push(leaf);
    }
    this.leaves.length = Math.min(this.leaves.length, P.count);
  }
  burstAt(px, py) {
    const n = Math.min(this.P.burstCount, this.leaves.length);
    let spawned = 0;
    for (const leaf of this.leaves) {
      if (spawned >= n) break;
      if (!leaf.active) { this.spawnKicked(leaf, px, py); leaf.active = true; spawned++; }
    }
    while (spawned < n) {
      const leaf = this.leaves[this.burstCursor++ % this.leaves.length];
      this.spawnKicked(leaf, px, py); leaf.active = true; spawned++;
    }
  }

  /* ---------- wind — identical to lab ---------- */
  windAt(t, leaf) {
    const P = this.P;
    const f = P.gustFreq * Math.PI * 2;
    const tt = t + leaf.turbSeed * P.turbulence;
    const gust =
      0.55 * Math.sin(f * tt) +
      0.30 * Math.sin(f * 2.63 * tt + 1.7) +
      0.15 * Math.sin(f * 5.11 * tt + 4.1);
    return P.windSpeed + P.gustStrength * gust;
  }

  /* ---------- streaks (Acura B speed lines) ---------- */
  rebuildStreaks() {
    const P = this.P;
    this.streaks = [];
    if (!P.streaksOn) return;
    // deterministic: derive from a fixed sub-seed so replays match
    const srng = rngFactory((this.seed ^ 0x51AB) >>> 0);
    for (let i = 0; i < P.streakCount; i++) {
      this.streaks.push({
        // progress phase 0..1 along a wrap cycle; staggered start
        phase: srng(),
        band: srng(),                       // 0..1 inside the spawn band
        lenMul: 1 + (srng() * 2 - 1) * P.streakLenVar,
        alphaMul: 0.5 + srng() * 0.5,
        thickMul: 0.6 + srng() * 0.8,
      });
    }
  }
  drawStreaks() {
    const P = this.P, ctx = this.ctx;
    if (!P.streaksOn || !P.renderStreaks || !this.streaks.length) return;
    // follow-the-text (r2, per-unit instance config like streakOutAt): with
    // streakFollow set, the field is dark except during each event's window
    // and the whole group rides at that event's row. Computed once per frame;
    // nothing here runs for a unit without the key.
    let follow = null;
    if (this.streakFollow && this.streakFollow.length) {
      follow = this.streakFollowState();
      if (follow.mul <= 0.01) return;
    }
    const a = P.streakAngle * Math.PI / 180;
    const sign = P.streakSpeed >= 0 ? 1 : -1;
    const dirX = Math.cos(a) * sign, dirY = Math.sin(a) * sign;
    // The wipe exit (streakWipe 'left' | 'right' = the direction the erase edge
    // travels; client R2, ACR_320x50_B): over streakFadeDur from streakOutAt the
    // visible part of the field shrinks from one edge to the other in scene
    // space; once crossed nothing draws until the return, which stays the
    // fade it always was. Deterministic in simT, so a seek lands the same frame.
    let wipeP = null, wipeDir = this.streakWipe;
    if (this.streakWipe && this.streakOutAt != null) {
      const d = this.streakWipeDur || this.streakFadeDur || 0.6;
      const p = clamp((this.simT - this.streakOutAt) / d, 0, 1);
      const back = this.streakBackAt != null && this.simT >= this.streakBackAt;
      if (p >= 1 && !back) return;
      if (p > 0 && !back) wipeP = p;
    }
    // the second exit's erase (see streakExit2Mul) — final, no return after it
    if (this.streakWipe2 && this.streakOutAt2 != null && this.simT >= this.streakOutAt2) {
      const d2 = this.streakWipe2Dur || this.streakWipeDur || this.streakFadeDur || 0.6;
      const p2 = clamp((this.simT - this.streakOutAt2) / d2, 0, 1);
      if (p2 >= 1) return;
      if (p2 > 0) { wipeP = p2; wipeDir = this.streakWipe2; }
    }
    ctx.save();
    if (wipeP != null) {
      ctx.beginPath();
      if (wipeDir === 'right') ctx.rect(this.SW * wipeP, 0, this.SW * (1 - wipeP), this.SH);
      else ctx.rect(0, 0, this.SW * (1 - wipeP), this.SH);
      ctx.clip();
    }
    ctx.lineCap = 'round';
    // group transform: position and scale the whole field about its own
    // centre, so dialing scale never shoves a placed cluster around
    const bandMid = ((P.streakBandTop + P.streakBandBottom) / 2) * this.SH;
    const gs = P.streakScale || 1;
    ctx.translate(this.SW / 2 + (P.streakOffX || 0),
                  bandMid + (P.streakOffY || 0) + (follow ? follow.dy : 0));
    ctx.rotate((P.streakRotate || 0) * Math.PI / 180);
    ctx.scale(gs, gs);
    ctx.translate(-this.SW / 2, -bandMid);
    // group bend: one coherent arc across the WHOLE field — every point is
    // displaced perpendicular to the flow by a parabola of its position along
    // the flow axis, so neighbouring strokes curve together instead of each
    // bowing on its own. Applied in field space; the group transform above
    // then places/rotates/scales the bent result.
    const gb = P.streakGroupBend || 0;
    const fieldHalf = Math.max(this.SW, this.SH) * 0.5;
    const warp = gb ? (x, y) => {
      const rx = x - this.SW / 2, ry = y - bandMid;
      const along = (rx * dirX + ry * dirY) / fieldHalf;
      const d = gb * along * along;
      return [x - dirY * d, y + dirX * d];
    } : (x, y) => [x, y];
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      // THE PEN, not the wipe: nothing translates. The head draws the stroke
      // on over the first half of its cycle, the tail lifts it off over the
      // second — a line at 80 deg grows from its anchor to its full height,
      // then releases. Speed = cycle rate; its sign = draw direction.
      const cycle = Math.floor(s.phase);
      const p = s.phase - cycle;
      const head = Math.min(1, p * 2);
      const tail = Math.max(0, p * 2 - 1);
      if (head - tail < 0.02) continue;
      // a fresh, deterministic anchor every cycle — strokes draw on all over
      // the band instead of marching in file; same seed, same strokes.
      const rng = rngFactory((((i + 1) * 73856093) ^ ((cycle + 1) * 19349663) ^ this.seed) >>> 0);
      // perspective: lower in band = closer = longer/thicker
      const persp = 1 + P.streakPerspective * (s.band - 0.5) * 1.6;
      const len = P.streakLen * s.lenMul * persp;
      let ax = rng() * (this.SW + len) - len * 0.5;
      let ay = P.streakBandTop * this.SH +
        rng() * Math.max((P.streakBandBottom - P.streakBandTop), 0) * this.SH;
      // field squeeze: compress the anchor spread about the group pivot —
      // the cluster tightens, each stroke stays its own size. Guarded so
      // untouched takes take the identity path bit-for-bit.
      const fw = P.streakFieldW == null ? 1 : P.streakFieldW;
      // during a follow pulse the anchors cluster tight about the row the
      // group translate just moved them to (default squeeze 0.35)
      const fh = follow ? (this.streakFollowBandH != null ? this.streakFollowBandH : 0.35)
                        : (P.streakFieldH == null ? 1 : P.streakFieldH);
      if (fw !== 1) ax = this.SW / 2 + (ax - this.SW / 2) * fw;
      if (fh !== 1) ay = bandMid + (ay - bandMid) * fh;
      const bx = ax + dirX * len, by = ay + dirY * len;
      // bend: a quadratic arc — the control point pushed perpendicular off
      // the stroke's middle. The pen follows the curve, so the draw-on
      // animation is untouched; 0 = dead straight.
      const bend = (P.streakBend || 0) * s.lenMul * persp;
      const mx = (ax + bx) / 2 - dirY * bend;
      const my = (ay + by) / 2 + dirX * bend;
      const q = (t) => {
        const u = 1 - t;
        return [u * u * ax + 2 * u * t * mx + t * t * bx,
                u * u * ay + 2 * u * t * my + t * t * by];
      };
      const qw = (t) => { const p_ = q(t); return warp(p_[0], p_[1]); };
      const [tx, ty] = qw(tail), [hx, hy] = qw(head);
      ctx.globalAlpha = P.streakOpacity * s.alphaMul * this.sceneAlpha * this.streakVisMul();
      ctx.lineWidth = Math.max(P.streakThickness * s.thickMul * persp, 0.5);
      ctx.shadowColor = P.streakColor;
      ctx.shadowBlur = P.streakBlur;
      const grad = ctx.createLinearGradient(tx, ty, hx, hy);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, P.streakColor);
      grad.addColorStop(1, P.streakColor);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      const STEPS = 14;
      for (let k = 0; k <= STEPS; k++) {
        const pt = qw(tail + (head - tail) * (k / STEPS));
        if (k === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- scene rig — identical math to lab v5.3 ---------- */
  playScene() { this.sceneT = 0; this.scenePlaying = true; this.sceneDone = false; this.wakeFired = 0; }
  resetScene() { this.sceneT = 0; this.scenePlaying = false; this.sceneDone = false; this.wakeFired = 0; }
  /* Two-handle easing, the way every animation tool states it: how soft the
     start is, how soft the landing is. 0/0 is linear; raise "in" and the drive
     creeps away, raise "out" and it glides to a stop. Same cubic-bezier the
     element moves use, so the car and the passports share one vocabulary. */
  easeP(p) {
    const x1 = clamp01((this.P.sceneEaseIn || 0) / 100);
    const x2 = 1 - clamp01((this.P.sceneEaseOut || 0) / 100);
    if (x1 === 0 && x2 === 1) return p;            // linear, no solve needed
    return cubicBezierEase(x1, x2, p);
  }
  sceneTravelDir() { return this.P.sceneEndX >= this.P.sceneStartX ? 1 : -1; }
  wakeX(prog) {
    const P = this.P;
    const inset = P.maskOn ? this.maskInsetPx() : 0;
    const mw = this.W - 2 * inset;
    return this.sceneTravelDir() === 1 ? inset + prog * mw : inset + (1 - prog) * mw;
  }
  sceneGeom(img, mw, mh, zoom) {
    const P = this.P;
    let needW = mw, needH = mh;
    if (P.sceneSafeCover) {
      const rotMax = Math.max(Math.abs(P.sceneStartRot), Math.abs(P.sceneEndRot)) * Math.PI / 180;
      const c = Math.cos(rotMax), s = Math.sin(rotMax);
      const maxOffY = Math.max(Math.abs(P.sceneStartY), Math.abs(P.sceneEndY)) / 100;
      needW = mw * c + mh * s;
      needH = (mw * s + mh * c) * (1 + 2 * maxOffY);
    }
    const cover = Math.max(needW / img.naturalWidth, needH / img.naturalHeight) *
      (zoom != null ? zoom : P.sceneStartZoom);
    const slackX = Math.max((img.naturalWidth * cover) / 2 - mw / 2, 0);
    return { cover, slackX };
  }
  scenePos(v) { return this.P.sceneSafeCover ? clamp(v, -100, 100) : v; }
  /* scene-space geometry — what every scene pass measures itself against */
  get SX() { return this.sceneRect ? this.sceneRect.x : 0; }
  get SY() { return this.sceneRect ? this.sceneRect.y : 0; }
  get SW() { return this.sceneRect ? this.sceneRect.w : this.W; }
  get SH() { return this.sceneRect ? this.sceneRect.h : this.H; }
  setSceneRect(r) { this.sceneRect = (r && r.w > 0 && r.h > 0) ? r : null; }
  // the scene clip's corners: one radius, or four [tl, tr, br, bl] (a window
  // that bleeds off the ad keeps square corners on that edge); null = none
  sceneRadii() {
    const r = this.sceneRadius;
    if (Array.isArray(r)) return r.some(v => v > 0) ? r : null;
    return r > 0 ? r : null;
  }

  maskInsetPx() { return Math.min(this.P.maskInset, Math.min(this.SW, this.SH) / 2 - 2); }
  maskPath() {
    const P = this.P, ctx = this.ctx;
    const i = this.maskInsetPx();
    const r = Math.max(Math.min(P.maskRadius, (Math.min(this.SW, this.SH) - 2 * i) / 2), 0);
    ctx.beginPath();
    ctx.roundRect(i, i, this.SW - 2 * i, this.SH - 2 * i, r);
  }
  sceneProgress() {
    return this.sceneDone ? 1 : (this.scenePlaying ? Math.min(this.sceneT / this.P.sceneDur, 1) : 0);
  }
  drawScene() {
    const P = this.P, ctx = this.ctx;
    const img = this.sceneImg();
    if (!img) return;
    const e = this.easeP(this.sceneProgress());
    const inset = P.maskOn ? this.maskInsetPx() : 0;
    const mw = this.SW - 2 * inset, mh = this.SH - 2 * inset;
    const zoom = P.sceneStartZoom + (P.sceneEndZoom - P.sceneStartZoom) * e;
    const { cover, slackX } = this.sceneGeom(img, mw, mh, zoom);
    const scale = cover;
    // rotation + vertical position both animate start -> end with the drive
    const rot = ((P.sceneStartRot + (P.sceneEndRot - P.sceneStartRot) * e) * Math.PI) / 180;
    const p0 = this.scenePos(P.sceneStartX), p1 = this.scenePos(P.sceneEndX);
    const dx = ((p0 + (p1 - p0) * e) / 100) * slackX;
    const dy = ((P.sceneStartY + (P.sceneEndY - P.sceneStartY) * e) / 100) * mh;
    // remembered for the cutout pass — the car layer must transform 1:1
    this._lastXform = { inset, mw, mh, scale, rot, dx, dy,
                        nw: img.naturalWidth, nh: img.naturalHeight };
    ctx.save();
    ctx.globalAlpha = this.sceneAlpha * this.sceneFadeMul();
    if (P.maskOn) { this.maskPath(); ctx.clip(); }
    // safe-cover off → flag any un-covered card area with red hatching:
    // the designer's cue that the source image needs more bleed (lab-identical)
    if (!P.sceneSafeCover && P.showEmitter) {
      if (!this._clipWarn) {
        const pc = document.createElement('canvas');
        pc.width = pc.height = 12;
        const p = pc.getContext('2d');
        p.strokeStyle = '#d84a3a';
        p.lineWidth = 2.5;
        p.beginPath();
        p.moveTo(-3, 15); p.lineTo(15, -3);
        p.moveTo(-3, 3); p.lineTo(3, -3);
        p.moveTo(9, 15); p.lineTo(15, 9);
        p.stroke();
        this._clipWarn = ctx.createPattern(pc, 'repeat');
      }
      ctx.globalAlpha = 0.5 * this.sceneAlpha * this.sceneFadeMul();
      ctx.fillStyle = this._clipWarn;
      ctx.fillRect(inset, inset, mw, mh);
      ctx.globalAlpha = this.sceneAlpha;
    }
    ctx.translate(inset + mw / 2 + dx, inset + mh / 2 + dy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }

  /* ---------- simulation — identical physics to lab ---------- */
  step(dt) {
    const P = this.P;
    this.simT += dt;
    if (this.scenePlaying) {
      this.sceneT += dt;
      if (this.sceneT >= P.sceneDur) {
        if (P.sceneLoop) { this.sceneT = 0; this.wakeFired = 0; }
        else { this.scenePlaying = false; this.sceneDone = true; }
      }
      if (P.syncWake && P.scene !== 'none') {
        const due = Math.floor(this.easeP(Math.min(this.sceneT / P.sceneDur, 1)) * P.wakeBursts + 1e-6);
        while (this.wakeFired < due) {
          this.wakeFired++;
          this.burstAt(this.wakeX(this.wakeFired / P.wakeBursts), P.wakeY * this.H);
        }
      }
    }
    // streak phases advance with real speed so knob changes read live
    if (P.streaksOn) {
      const travel = this.W + P.streakLen * (1 + P.streakLenVar) * 2;
      const dphase = Math.abs(P.streakSpeed) / Math.max(travel, 1) * dt;
      for (const s of this.streaks) s.phase += dphase * (0.7 + s.band * 0.6);
    }
    const drag = Math.exp(-KICK_DRAG * dt);
    for (const leaf of this.leaves) {
      if (!leaf.active) {
        // a leaf waiting its turn at the emitter (spawnStagger): go when due,
        // unless the taper has closed the door
        if (leaf.wakeAt != null && this.simT >= leaf.wakeAt) {
          leaf.wakeAt = null;
          if (this.spawningStopped()) continue;
          const [ex, ey] = this.emitterPx();
          this.spawnKicked(leaf, ex, ey);
        } else continue;
      }
      const z = P.depth ? leaf.z : 1;
      leaf.swayPhase += P.swaySpeed * leaf.swayMul * Math.PI * 2 * dt * 0.5;
      leaf.flipPhase += (0.6 + P.flutter * 1.6) * leaf.flipMul * dt * Math.PI;
      leaf.kvx *= drag;
      leaf.kvy *= drag;
      leaf.x += (this.windAt(this.simT, leaf) * (0.45 + 0.55 * z) + leaf.kvx) * dt;
      const lift = 1 - 0.38 * P.flutter * Math.abs(Math.cos(leaf.swayPhase));
      const kickMag = Math.min(Math.hypot(leaf.kvx, leaf.kvy) / 120, 1);
      const fallMul = 1 - (1 - GRAVITY_BLEND) * kickMag;
      leaf.y += (P.fallSpeed * leaf.speedMul * (0.5 + 0.5 * z) * lift * fallMul
                 + P.windLift * (0.45 + 0.55 * z) + leaf.kvy) * dt;
      leaf.angle += (P.tumble * Math.PI / 180) * leaf.spinDir * leaf.spinMul * (1 + kickMag * 1.5) * dt;
      const m = 80;
      if (leaf.x < -m) leaf.x += this.W + m * 2;
      if (leaf.x > this.W + m) leaf.x -= this.W + m * 2;
      if (leaf.y > this.H + m) this.respawn(leaf);
      else if (leaf.y < -m * 1.5 && P.windLift < -5) {
        if (P.spawnMode === 'burst') leaf.active = false;
        else leaf.y = this.H + m - 1;
      }
    }
  }

  /* leaf clear deadline: 0..1 multiplier that rides the taper — by
     taperAt + leafClearS every leaf has faded to nothing */
  clearMul() {
    const P = this.P;
    if (P.leafLife === 'continuous' || this.taperAt == null || !P.leafClearS) return 1;
    return clamp(1 - (this.simT - this.taperAt) / P.leafClearS, 0, 1);
  }

  /* Streak visibility envelope (per-unit, instance config): down past
     streakOutAt to clear the dealer window, BACK past streakBackAt to ride
     the CTA in. With no envelope, streaks follow the scene fade — today's
     documented behavior — so every existing unit computes the same value. */
  /* Follow-the-text pulses (r2). Each event {at, y (0..1 of stage H), dur}
     ramps the field in over 0.15s, holds `dur`, releases over streakFadeDur.
     The strongest event of the moment also positions the group (see
     drawStreaks). Takes precedence over the out/back envelope AND the scene
     fade — the board rides lines with the copy after the scene has dimmed. */
  streakFollowState() {
    const fade = this.streakFadeDur || 0.6;
    let best = 0, y = null;
    for (const ev of this.streakFollow) {
      const t = this.simT - ev.at;
      const dur = ev.dur != null ? ev.dur : 0.9;
      let m = 0;
      if (t >= 0) m = t < 0.15 ? t / 0.15 : (t <= dur ? 1 : Math.max(0, 1 - (t - dur) / fade));
      if (m > best || (m === best && y == null)) { best = m; if (ev.y != null) y = ev.y; }
    }
    const P = this.P;
    const bandMid = ((P.streakBandTop + P.streakBandBottom) / 2) * this.SH;
    this._followMul = best;
    return { mul: best, dy: y == null ? 0 : y * this.SH - bandMid };
  }
  // The second exit (r2, ACR B smalls): past streakOutAt2 the lines leave for
  // good — as an erase wipe (streakWipe2 'left'|'right', streakWipe2Dur,
  // streakWipe2Fade, same meanings as the first exit's keys) or a plain fade
  // over streakFadeDur. Multiplies whatever envelope is running (out/back OR
  // follow), so the returned field and the follow pulses both end on it.
  streakExit2Mul() {
    if (this.streakOutAt2 == null || this.simT < this.streakOutAt2) return 1;
    const d = this.streakWipe2Dur || this.streakWipeDur || this.streakFadeDur || 0.6;
    const t = (this.simT - this.streakOutAt2) / d;
    if (this.streakWipe2) return this.streakWipe2Fade ? clamp(1 - t, 0, 1) : (t < 1 ? 1 : 0);
    return clamp(1 - t, 0, 1);
  }
  streakVisMul() { return this.streakVisMulBase() * this.streakExit2Mul(); }
  streakVisMulBase() {
    if (this.streakFollow && this.streakFollow.length)
      return this._followMul == null ? 1 : this._followMul;
    if (this.streakOutAt == null) return this.sceneFadeMul();
    const d = this.streakFadeDur || 0.6;
    // streakWipe (per-unit instance key, like streakOutAt): the exit is an
    // ERASE travelling across the field (see drawStreaks), not an alpha ramp —
    // full strength until the wipe has crossed, then nothing until the return
    // streakWipeDur: the wipe's own length (the return keeps streakFadeDur);
    // streakWipeFade: opacity ramps down over the wipe as well as being erased
    const wd = this.streakWipeDur || d;
    const out = this.streakWipe
      ? (this.streakWipeFade ? clamp(1 - (this.simT - this.streakOutAt) / wd, 0, 1)
                             : (this.simT < this.streakOutAt + wd ? 1 : 0))
      : clamp(1 - (this.simT - this.streakOutAt) / d, 0, 1);
    if (this.streakBackAt == null) return out;
    const back = clamp((this.simT - this.streakBackAt) / d, 0, 1)
      * (this.streakBackAlpha == null ? 1 : this.streakBackAlpha);
    return Math.max(out, back);
  }

  /* Scene fade (per-unit, instance config like taperAt): past sceneFadeAt
     the vehicle, streaks and cutout ramp to nothing over sceneFadeDur while
     the leaves live on — the smalls' frame change, where there is no canvas
     swap to hide behind. null = no effect, every existing unit unchanged. */
  sceneFadeMul() {
    if (this.sceneFadeAt == null) return 1;
    const d = this.sceneFadeDur || 0.6;
    return clamp(1 - (this.simT - this.sceneFadeAt) / d, 0, 1);
  }

  /* clearMul's mirror at the ad's other end: 0..1 multiplier that fades the
     whole flurry up from nothing over the first leafFadeIn seconds. Rides simT,
     so a deterministic re-run from zero (builder scrub, __adSeek) lands on the
     same alpha every time. */
  introMul() {
    const P = this.P;
    if (!P.leafFadeIn) return 1;
    return clamp(this.simT / P.leafFadeIn, 0, 1);
  }

  /* ---------- leaf drawing: procedural (lab-identical) or sprite ---------- */
  drawLeaves() {
    const P = this.P, ctx = this.ctx;
    if (!P.renderLeaves) return;
    const cm = this.clearMul() * this.introMul();
    if (cm <= 0) return;
    const sorted = P.depth ? [...this.leaves].sort((a, b) => a.z - b.z) : this.leaves;
    const sprites = P.leafStyle === 'sprite' ? this.spriteImages() : null;
    for (const leaf of sorted) {
      if (!leaf.active) continue;
      const z = P.depth ? leaf.z : 1;
      const swayX = Math.sin(leaf.swayPhase) * P.swayAmp * leaf.swayMul;
      const rock = Math.sin(leaf.swayPhase) * 0.5 * P.flutter;
      const flip = 1 - P.flutter * 0.85 * Math.abs(Math.sin(leaf.flipPhase));
      const alpha = P.opacity * leaf.alphaMul * (P.depth ? 0.45 + 0.55 * z : 1) * cm;

      if (sprites && sprites.length) {
        const im = sprites[leaf.spriteIdx % sprites.length];
        const h = P.spriteBaseSize * P.sizeScale * leaf.sizeMul * (0.55 + 0.45 * z);
        const w = h * (im.naturalWidth / im.naturalHeight);
        ctx.save();
        ctx.translate(leaf.x + swayX, leaf.y);
        ctx.rotate(leaf.angle + rock);
        ctx.scale(1, Math.max(flip, 0.12));
        // back side of the flip reads darker, like the procedural leaves
        ctx.globalAlpha = alpha * (0.62 + 0.38 * flip);
        ctx.drawImage(im, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        const shape = LEAF_SHAPES[leaf.type];
        const size = shape.base * P.sizeScale * leaf.sizeMul * (0.55 + 0.45 * z);
        const s = size / 100;
        const [h, sat, li] = leaf.color;
        const light = li * (0.62 + 0.38 * flip);
        ctx.save();
        ctx.translate(leaf.x + swayX, leaf.y);
        ctx.rotate(leaf.angle + rock);
        ctx.scale(s, s * Math.max(flip, 0.12));
        ctx.translate(-50, -50);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsl(${h} ${sat}% ${light}%)`;
        ctx.fill(shape.path);
        ctx.strokeStyle = `hsl(${h} ${Math.min(sat + 5, 100)}% ${Math.max(light - 14, 8)}%)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(shape.stem[0][0], shape.stem[0][1]);
        ctx.lineTo(shape.stem[1][0], shape.stem[1][1]);
        ctx.moveTo(50, 10);
        ctx.lineTo(shape.stem[0][0], shape.stem[0][1]);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* car cutout re-drawn OVER the streaks with the exact scene transform, so
     speed lines read as passing BEHIND the car. Takes an optional context so
     the same draw can land on a mirror canvas (the ads' car-over-leaves
     layer) — same transform, same frame. */
  drawCutout(tctx) {
    const ctx = tctx || this.ctx, im = this.cutoutImg, x = this._lastXform;
    if (!im || !im.complete || !im.naturalWidth || !x) return;
    ctx.save();
    ctx.globalAlpha = this.sceneAlpha * this.sceneFadeMul();      // the car leaves with the scene
    // maskPath paths into the MAIN context — a mirror canvas clips via its
    // own element (CSS radius), never here
    if (!tctx && this.P.maskOn) { this.maskPath(); ctx.clip(); }
    ctx.translate(x.inset + x.mw / 2 + x.dx, x.inset + x.mh / 2 + x.dy);
    ctx.rotate(x.rot);
    ctx.scale(x.scale, x.scale);
    ctx.drawImage(im, -x.nw / 2, -x.nh / 2, x.nw, x.nh);
    ctx.restore();
  }

  draw() {
    const P = this.P, ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    // scene / streaks / cutout render inside the scene viewport (the ad's photo
    // window); leaves always render across the whole canvas — the same split
    // the ads get from their two separate canvases.
    ctx.save();
    if (this.sceneRect) {
      ctx.translate(this.SX, this.SY);
      ctx.beginPath();
      if (this.sceneRadii() && ctx.roundRect) ctx.roundRect(0, 0, this.SW, this.SH, this.sceneRadii());
      else ctx.rect(0, 0, this.SW, this.SH);
      ctx.clip();
    }
    // The Builder's slide preview (slideOutLeft/slideUp): translate the scene
    // INSIDE its window clip AND clip to the moving window-sized box. The ad
    // slides a CANVAS, whose pixels end at the window edge — without the second
    // clip, the plate's off-window slack slid INTO view (a phantom strip of
    // street that never cleared the frame). The fixed viewport clip above
    // intersects with this moving box exactly like the ad's overflow-hidden
    // host intersects its sliding canvas. Unset in the ads (inert).
    const sox = this.sceneOffX || 0, soy = this.sceneOffY || 0;
    if (sox || soy) {
      const ew = this.sceneRect ? this.SW : this.W;
      const eh = this.sceneRect ? this.SH : this.H;
      ctx.translate(sox, soy);
      ctx.beginPath();
      if (this.sceneRadii() && ctx.roundRect) ctx.roundRect(0, 0, ew, eh, this.sceneRadii());
      else ctx.rect(0, 0, ew, eh);
      ctx.clip();
    }
    this.drawScene();
    this.drawStreaks();
    // car-over-leaves (opt-in, per unit): the Builder's single canvas gets it
    // by deferring the cutout until after the leaves; the ads keep this pass
    // AND repeat the cutout on a dedicated mirror canvas above the leaf layer.
    if (!this.cutoutOverLeaves) this.drawCutout();
    // trailing-edge ramp while sliding (ad-player's soft mask; 0 = hard edge).
    // Coordinates are post-translate, so the ramp rides the content's edge.
    if ((sox || soy) && this.sceneSoft > 0) {
      const soft = this.sceneSoft;
      const ew = this.sceneRect ? this.SW : this.W;
      const eh = this.sceneRect ? this.SH : this.H;
      const g = this.sceneSlideAxis === 'y'
        ? ctx.createLinearGradient(0, eh - soft, 0, eh)
        : ctx.createLinearGradient(ew - soft, 0, ew, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g;
      if (this.sceneSlideAxis === 'y') ctx.fillRect(0, eh - soft, ew, soft);
      else ctx.fillRect(ew - soft, 0, soft, eh);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // leaves go to the separate leaf canvas when the host gave us one (the
    // Builder stage), else onto this canvas after the scene like before
    const lctx = this.leafCtx || null;
    if (lctx) { lctx.clearRect(0, 0, this.W, this.H); this.ctx = lctx; }
    const lc = this.ctx;
    if (P.maskOn && P.maskClipLeaves) {
      lc.save();
      lc.translate(this.SX, this.SY);
      this.maskPath();
      lc.clip();
      lc.translate(-this.SX, -this.SY);
      this.drawLeaves();
      lc.restore();
    } else this.drawLeaves();
    // the deferred cutout pass (Builder car-over-leaves): same viewport
    // transform as the top pass, drawn after the leaves — on the leaf canvas
    // when there is one, which is where the ads' carcut (z19) sits too
    if (this.cutoutOverLeaves) {
      lc.save();
      if (this.sceneRect) {
        lc.translate(this.SX, this.SY);
        lc.beginPath();
        if (this.sceneRadii() && lc.roundRect) lc.roundRect(0, 0, this.SW, this.SH, this.sceneRadii());
        else lc.rect(0, 0, this.SW, this.SH);
        lc.clip();
      }
      if (this.sceneOffX || this.sceneOffY) {
        const mew = this.sceneRect ? this.SW : this.W;
        const meh = this.sceneRect ? this.SH : this.H;
        lc.translate(this.sceneOffX || 0, this.sceneOffY || 0);
        lc.beginPath();
        if (this.sceneRadii() && lc.roundRect) lc.roundRect(0, 0, mew, meh, this.sceneRadii());
        else lc.rect(0, 0, mew, meh);
        lc.clip();
      }
      this.drawCutout(lctx || undefined);
      lc.restore();
    }
    if (lctx) this.ctx = ctx;
    // the ads' car-over-leaves layer: the same cutout, same frame, mirrored
    // onto a dedicated canvas that sits ABOVE the leaf overlay (z-order does
    // the rest). Cleared every frame; inert when no mirror is attached.
    if (this.cutoutMirror) {
      const m = this.cutoutMirror.getContext('2d');
      m.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      m.clearRect(0, 0, this.W, this.H);
      this.drawCutout(m);
    }
  }

  /* ---------- recording replay — event semantics identical to lab ---------- */
  loadRecording(rec) { this._recording = rec ? JSON.parse(JSON.stringify(rec)) : null; }
  get recording() { return this._recording; }
  applyEvent(ev) {
    if (ev.type === 'wind') {
      this.P.windSpeed = ev.s; this.P.windLift = ev.l;
      if (this.onParam) { this.onParam('windSpeed', ev.s); this.onParam('windLift', ev.l); }
    } else if (ev.type === 'burst') {
      this.burstAt(ev.x * this.W, ev.y * this.H);
    } else if (ev.type === 'emitter') {
      this.P.emitterX = ev.x; this.P.emitterY = ev.y;
    } else if (ev.type === 'sceneplay') {
      this.playScene();
    } else if (ev.type === 'param') {
      this.set(ev.key, ev.key === 'types' ? [...ev.value] : ev.value);
    }
  }
  startReplay() {
    const rec = this._recording;
    if (!rec) return false;
    this.P = Object.assign({}, DEFAULTS, migrateParams(JSON.parse(JSON.stringify(rec.startState))));
    if (this.paramLock) Object.assign(this.P, this.paramLock);
    this.setSeed(rec.seed);
    this.setStage(this.P.stage);
    this.resetScene();
    this.simT = 0; this.playT = 0; this.playIdx = 0;
    this.recState = 'play';
    return true;
  }
  stopReplay() { this.recState = null; }

  /* ---------- host loop ---------- */
  tick(now) {
    if (this.lastFrame == null) this.lastFrame = now;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    if (this.paused) return dt;
    if (this.recState === 'play' && this._recording) {
      this.playT += dt;
      const evs = this._recording.events;
      while (this.playIdx < evs.length && evs[this.playIdx].t <= this.playT) {
        this.applyEvent(evs[this.playIdx++]);
      }
      if (this.playT >= this._recording.duration) {
        this.recState = null;
        if (this.onReplayEnd) this.onReplayEnd();  // host decides: loop, stop, or freeze
      }
    }
    this.step(dt);
    this.draw();
    this.fpsSmooth = this.fpsSmooth * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    return dt;
  }

  get activeCount() { return this.leaves.reduce((n, l) => n + (l.active ? 1 : 0), 0); }
}

FallEngine.DEFAULTS = DEFAULTS;
FallEngine.STAGES = STAGES;
FallEngine.PALETTES = PALETTES;
FallEngine.LEAF_SHAPES = LEAF_SHAPES;
FallEngine.SPRITE_SETS = SPRITE_SETS;
FallEngine.rngFactory = rngFactory;
FallEngine.migrateParams = migrateParams;

global.FallEngine = FallEngine;
})(typeof window !== 'undefined' ? window : this);
