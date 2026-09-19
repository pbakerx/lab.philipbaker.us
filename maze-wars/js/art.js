/* The cast. Every character is DRAWN BY CODE, fresh, at each of the eight corridor depths —
   the 1986 artists redrew each size by hand rather than shrinking the big one, and a one-bit
   picture only survives scaling if you do the same: outlines stay one pixel, fills re-dither.
   Design units are pixels at depth 1 (the cell in front of you); each depth is 1/sqrt(2) smaller.
   Nothing here is lifted from the original's bitmaps: same subjects, same idiom, new drawings. */
window.MW = window.MW || {};
(function () {
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  class Bmp {
    constructor(w, h, s) { this.w = w; this.h = h; this.s = s || 1; this.px = new Uint8Array(w * h); this.mk = new Uint8Array(w * h); }
    X(v) { return Math.round(v * this.s); }
    set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = y * this.w + x; this.px[i] = c; this.mk[i] = 1; }
    clear(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = y * this.w + x; this.px[i] = 0; this.mk[i] = 0; }
    ink(x, y, f) { // f: grey level 0..1, or fn(x,y) in DESIGN units -> level
      const lv = typeof f === 'function' ? f(x / this.s, y / this.s) : f;
      this.set(x, y, lv * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5 ? 1 : 0);
    }
    span(y, x0, x1, f) { for (let x = x0; x <= x1; x++) this.ink(x, y, f); }
    // --- pixel-space primitives -------------------------------------------------------------
    pline(x0, y0, x1, y1, c) {
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    ppoly(pts, f, c) {
      if (f !== null && f !== undefined) {
        let ymin = 1e9, ymax = -1e9; for (const q of pts) { ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
        for (let y = ymin; y <= ymax; y++) {
          const xs = [], yc = y + 0.01;
          for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
          xs.sort((u, v) => u - v);
          for (let i = 0; i + 1 < xs.length; i += 2) this.span(y, Math.round(xs[i]), Math.round(xs[i + 1]), f);
        }
      }
      if (c !== null && c !== undefined) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.pline(a[0], a[1], b[0], b[1], c); }
    }
    pell(cx, cy, rx, ry, f, c) {
      if (rx < 1 && ry < 1) { if (f !== null && f !== undefined) this.ink(cx, cy, f); if (c !== null && c !== undefined) this.set(cx, cy, c); return; }
      const hw = (j) => { const t = 1 - (j * j) / ((ry + 0.5) * (ry + 0.5)); return t < 0 ? -1 : Math.round((rx + 0.5) * Math.sqrt(t) - 0.5); };
      if (f !== null && f !== undefined) for (let j = -ry; j <= ry; j++) { const w = hw(j); if (w >= 0) this.span(cy + j, cx - w, cx + w, f); }
      if (c !== null && c !== undefined) { let prev = -1;
        for (let j = -ry; j <= ry; j++) { const w = hw(j); if (w < 0) continue;
          if (prev < 0 || j === ry) { for (let x = cx - w; x <= cx + w; x++) this.set(x, cy + j, c); }
          else { const a = Math.min(prev, w), b = Math.max(prev, w), yy = cy + (w > prev ? j : j - 1); if (b - a > 1) for (let x = a; x <= b; x++) { this.set(cx - x, yy, c); this.set(cx + x, yy, c); } this.set(cx - w, cy + j, c); this.set(cx + w, cy + j, c); }
          prev = w; } }
    }
    // --- design-space primitives (scaled by this.s) ------------------------------------------
    R(x0, y0, x1, y1, f, c) { const a = this.X(x0), b = this.X(y0), p = Math.max(a, this.X(x1) - 1), q = Math.max(b, this.X(y1) - 1);
      if (f !== null && f !== undefined) for (let y = b; y <= q; y++) this.span(y, a, p, f);
      if (c !== null && c !== undefined) { for (let x = a; x <= p; x++) { this.set(x, b, c); this.set(x, q, c); } for (let y = b; y <= q; y++) { this.set(a, y, c); this.set(p, y, c); } } }
    E(cx, cy, rx, ry, f, c) { this.pell(this.X(cx), this.X(cy), Math.max(0, this.X(rx)), Math.max(0, this.X(ry)), f, c); }
    Pg(pts, f, c) { this.ppoly(pts.map(p => [this.X(p[0]), this.X(p[1])]), f, c); }
    L(x0, y0, x1, y1, c) { this.pline(this.X(x0), this.X(y0), this.X(x1), this.X(y1), c === undefined ? 1 : c); }
    PL(pts, c) { for (let i = 0; i + 1 < pts.length; i++) this.L(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c); }
    // horizontal ribs (accordion arms, neck rings): alternating black / white bands
    ribsH(x0, y0, x1, y1, n) { this.R(x0, y0, x1, y1, 0, 1); for (let i = 1; i < n; i++) { const y = y0 + (y1 - y0) * i / n; this.L(x0, y, x1 - 1 / this.s, y, 1); } }
    ribsV(x0, y0, x1, y1, n) { this.R(x0, y0, x1, y1, 0, 1); for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n; this.L(x, y0, x, y1 - 1 / this.s, 1); } }
    // lettering only where it can be read; below that a suggestion of it
    label(font, str, xMid, yBase, c, minS) {
      if (this.s >= (minS || 0.95)) { const G = MW.gfx; let x = this.X(xMid) - Math.round(G.textW(font, str) / 2); const top = this.X(yBase) - 8;
        for (const ch of str) { const g = font.g[ch] || font.g['?']; for (let j = 0; j < g.rows.length; j++) for (let i = 0; i < g.rows[j].length; i++) if (g.rows[j][i]) this.set(x + i, top + g.top + j, c); x += g.w + font.sp; } return true; }
      return false;
    }
    flip() { const o = new Bmp(this.w, this.h, this.s); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const i = y * this.w + x, k = y * this.w + (this.w - 1 - x); o.px[k] = this.px[i]; o.mk[k] = this.mk[i]; } return o; }
    trim() { let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.mk[y * this.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }
  }
  MW.Bmp = Bmp;

  const sphere = (cx, cy, r, lo, hi) => (x, y) => { const d = Math.hypot(x - (cx - r * 0.35), y - (cy - r * 0.4)) / (r * 1.45); return Math.min(hi, Math.max(lo, lo + (hi - lo) * d * d * 1.6)); };
  const make = (W0, H0, s) => new Bmp(Math.max(2, Math.ceil(W0 * s) + 1), Math.max(2, Math.ceil(H0 * s) + 1), s);
  const shadow = (b, cx, cy, rx, ry) => b.E(cx, cy, rx, ry, 0.5, null);

  // ===== EYEBALL ==========================================================================
  function eyeball(view, s) {
    const b = make(150, 164, s), cx = 75, cy = 72, r = 70;
    shadow(b, cx, 152, 60, 9);
    b.E(cx, cy, r, r, 1, 1);
    if (view === 0) { // looking at you
      const lens = []; for (let i = 0; i <= 16; i++) { const t = -1 + i / 8; lens.push([cx + t * 60, cy - 23 * Math.pow(1 - t * t, 0.75)]); }
      for (let i = 16; i >= 0; i--) { const t = -1 + i / 8; lens.push([cx + t * 60, cy + 21 * Math.pow(1 - t * t, 0.75)]); }
      b.Pg(lens, 0, null);
      b.E(cx, cy - 1, 21, 21, (x, y) => 0.25 + 0.5 * Math.hypot(x - cx, y - cy) / 21, 1);
      b.E(cx, cy - 1, 10, 10, 1, null); b.E(cx - 5, cy - 7, 3, 3, 0, null);
      if (s > 0.4) { b.PL([[cx - 50, cy - 8], [cx - 34, cy - 17]], 1); b.PL([[cx + 50, cy - 8], [cx + 34, cy - 17]], 1); }
    } else if (view === 2) { // from behind: the optic nerve, trailing
      b.PL([[cx - 8, cy + 4], [cx + 2, cy - 6], [cx + 16, cy - 6], [cx + 22, cy + 4], [cx + 14, cy + 14], [cx - 2, cy + 16], [cx - 20, cy + 22], [cx - 34, cy + 20]], 0);
      b.PL([[cx - 34, cy + 20], [cx - 28, cy + 12]], 0); b.PL([[cx - 34, cy + 20], [cx - 25, cy + 26]], 0);
    } else { // in profile, looking right
      const w = []; for (let i = 0; i <= 10; i++) { const a = -0.36 + 0.72 * i / 10; w.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.0]); }
      w.push([cx + 8, cy]);
      b.Pg(w, 0, null);
      b.E(cx + r - 9, cy, 8, 17, 0.6, 1); b.E(cx + r - 5, cy, 4, 9, 1, null);
      if (s > 0.4) b.PL([[cx + 8, cy], [cx + 40, cy - 12]], 1);
      b.E(cx, cy, r, r, null, 1);
    }
    return view === 3 ? b.flip() : b;
  }

  // ===== ARCADE CABINET ===================================================================
  function arcade(view, s) {
    const b = make(104, 174, s);
    if (view === 0) {
      b.R(6, 0, 98, 166, 0.5, 1); b.Pg([[6, 0], [12, -0], [92, 0], [98, 6], [98, 30], [6, 30]], 0, 1);
      b.R(10, 4, 94, 27, 1, 1); if (!b.label(MW.FONT.gen, 'MAZE WARS', 52, 20, 0, 0.95)) b.R(20, 12, 84, 18, 0, null);
      b.R(12, 34, 92, 94, 0.75, 1); b.R(22, 40, 82, 88, 0, 1);
      b.PL([[22, 40], [42, 56], [62, 56], [82, 40]], 1); b.PL([[22, 88], [42, 72], [62, 72], [82, 88]], 1); b.R(42, 56, 62, 72, 0.25, 1);
      b.Pg([[6, 96], [98, 96], [102, 112], [2, 112]], 0, 1); b.E(34, 101, 4, 4, 1, 1); b.L(34, 101, 34, 108, 1); b.E(62, 104, 3, 3, 0, 1); b.E(74, 104, 3, 3, 0, 1);
      b.R(8, 112, 96, 160, 0.5, 1); b.R(24, 120, 46, 142, 0, 1); b.R(58, 120, 80, 142, 0, 1); b.R(30, 128, 40, 132, 1, null); b.R(64, 128, 74, 132, 1, null);
      b.R(8, 160, 96, 168, 1, 1); b.E(14, 170, 4, 3, 1, 1); b.E(90, 170, 4, 3, 1, 1);
    } else if (view === 2) {
      b.R(6, 0, 98, 166, 0, 1); b.R(6, 0, 98, 12, 0.5, 1); b.R(12, 18, 92, 150, 0, 1);
      for (let i = 0; i < 6; i++) b.L(30, 28 + i * 5, 74, 28 + i * 5, 1);
      b.R(34, 70, 70, 96, 0, 1); if (s > 0.6) { b.L(38, 78, 66, 78, 1); b.L(38, 84, 60, 84, 1); b.L(38, 90, 64, 90, 1); }
      b.E(52, 124, 5, 5, 1, 1); b.PL([[52, 129], [52, 150], [40, 160], [30, 172]], 1);
      b.R(6, 160, 98, 168, 1, 1); b.E(14, 170, 4, 3, 1, 1); b.E(90, 170, 4, 3, 1, 1);
    } else {
      const prof = [[34, 0], [92, 0], [92, 166], [18, 166], [18, 112], [6, 100], [20, 94], [36, 36], [24, 28]];
      b.Pg(prof, 1, 1);
      for (let i = 0; i < 9; i++) { const o = 100 + i * 9; b.PL([[22, o + 40], [88, o - 30]].map(p => [p[0], Math.min(162, Math.max(40, p[1]))]), 0); }
      b.Pg([[40, 8], [86, 8], [86, 52], [46, 52], [38, 40]], 1, 0);
      b.R(18, 160, 92, 168, 1, 0); b.E(24, 170, 4, 3, 1, 1); b.E(86, 170, 4, 3, 1, 1);
      b.Pg(prof, null, 1);
      const out = view === 3 ? b.flip() : b, mid = view === 3 ? 104 - 64 : 64;   // lettering goes on after the mirror
      if (!out.label(MW.FONT.chi, 'MAZE', mid, 27, 0, 0.95)) { out.R(mid - 16, 18, mid + 16, 24, 0, null); out.R(mid - 16, 34, mid + 16, 40, 0, null); } else out.label(MW.FONT.chi, 'WARS', mid, 45, 0, 0.95);
      return out;
    }
    return b;
  }

  // ===== THE MAC ==========================================================================
  function mac(view, s) {
    const b = make(158, 152, s);
    if (view === 0) {
      b.R(26, 0, 126, 118, 0, 1); b.R(30, 4, 122, 114, null, 1);
      b.R(38, 12, 114, 70, 1, 1); b.R(43, 17, 109, 65, 0, null);
      b.PL([[43, 17], [64, 33], [88, 33], [109, 17]], 1); b.PL([[43, 65], [64, 49], [88, 49], [109, 65]], 1); b.R(64, 33, 88, 49, 0.25, 1);
      b.R(40, 90, 47, 97, 1, null); b.R(80, 93, 114, 97, 1, null); b.R(92, 89, 100, 93, 1, null);
      b.R(30, 118, 122, 126, 0, 1);
      b.Pg([[10, 130], [116, 130], [122, 148], [4, 148]], 0, 1);
      if (s > 0.35) { for (let i = 1; i < 4; i++) b.L(8, 130 + i * 4.5, 119, 130 + i * 4.5, 1); for (let i = 1; i < 14; i++) b.L(10 + i * 7.6, 132, 8 + i * 8, 146, 1); }
      b.R(130, 134, 148, 150, 0, 1); b.L(130, 140, 147, 140, 1); b.PL([[139, 134], [139, 126], [124, 122]], 1);
    } else if (view === 2) {
      b.R(26, 0, 126, 118, 0, 1); b.R(44, 4, 108, 16, 1, 1);
      for (let i = 0; i < 5; i++) b.L(36, 24 + i * 4, 116, 24 + i * 4, 1);
      b.R(84, 50, 116, 84, 0, 1); if (s > 0.6) for (let i = 0; i < 5; i++) b.L(88, 56 + i * 5, 112, 56 + i * 5, 1);
      b.R(34, 50, 44, 84, 1, null);
      for (let i = 0; i < 5; i++) b.R(36 + i * 17, 98, 48 + i * 17, 106, 0, 1);
      b.R(30, 118, 122, 126, 0, 1);
      b.PL([[42, 106], [42, 136], [20, 144], [4, 140]], 1); b.R(0, 130, 22, 148, 0, 1); b.PL([[110, 106], [110, 132], [140, 146]], 1);
    } else {
      b.Pg([[52, 0], [130, 0], [134, 118], [40, 118], [44, 10]], 0, 1);
      b.PL([[52, 0], [56, 118]], 1);
      for (let i = 0; i < 5; i++) b.L(84, 96 + i * 4, 128, 96 + i * 4, 1);
      b.R(38, 118, 136, 126, 0, 1);
      b.Pg([[2, 140], [40, 126], [48, 132], [48, 148], [2, 150]], 0, 1); if (s > 0.35) for (let i = 1; i < 5; i++) b.L(2 + i * 8, 140 - i * 2.8, 6 + i * 8, 149, 1);
      b.PL([[48, 140], [58, 136], [60, 120]], 1); b.PL([[134, 110], [148, 124], [156, 150]], 1);
    }
    return view === 3 ? b.flip() : b;
  }

  // ===== THE BOOT =========================================================================
  function boot(view, s) {
    const stitch = (b, pts) => { if (s > 0.3) b.PL(pts, 0); };
    if (view === 1 || view === 3) {
      const b = make(148, 172, s);
      const shaft = [[30, 8], [44, 0], [58, 10], [74, 0], [88, 8], [86, 60], [90, 104], [60, 112], [28, 108], [32, 60]];
      b.Pg([[28, 104], [90, 100], [118, 118], [140, 138], [146, 152], [140, 158], [30, 158]], 0.5, 1);
      b.Pg(shaft, 1, 1);
      stitch(b, [[40, 14], [46, 40], [38, 70], [46, 98]]); stitch(b, [[58, 16], [54, 44], [62, 72], [56, 100]]); stitch(b, [[78, 14], [72, 40], [80, 70], [74, 98]]);
      b.L(30, 158, 146, 158, 1); b.R(28, 158, 146, 163, 1, null); b.R(28, 150, 56, 170, 1, 1);
      if (s > 0.5) b.PL([[96, 112], [112, 126], [104, 134], [122, 140]], 1);
      return view === 3 ? b.flip() : b;
    }
    const b = make(80, 172, s);
    b.Pg([[10, 8], [26, 0], [40, 14], [54, 0], [70, 8], [66, 60], [62, 112], [18, 112], [14, 60]], 1, 1);
    stitch(b, [[24, 12], [40, 44], [56, 12]]); stitch(b, [[22, 44], [40, 78], [58, 44]]); stitch(b, [[40, 20], [40, 104]]);
    if (view === 0) { b.Pg([[18, 110], [62, 110], [72, 140], [66, 162], [40, 170], [14, 162], [8, 140]], 0.5, 1); if (s > 0.4) b.PL([[22, 136], [40, 146], [58, 136]], 1); }
    else { b.Pg([[18, 110], [62, 110], [66, 150], [14, 150]], 0.5, 1); b.R(16, 146, 64, 170, 1, 1); }
    return b;
  }

  // ===== THE TAXI =========================================================================
  function taxi(view, s) {
    const b = make(166, 146, s);
    shadow(b, 83, 136, 80, 8);
    if (view === 0 || view === 2) {
      b.R(22, 118, 48, 140, 1, 1); b.R(118, 118, 144, 140, 1, 1);
      b.E(83, 94, 79, 38, 0, 1);
      b.E(24, 96, 22, 30, 0.25, 1); b.E(142, 96, 22, 30, 0.25, 1);
      b.E(83, 50, 50, 38, 0, 1);
      b.R(64, 2, 102, 16, 0, 1); if (!b.label(MW.FONT.gen, 'TAXI', 83, 13, 1, 0.95)) b.R(70, 7, 96, 11, 1, null);
      if (view === 0) {
        b.Pg([[44, 56], [50, 28], [116, 28], [122, 56]], 0.75, 1); b.PL([[60, 50], [72, 34]], 0); b.PL([[68, 50], [78, 36]], 0);
        b.E(26, 92, 12, 12, 0, 1); b.E(26, 92, 6, 6, 0.5, 1); b.E(140, 92, 12, 12, 0, 1); b.E(140, 92, 6, 6, 0.5, 1);
        b.R(58, 84, 108, 112, 0, 1); for (let i = 1; i < 8; i++) b.L(58 + i * 6.25, 84, 58 + i * 6.25, 111, 1);
        b.Pg([[78, 72], [88, 72], [83, 64]], 1, 1);
      } else {
        b.Pg([[52, 54], [58, 30], [108, 30], [114, 54]], 0.75, 1);
        b.PL([[40, 72], [126, 72]], 1);
        b.R(16, 84, 34, 96, 1, 1); b.R(132, 84, 150, 96, 1, 1);
        b.R(62, 92, 104, 110, 0, 1); b.label(MW.FONT.gen, 'MW 86', 83, 105, 1, 0.95);
      }
      b.R(10, 114, 156, 126, 0, 1); b.L(10, 120, 155, 120, 1);
      return b;
    }
    b.E(40, 116, 18, 18, 1, 1); b.E(126, 116, 18, 18, 1, 1);
    b.Pg([[6, 112], [4, 84], [20, 70], [50, 64], [62, 28], [112, 28], [126, 64], [150, 72], [162, 90], [160, 112]], 0, 1);
    b.E(40, 116, 17, 17, 1, 0); b.E(40, 116, 7, 7, 0, 1); b.E(126, 116, 17, 17, 1, 0); b.E(126, 116, 7, 7, 0, 1);
    b.Pg([[58, 62], [66, 34], [86, 34], [86, 62]], 0.75, 1); b.Pg([[92, 62], [92, 34], [108, 34], [118, 62]], 0.75, 1);
    for (let i = 0; i < 17; i++) b.R(14 + i * 8, 78 + (i & 1) * 5, 22 + i * 8, 83 + (i & 1) * 5, 1, null);
    b.R(78, 16, 98, 28, 0, 1); b.E(156, 88, 5, 7, 0, 1); b.R(0, 100, 8, 108, 0, 1); b.R(158, 100, 166, 108, 0, 1);
    return view === 3 ? b.flip() : b;
  }

  // ===== THE DOME ROBOT (friendly, which is how it gets close) =============================
  function domeBot(view, s) {
    const b = make(146, 164, s), cx = 73;
    const side = (view === 1 || view === 3);
    const base = () => { b.Pg(side ? [[36, 140], [96, 140], [122, 160], [30, 160]] : [[40, 140], [106, 140], [114, 160], [32, 160]], 0.75, 1); b.R(side ? 28 : 30, 158, side ? 124 : 116, 163, 1, 1); };
    base();
    b.ribsH(cx - 22, 120, cx + 22, 134, 3); b.R(cx - 32, 134, cx + 32, 140, 0, 1);
    if (!side) { b.ribsV(8, 76, 34, 92, 5); b.ribsV(112, 76, 138, 92, 5);
      for (const x of [8, 138]) { const d = x < cx ? -1 : 1; b.E(x + d * 0, 84, 9, 10, 0, 1); b.R(x + (d < 0 ? -12 : 2), 80, x + (d < 0 ? -2 : 12), 88, 0, null); b.L(x + d * 3, 80, x + d * 11, 80, 1); b.L(x + d * 3, 88, x + d * 11, 88, 1); } }
    b.E(cx, 86, 44, 37, sphere(cx, 86, 44, 0.06, 0.8), 1);
    b.ribsH(cx - 20, 40, cx + 20, 52, 3);
    b.E(cx, 34, 38, 7, 0.25, 1);
    b.Pg([[cx - 24, 30], [cx - 22, 16], [cx - 12, 5], [cx, 1], [cx + 12, 5], [cx + 22, 16], [cx + 24, 30]], 0, 1);
    if (view === 0) { b.E(cx - 9, 16, 2, 2, 1, 1); b.E(cx + 9, 16, 2, 2, 1, 1); b.PL([[cx - 9, 23], [cx - 4, 26], [cx + 4, 26], [cx + 9, 23]], 1);
      b.R(cx - 16, 74, cx + 16, 96, 0, 1); if (s > 0.35) { for (let i = 1; i < 4; i++) b.L(cx - 16, 74 + i * 5.5, cx + 15, 74 + i * 5.5, 1); for (let i = 1; i < 5; i++) b.L(cx - 16 + i * 6.4, 74, cx - 16 + i * 6.4, 95, 1); }
      b.R(cx - 22, 144, cx - 6, 152, 1, null); b.R(cx + 6, 144, cx + 22, 152, 1, null);
    } else if (view === 2) { if (s > 0.4) b.PL([[cx - 8, 22], [cx, 25], [cx + 8, 22]], 1); b.R(cx - 14, 144, cx + 14, 154, 0, 1); if (s > 0.35) for (let i = 1; i < 5; i++) b.L(cx - 14 + i * 5.6, 144, cx - 14 + i * 5.6, 153, 1); }
    else { b.ribsV(cx + 30, 78, cx + 58, 92, 5); b.E(cx + 62, 85, 9, 10, 0, 1); b.R(cx + 64, 81, cx + 74, 89, 0, null); b.L(cx + 65, 81, cx + 72, 81, 1); b.L(cx + 65, 89, cx + 72, 89, 1); b.E(cx + 14, 16, 2, 2, 1, 1); }
    return view === 3 ? b.flip() : b;
  }

  // ===== THE HEAVY ROBOT (dark = true gives the Shadow Master's silhouette) ================
  function heavyBot(view, s, dark) {
    const b = make(152, 172, s), cx = 76, body = dark ? 1 : 0.75, trim = dark ? 0 : 1;
    const side = (view === 1 || view === 3);
    b.Pg(side ? [[30, 124], [112, 124], [132, 166], [22, 166]] : [[18, 132], [30, 120], [122, 120], [134, 132], [138, 166], [14, 166]], body, 1);
    b.ribsH(cx - 26, 100, cx + 26, 120, 4);
    if (!side) {
      for (const d of [-1, 1]) { const x0 = d < 0 ? 10 : 118, x1 = d < 0 ? 34 : 142; b.ribsV(x0, 56, x1, 72, 5); const ex = d < 0 ? 10 : 142;
        for (const r of [10, 16, 22]) { const a = []; for (let i = 0; i <= 6; i++) { const t = (-0.9 + 1.8 * i / 6); a.push([ex + d * (Math.cos(t) * r - r * 0.2), 64 + Math.sin(t) * r * 1.5]); } b.PL(a, 1); } }
      b.R(34, 40, 118, 100, body, 1); b.R(34, 40, 118, 48, dark ? 1 : 0.5, 1);
      b.R(40, 0, 72, 28, body, 1); b.R(80, 0, 112, 28, body, 1); b.ribsH(cx - 18, 28, cx + 18, 40, 3);
      if (view === 0) { for (const ex of [56, 96]) { b.E(ex, 14, 11, 10, dark ? 0 : 0, trim ? 1 : 0); b.E(ex, 14, 6, 6, 0.5, 1); b.E(ex, 14, 2, 2, 1, null); }
        b.R(56, 56, 96, 80, 0, 1); if (s > 0.35) { for (let i = 1; i < 4; i++) b.L(56, 56 + i * 6, 95, 56 + i * 6, 1); for (let i = 1; i < 6; i++) b.L(56 + i * 6.7, 56, 56 + i * 6.7, 79, 1); }
        b.R(52, 130, 100, 160, 0, 1); for (let i = 1; i < 8; i++) b.L(52 + i * 6, 130, 52 + i * 6, 159, 1);
      } else { b.R(50, 56, 102, 86, body, trim); if (s > 0.4) for (let i = 0; i < 4; i++) b.L(56, 62 + i * 6, 96, 62 + i * 6, trim); b.R(58, 134, 94, 156, body, trim); }
    } else {
      b.R(46, 40, 104, 100, body, 1); b.R(46, 40, 104, 48, dark ? 1 : 0.5, 1); b.R(50, 0, 102, 28, body, 1); b.ribsH(cx - 16, 28, cx + 16, 40, 3);
      b.E(98, 14, 5, 9, 0, 1); b.ribsV(104, 58, 130, 72, 5);
      for (const r of [10, 16, 22]) { const a = []; for (let i = 0; i <= 6; i++) { const t = (-0.9 + 1.8 * i / 6); a.push([134 + (Math.cos(t) * r - r * 0.2), 65 + Math.sin(t) * r * 1.5]); } b.PL(a, 1); }
      if (s > 0.4) for (let i = 0; i < 5; i++) b.L(52, 58 + i * 7, 84, 58 + i * 7, trim);
    }
    b.R(side ? 20 : 12, 164, side ? 134 : 140, 170, 1, 1);
    return view === 3 ? b.flip() : b;
  }

  // ===== THE POLICE BOX (the teleporter, and the body the Teleporter robot wears) ==========
  function policeBox(view, s) {
    const b = make(116, 176, s), cx = 58;
    shadow(b, cx, 170, 56, 6);
    b.R(cx - 5, 0, cx + 5, 9, 0, 1); b.R(cx - 8, 8, cx + 8, 12, 1, 1);
    b.R(12, 12, 104, 18, 0.5, 1); b.R(6, 18, 110, 24, 0.5, 1);
    b.R(10, 24, 106, 162, 0.75, 1);
    b.R(12, 26, 104, 40, 1, 1); if (!b.label(MW.FONT.gen, 'POLICE  BOX', cx, 37, 0, 0.95)) b.R(24, 31, 92, 35, 0, null);
    b.R(10, 40, 18, 162, 0.5, 1); b.R(98, 40, 106, 162, 0.5, 1);
    for (const x of [22, 60]) {
      b.R(x, 44, x + 34, 160, 0.75, 1);
      b.R(x + 5, 48, x + 29, 74, 0, 1); b.L(x + 13, 48, x + 13, 73, 1); b.L(x + 21, 48, x + 21, 73, 1); b.L(x + 5, 61, x + 28, 61, 1);
      for (let k = 0; k < 3; k++) b.R(x + 5, 80 + k * 27, x + 29, 102 + k * 27, 0.5, 1);
    }
    b.R(27, 80, 51, 102, 0, 1); if (s > 0.6) { b.L(31, 86, 47, 86, 1); b.L(31, 91, 45, 91, 1); b.L(31, 96, 47, 96, 1); }
    b.R(57, 96, 60, 112, 0, 1); b.L(58, 44, 58, 160, 1);
    b.R(4, 162, 112, 170, 0, 1);
    return b;
  }

  // ===== THE MISSILE ======================================================================
  function missile(view, s) {
    if (view === 1 || view === 3) { // crossing, nose to the right
      const b = make(176, 70, s);
      b.Pg([[30, 35], [4, 6], [40, 14], [70, 28]], 1, 1); b.Pg([[30, 35], [4, 64], [40, 56], [70, 42]], 1, 1);
      b.Pg([[28, 27], [120, 25], [172, 35], [120, 45], [28, 43]], (x, y) => 0.1 + 0.8 * Math.abs(y - 31) / 16, 1);
      b.Pg([[28, 27], [10, 31], [10, 39], [28, 43]], 0.75, 1); b.Pg([[10, 33], [0, 35], [10, 37]], 0.5, null);
      b.L(96, 26, 96, 44, 1);
      return view === 3 ? b.flip() : b;
    }
    const b = make(150, 150, s), cx = 75, cy = 75;
    const fin = (a) => { const c = Math.cos(a), n = Math.sin(a); b.Pg([[cx + c * 22, cy + n * 22], [cx + c * 70 - n * 5, cy + n * 70 + c * 5], [cx + c * 58 + n * 14, cy + n * 58 - c * 14], [cx + c * 26 + n * 12, cy + n * 26 - c * 12]], 1, 1); };
    for (const a of [0.7, 2.45, 3.85, 5.6]) fin(a);
    if (view === 2) { b.E(cx, cy, 30, 30, sphere(cx, cy, 30, 0.1, 0.85), 1); b.E(cx, cy + 4, 16, 16, 1, 1); b.E(cx, cy + 4, 9, 9, 0.5, 0); }  // leaving you: the nozzle
    else { b.E(cx, cy, 30, 30, sphere(cx, cy, 30, 0.0, 0.9), 1); b.E(cx, cy, 12, 12, null, 1); b.E(cx - 3, cy - 3, 3, 3, 1, null); } // coming at you: the nose
    return b;
  }

  // ===== THE BLAST (three frames) =========================================================
  function blast(frame, s) {
    const b = make(176, 140, s), cx = 88, cy = 70; let seed = 7 + frame * 31;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    if (frame === 0) { const st = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, r = (i & 1) ? 16 + rnd() * 8 : 40 + rnd() * 18; st.push([cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 0.95]); } b.Pg(st, 0, 1);
      for (let i = 0; i < 12; i++) { const a = rnd() * 6.28, r0 = 44 + rnd() * 8, r1 = r0 + 6 + rnd() * 10; b.L(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.9, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.9, 1); } }
    const n = frame === 0 ? 5 : frame === 1 ? 9 : 12, R = frame === 0 ? 30 : frame === 1 ? 44 : 54;
    for (let i = 0; i < n; i++) { const a = i / n * 6.28 + rnd(), r = R * (0.7 + rnd() * 0.4), q = (frame === 2 ? 5 : 11) + rnd() * (frame === 2 ? 6 : 8); const x = cx + Math.cos(a) * r * 1.15, y = cy + Math.sin(a) * r * 0.9;
      b.E(x, y, q, q * 0.85, 0, 1); b.E(x + q * 0.5, y - q * 0.35, q * 0.6, q * 0.55, 0, 1); b.E(x - q * 0.45, y + q * 0.2, q * 0.5, q * 0.45, 0, 1); if (s > 0.4) b.PL([[x - q * 0.2, y + q * 0.3], [x + q * 0.3, y + q * 0.4]], 1); }
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, r = rnd() * (R + 14); b.set(b.X(cx + Math.cos(a) * r * 1.15), b.X(cy + Math.sin(a) * r * 0.9), 1); }
    return b;
  }

  // ===== assembly =========================================================================
  // kinds: look 0-4 are the five appearances you can pick; the rest are the robots and props.
  const KIND = { arcade, eyeball, mac, boot, taxi, dome: domeBot, heavy: (v, s) => heavyBot(v, s, false), shadow: (v, s) => heavyBot(v, s, true), box: policeBox, missile };
  MW.LOOKS = ['arcade', 'eyeball', 'mac', 'boot', 'taxi'];
  MW.LOOK_NAMES = ['Arcade', 'Eyeball', 'Mac', 'Boot', 'Taxi'];
  const SCALE = []; for (let k = 0; k < 9; k++) SCALE.push(Math.pow(Math.SQRT1_2, k));
  const cache = {};
  MW.art = {
    DEPTHS: 9, SCALE,
    // sprite(kind, view 0 front 1 right 2 back 3 left, depth 1..9) -> Bmp
    sprite(kind, view, depth) { const d = Math.min(9, Math.max(1, depth)), key = kind + view + '_' + d; let b = cache[key]; if (!b) b = cache[key] = KIND[kind](view, SCALE[d - 1]); return b; },
    blast(frame, depth) { const d = Math.min(9, Math.max(1, depth)), key = 'blast' + frame + '_' + d; let b = cache[key]; if (!b) b = cache[key] = blast(frame, SCALE[d - 1]); return b; },
    big(kind, view, s) { return KIND[kind](view, s); },           // for the "Select Your Appearance" dialog
    // build everything up front, a slice per call, so the loader can honestly report progress
    *warm() { const kinds = Object.keys(KIND); const total = kinds.length * 4 * 9 + 27; let n = 0;
      for (const k of kinds) for (let v = 0; v < 4; v++) for (let d = 1; d <= 9; d++) { MW.art.sprite(k, v, d); n++; if (n % 6 === 0) yield n / total; }
      for (let f = 0; f < 3; f++) for (let d = 1; d <= 9; d++) { MW.art.blast(f, d); n++; } yield 1; }
  };
})();
