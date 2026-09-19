/* The hall — the first-person view. Geometry measured off the 1986 screen:
   every cell boundary is a SQUARE centred on (140,136); each is 1/sqrt(2) the size of the one
   before (half-sizes 110, 77, 54, 38, 26 …). Squares about one centre mean every wall edge is a
   true 45-degree line, which is why a column's wall height is just its distance from centre.
   One dither for every wall, a sparse weave for the floor, a white ceiling. Lines appear only
   where a run of wall starts or stops — never between two cells of the same wall. */
window.MW = window.MW || {};
(function () {
  const G = MW.gfx;
  const CX = 140, CY = 136, X0 = 16, Y0 = 26, X1 = 264, Y1 = 260;
  const HP = [156]; { let h = 110; while (h >= 1) { HP.push(h); h = Math.floor(h * Math.SQRT1_2); } HP.push(0); }
  const MAXD = HP.length - 2;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];          // N E S W
  const BIT = [8, 1, 2, 4];                              // wall bit for N E S W

  function wallAt(L, x, y, dir) { if (x < 0 || y < 0 || x > 15 || y > 15) return true; return (L.w[y][x] & BIT[dir]) !== 0; }

  function sideWall(sign, d, nearLine, farLine) {        // sign -1 left, +1 right; cell d spans planes d..d+1
    const hn = HP[d], hf = HP[d + 1];
    for (let h = hf; h <= hn; h++) { const x = CX + sign * h; if (x < X0 || x > X1) continue;
      for (let y = Math.max(Y0, CY - h + 1); y <= Math.min(Y1, CY + h - 1); y++) G.fb[y * 512 + x] = G.P.wall(x, y);
      G.pset(x, CY - h, 1); G.pset(x, CY + h, 1); }
    if (nearLine) G.vline(CX + sign * hn, CY - hn, CY + hn, 1);
    if (farLine) G.vline(CX + sign * hf, CY - hf, CY + hf, 1);
  }
  function facing(h, xa, xb, leftLine, rightLine) {       // a wall square-on to you, half-size h, shown from xa to xb
    xa = Math.max(xa, X0); xb = Math.min(xb, X1); if (xb < xa) return;
    G.fill(xa, CY - h, xb - xa + 1, 2 * h + 1, G.P.wall);
    G.hline(xa, xb, CY - h, 1); G.hline(xa, xb, CY + h, 1);
    if (leftLine) G.vline(xa, CY - h, CY + h, 1); if (rightLine) G.vline(xb, CY - h, CY + h, 1);
  }
  // What shows through a side opening of cell d: the side passage's far wall — or, if that
  // passage runs on ahead, whatever finally closes it.
  function opening(L, sign, d, cx, cy, dir) {
    const sdir = (dir + (sign < 0 ? 3 : 1)) & 3, hn = HP[d], hf = HP[d + 1];
    const xa = sign < 0 ? CX - hn : CX + hf, xb = sign < 0 ? CX - hf : CX + hn;
    let lx = cx + DX[sdir], ly = cy + DY[sdir], e = d; const far = [];
    // the far boundary column belongs to whatever comes next (a wall's edge line, the next opening, or the end wall)
    G.clip(Math.max(X0, sign < 0 ? xa : xa + 1), Y0, Math.min(X1, sign < 0 ? xb - 1 : xb) + 1, Y1 + 1);
    while (e < MAXD && !wallAt(L, lx, ly, dir)) { lx += DX[dir]; ly += DY[dir]; e++; if (e - d >= 3 && wallAt(L, lx, ly, sdir)) far.push(e); }
    const h = HP[e + 1];
    facing(h, sign < 0 ? CX - 3 * h : CX + h, sign < 0 ? CX - h : CX + 3 * h, false, false);
    // a passage that runs on three cells or more swings its own outer wall into view
    for (const k of far) for (let o = 3 * HP[k + 1]; o <= 3 * HP[k]; o++) { const x = CX + sign * o, hh = Math.round(o / 3);
      for (let y = CY - hh + 1; y < CY + hh; y++) G.pset(x, y, G.P.wall(x, y)); G.pset(x, CY - hh, 1); G.pset(x, CY + hh, 1); }
    G.unclip();
    return e;
  }
  function doors(h, broken) {                              // an elevator, square-on
    const w = Math.round(h * 0.62), top = CY - Math.round(h * 0.55), bot = CY + h - 1;
    if (h < 5) { G.fill(CX - w, top, 2 * w + 1, bot - top, 0); G.frame(CX - w, top, 2 * w + 1, bot - top + 1, 1); return; }
    G.fill(CX - w - 3, top - 3, 2 * w + 7, bot - top + 3, 0); G.frame(CX - w - 3, top - 3, 2 * w + 7, bot - top + 4, 1);
    G.fill(CX - w, top, 2 * w + 1, bot - top, G.P.lt); G.frame(CX - w, top, 2 * w + 1, bot - top + 1, 1); G.vline(CX, top, bot, 1);
    const r = Math.max(3, Math.round(h * 0.16)), iy = top - 3 - Math.round(h * 0.06);
    for (let a = 0; a <= 16; a++) { const t = Math.PI * a / 16; G.pset(CX + Math.round(Math.cos(t) * r), iy - Math.round(Math.sin(t) * r), 1); }
    G.hline(CX - r, CX + r, iy, 1); G.line(CX, iy, CX + Math.round(r * 0.6), iy - Math.round(r * 0.7), 1);
    if (h > 20) { const bx = CX + w + 6 + Math.round(h * 0.06); G.fill(bx, CY - 2, 5, 11, 0); G.frame(bx, CY - 2, 5, 11, 1); G.pset(bx + 2, CY + 1, 1); G.pset(bx + 2, CY + 5, 1); }
    if (broken && h > 12) { G.line(CX - w, top + 2, CX + w, bot - 2, 1); G.line(CX - w, top + 3, CX + w, bot - 1, 1); G.line(CX + w, top + 2, CX - w, bot - 2, 1);
      if (h > 50) { const tw = G.textW(MW.FONT.gen, 'OUT OF ORDER') + 8; G.fill(CX - (tw >> 1), CY - 8, tw, 15, 0); G.frame(CX - (tw >> 1), CY - 8, tw, 15, 1); G.textC(MW.FONT.gen, 'OUT OF ORDER', CX, CY + 4, 1); } }
  }

  MW.hall = {
    CX, CY, X0, Y0, X1, Y1, HP,
    // v = {L: level object, x, y, dir, things(x,y) -> [{kind, dir, depthOnly?}], elevOk}
    draw(v) {
      const L = v.L, dir = v.dir;
      G.clip(X0, Y0, X1 + 1, Y1 + 1);
      G.fill(X0, Y0, X1 - X0 + 1, CY - Y0 + 1, 0);
      G.fill(X0, CY + 1, X1 - X0 + 1, Y1 - CY, G.P.floor);
      let D = 0, x = v.x, y = v.y; const cells = [[x, y]];
      while (D < MAXD && !wallAt(L, x, y, dir)) { x += DX[dir]; y += DY[dir]; D++; cells.push([x, y]); }
      const ld = (dir + 3) & 3, rd = (dir + 1) & 3;
      const lw = cells.map(c => wallAt(L, c[0], c[1], ld)), rw = cells.map(c => wallAt(L, c[0], c[1], rd));
      for (let d = D; d >= 0; d--) {
        const c = cells[d];
        const eL = lw[d] ? -1 : opening(L, -1, d, c[0], c[1], dir);
        const eR = rw[d] ? -1 : opening(L, 1, d, c[0], c[1], dir);
        // the end wall shares its plane with a side passage's far wall: no line where they simply continue
        if (d === D) { const h = HP[D + 1]; facing(h, CX - h, CX + h, lw[D] || eL > D, rw[D] || eR > D);
          const el = L.elevAt[c[1] * 16 + c[0]]; if (el !== undefined && L.elevFace[c[1] * 16 + c[0]] === dir) doors(h, !v.elevOk); }
        if (lw[d]) sideWall(-1, d, d > 0 && !lw[d - 1], d === D || !lw[d + 1]);
        if (rw[d]) sideWall(1, d, d > 0 && !rw[d - 1], d === D || !rw[d + 1]);
        if (d >= 1 && v.things) { const ts = v.things(c[0], c[1]); if (ts) for (const t of ts) MW.hall.sprite(t, d, dir); }
      }
      if (v.things) { const ts = v.things(v.x, v.y); if (ts) for (const t of ts) if (t.kind === 'blast') MW.hall.sprite(t, 1, dir); }
      G.unclip();
    },
    sprite(t, d, dir) {
      if (d > MW.art.DEPTHS) return;
      const s = MW.art.SCALE[d - 1]; let b, bx, by;
      if (t.kind === 'blast') { b = MW.art.blast(t.frame | 0, d); bx = CX - (b.w >> 1); by = CY + Math.round(6 * s) - (b.h >> 1); }
      else {
        const rel = ((t.dir | 0) - dir + 4) & 3, view = rel === 0 ? 2 : rel === 2 ? 0 : rel;
        b = MW.art.sprite(t.kind, view, d); bx = CX - (b.w >> 1);
        if (t.kind === 'missile') by = CY + Math.round(10 * s) - (b.h >> 1);
        else by = CY + HP[d + 1] + Math.max(1, Math.round(4 * s)) - b.h;
      }
      G.blit(b, bx, by);
    },
    // the ride between levels: what you see from inside the car
    elevator(t, going) {
      G.clip(X0, Y0, X1 + 1, Y1 + 1);
      G.fill(X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1, G.P.wall);
      const dx0 = 66, dx1 = 214, dy0 = 70, dy1 = 250;
      G.fill(dx0 - 8, dy0 - 8, dx1 - dx0 + 17, dy1 - dy0 + 9, 0); G.frame(dx0 - 8, dy0 - 8, dx1 - dx0 + 17, dy1 - dy0 + 10, 1);
      const gap = Math.round((going ? Math.max(0, 1 - t * 2.2) : Math.min(1, t * 2.2)) * 70);
      G.fill(dx0, dy0, dx1 - dx0 + 1, dy1 - dy0 + 1, 1);
      G.fill(dx0, dy0, CX - gap - dx0, dy1 - dy0 + 1, G.P.lt); G.frame(dx0, dy0, CX - gap - dx0 + 1, dy1 - dy0 + 1, 1);
      G.fill(CX + gap, dy0, dx1 - CX - gap + 1, dy1 - dy0 + 1, G.P.lt); G.frame(CX + gap, dy0, dx1 - CX - gap + 1, dy1 - dy0 + 1, 1);
      for (const x of [dx0 + 14, dx1 - 34]) { G.fill(x, dy0 + 20, 20, 60, 0); G.frame(x, dy0 + 20, 20, 60, 1); }
      const r = 22, iy = dy0 - 14; G.fill(CX - r - 4, iy - r - 4, 2 * r + 9, r + 8, 0);
      for (let a = 0; a <= 40; a++) { const q = Math.PI * a / 40; G.pset(CX + Math.round(Math.cos(q) * r), iy - Math.round(Math.sin(q) * r), 1); }
      G.hline(CX - r, CX + r, iy, 1); const ang = Math.PI * (0.15 + 0.7 * t); G.line(CX, iy, CX - Math.round(Math.cos(ang) * (r - 4)), iy - Math.round(Math.sin(ang) * (r - 4)), 1);
      G.fill(dx1 + 16, 140, 12, 30, 0); G.frame(dx1 + 16, 140, 12, 30, 1); G.ellipse(dx1 + 22, 149, 3, 3, 1, going ? 1 : 0); G.ellipse(dx1 + 22, 161, 3, 3, 1, going ? 0 : 1);
      G.unclip();
    }
  };
})();
