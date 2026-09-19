/* A 512x342 one-bit framebuffer — the compact Mac's screen — and the few QuickDraw-ish
   primitives the game needs. 1 = black ink, 0 = white paper, colour 2 = invert.
   Patterns are functions of SCREEN x,y, exactly as QuickDraw aligned them, so two shapes
   filled with the same pattern always meet without a seam. */
window.MW = window.MW || {};
(function () {
  const W = 512, H = 342;
  const fb = new Uint8Array(W * H);
  let cx0 = 0, cy0 = 0, cx1 = W, cy1 = H;
  const clips = [];

  function pat8(hex) { // eight bytes, one per row, MSB = leftmost pixel
    const b = []; for (let i = 0; i < 16; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
    return (x, y) => (b[y & 7] >> (7 - (x & 7))) & 1;
  }
  const P = {
    black: () => 1,
    white: () => 0,
    desk: (x, y) => (x + y) & 1,                                   // the 50% desktop grey
    wall: (x, y) => (y & 1) ? ((x & 3) === 1 ? 1 : 0) : ((x & 3) === 3 ? 1 : 0), // 25% staggered dots
    floor: (x, y) => { const a = x & 7, b = y & 7; return ((b === 7 && a === 3) || (b === 1 && a === 7) || (b === 3 && a === 5) || (b === 5 && a === 0)) ? 1 : 0; },
    lt: pat8('8800220088002200'),                                   // 12.5%
    dk: pat8('77DD77DD77DD77DD'),                                   // 75%
    dots: pat8('8000080080000800')
  };

  const G = MW.gfx = {
    W, H, fb, P, pat8,
    clip(x0, y0, x1, y1) { clips.push([cx0, cy0, cx1, cy1]); cx0 = Math.max(cx0, x0); cy0 = Math.max(cy0, y0); cx1 = Math.min(cx1, x1); cy1 = Math.min(cy1, y1); },
    unclip() { const c = clips.pop(); if (c) { cx0 = c[0]; cy0 = c[1]; cx1 = c[2]; cy1 = c[3]; } },
    pset(x, y, c) { if (x < cx0 || y < cy0 || x >= cx1 || y >= cy1) return; const i = y * W + x; fb[i] = c === 2 ? fb[i] ^ 1 : c; },
    get(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : fb[y * W + x]; },
    hline(x0, x1, y, c) { if (y < cy0 || y >= cy1) return; if (x0 > x1) { const t = x0; x0 = x1; x1 = t; } x0 = Math.max(x0, cx0); x1 = Math.min(x1, cx1 - 1); const o = y * W; if (c === 2) for (let x = x0; x <= x1; x++) fb[o + x] ^= 1; else for (let x = x0; x <= x1; x++) fb[o + x] = c; },
    vline(x, y0, y1, c) { if (x < cx0 || x >= cx1) return; if (y0 > y1) { const t = y0; y0 = y1; y1 = t; } y0 = Math.max(y0, cy0); y1 = Math.min(y1, cy1 - 1); if (c === 2) for (let y = y0; y <= y1; y++) fb[y * W + x] ^= 1; else for (let y = y0; y <= y1; y++) fb[y * W + x] = c; },
    line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (;;) { G.pset(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    },
    fill(x, y, w, h, p) { // p: pattern fn, or 0 / 1 / 2
      const x0 = Math.max(x, cx0), y0 = Math.max(y, cy0), x1 = Math.min(x + w, cx1), y1 = Math.min(y + h, cy1);
      if (typeof p === 'function') { for (let yy = y0; yy < y1; yy++) { const o = yy * W; for (let xx = x0; xx < x1; xx++) fb[o + xx] = p(xx, yy); } }
      else if (p === 2) { for (let yy = y0; yy < y1; yy++) { const o = yy * W; for (let xx = x0; xx < x1; xx++) fb[o + xx] ^= 1; } }
      else { for (let yy = y0; yy < y1; yy++) fb.fill(p, yy * W + x0, yy * W + Math.max(x0, x1)); }
    },
    frame(x, y, w, h, c) { G.hline(x, x + w - 1, y, c); G.hline(x, x + w - 1, y + h - 1, c); G.vline(x, y, y + h - 1, c); G.vline(x + w - 1, y, y + h - 1, c); },
    // rounded rectangle the way the Mac's push buttons were: r = corner radius
    rrect(x, y, w, h, r, c, fillp) {
      for (let j = 0; j < h; j++) {
        let inset = 0; const dyy = j < r ? r - j - 0.5 : (j >= h - r ? j - (h - r) + 0.5 : 0);
        if (dyy > 0) inset = Math.round(r - Math.sqrt(Math.max(0, r * r - dyy * dyy)));
        const xa = x + inset, xb = x + w - 1 - inset;
        if (fillp !== undefined && fillp !== null) { if (typeof fillp === 'function') { for (let xx = xa; xx <= xb; xx++) G.pset(xx, y + j, fillp(xx, y + j)); } else G.hline(xa, xb, y + j, fillp); }
      }
      if (c === null || c === undefined) return;
      let prevA = null, prevB = null;
      for (let j = 0; j < h; j++) {
        let inset = 0; const dyy = j < r ? r - j - 0.5 : (j >= h - r ? j - (h - r) + 0.5 : 0);
        if (dyy > 0) inset = Math.round(r - Math.sqrt(Math.max(0, r * r - dyy * dyy)));
        const xa = x + inset, xb = x + w - 1 - inset;
        if (j === 0 || j === h - 1) G.hline(xa, xb, y + j, c);
        else { G.pset(xa, y + j, c); G.pset(xb, y + j, c); if (prevA !== null && Math.abs(prevA - xa) > 1) { G.hline(Math.min(prevA, xa), Math.max(prevA, xa), y + (xa < prevA ? j : j - 1), c); G.hline(Math.min(prevB, xb), Math.max(prevB, xb), y + (xb > prevB ? j : j - 1), c); } }
        prevA = xa; prevB = xb;
      }
    },
    ellipse(cx, cy, rx, ry, c, fillp) {
      for (let j = -ry; j <= ry; j++) {
        const t = 1 - (j * j) / ((ry + 0.5) * (ry + 0.5)); if (t < 0) continue;
        const hw = Math.round((rx + 0.5) * Math.sqrt(t) - 0.5);
        if (fillp !== undefined && fillp !== null) { if (typeof fillp === 'function') { for (let xx = cx - hw; xx <= cx + hw; xx++) G.pset(xx, cy + j, fillp(xx, cy + j)); } else G.hline(cx - hw, cx + hw, cy + j, fillp); }
      }
      if (c === null || c === undefined) return;
      let prev = null;
      for (let j = -ry; j <= ry; j++) {
        const t = 1 - (j * j) / ((ry + 0.5) * (ry + 0.5)); if (t < 0) continue;
        const hw = Math.round((rx + 0.5) * Math.sqrt(t) - 0.5);
        if (prev === null || j === ry) { G.hline(cx - hw, cx + hw, cy + j, c); }
        else { const a = Math.min(prev, hw), b = Math.max(prev, hw); const yy = cy + (hw > prev ? j : j - 1); if (b - a > 1) { G.hline(cx - b, cx - a, yy, c); G.hline(cx + a, cx + b, yy, c); } G.pset(cx - hw, cy + j, c); G.pset(cx + hw, cy + j, c); }
        prev = hw;
      }
    },
    // even-odd scanline polygon fill; pts = [[x,y],…]
    poly(pts, p) {
      let ymin = 1e9, ymax = -1e9; for (const q of pts) { if (q[1] < ymin) ymin = q[1]; if (q[1] > ymax) ymax = q[1]; }
      ymin = Math.max(cy0, Math.floor(ymin)); ymax = Math.min(cy1 - 1, Math.ceil(ymax));
      for (let y = ymin; y <= ymax; y++) {
        const xs = []; const yc = y + 0.5;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
        xs.sort((u, v) => u - v);
        for (let i = 0; i + 1 < xs.length; i += 2) { const xa = Math.max(cx0, Math.ceil(xs[i] - 0.5)), xb = Math.min(cx1 - 1, Math.floor(xs[i + 1] - 0.5)); const o = y * W; if (typeof p === 'function') for (let x = xa; x <= xb; x++) fb[o + x] = p(x, y); else for (let x = xa; x <= xb; x++) fb[o + x] = p; }
      }
    },
    // bmp = {w,h,px,mk?}; mk (mask) marks opaque pixels. mode: undefined copy, 'or' ink only, 'xor'
    blit(bmp, x, y, mode) {
      const { w, h, px, mk } = bmp;
      for (let j = 0; j < h; j++) { const yy = y + j; if (yy < cy0 || yy >= cy1) continue; const o = yy * W, s = j * w;
        for (let i = 0; i < w; i++) { const xx = x + i; if (xx < cx0 || xx >= cx1) continue; const v = px[s + i];
          if (mode === 'or') { if (v) fb[o + xx] = 1; } else if (mode === 'xor') { if (v) fb[o + xx] ^= 1; } else if (!mk || mk[s + i]) fb[o + xx] = v; } }
    },
    textW(font, str) { let w = 0; for (const ch of str) { const g = font.g[ch] || font.g['?']; w += g.w + font.sp; } return Math.max(0, w - font.sp); },
    // y is the BASELINE (bottom row of the capitals). dim = the greyed-out look of a disabled menu title.
    text(font, str, x, y, c, dim) {
      if (c === undefined) c = 1; const top = y - (font.cap - 1);
      for (const ch of str) { const g = font.g[ch] || font.g['?'];
        for (let j = 0; j < g.rows.length; j++) { const row = g.rows[j], yy = top + g.top + j; for (let i = 0; i < row.length; i++) if (row[i] && (!dim || ((x + i + yy) & 1) === 0)) G.pset(x + i, yy, c); }
        x += g.w + font.sp; }
      return x;
    },
    textC(font, str, xMid, y, c) { return G.text(font, str, Math.round(xMid - G.textW(font, str) / 2), y, c); },
    textR(font, str, xRight, y, c) { return G.text(font, str, xRight - G.textW(font, str) + 1, y, c); },
    // cut to fit a pixel width, with an ellipsis
    fit(font, str, maxW) { if (G.textW(font, str) <= maxW) return str; let s = str; while (s.length > 1 && G.textW(font, s + '…') > maxW) s = s.slice(0, -1); return s + '…'; },
    wrap(font, str, maxW) {
      const out = []; let line = '';
      for (const word of str.split(' ')) {
        let wd = word;
        while (G.textW(font, wd) > maxW) { let k = wd.length; while (k > 1 && G.textW(font, wd.slice(0, k)) > maxW) k--; if (line) { out.push(line); line = ''; } out.push(wd.slice(0, k)); wd = wd.slice(k); }
        const t = line ? line + ' ' + wd : wd;
        if (G.textW(font, t) <= maxW) line = t; else { out.push(line); line = wd; }
      }
      if (line) out.push(line); return out;
    }
  };

  let ctx = null, img = null, u32 = null;
  G.attach = function (canvas) { canvas.width = W; canvas.height = H; ctx = canvas.getContext('2d', { alpha: false }); img = ctx.createImageData(W, H); u32 = new Uint32Array(img.data.buffer); };
  G.present = function () { if (!ctx) return; const n = W * H; for (let i = 0; i < n; i++) u32[i] = fb[i] ? 0xFF000000 : 0xFFFFFFFF; ctx.putImageData(img, 0, 0); };
})();
