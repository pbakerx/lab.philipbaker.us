// MISSILE COMMAND DELUXE · CITY RUN — radar.js: the scope, and the flat layer drawn over the 3D view.
//
// THE RADAR is a hologram hung high in the view, where your eyes already are — not an instrument
// parked in a corner. It is heading-up and craft-centred: whatever is ahead of you is at the top.
// It has no opaque face: you see the sky through it, and A CLICK GOES THROUGH IT TOO, unless it
// lands on a blip — then base camp fires at that spot on the map (main.js, fireAt → blipAt).
// It shows what the windscreen cannot: everything behind, above and beside you.
const TAU = Math.PI * 2, FONT = 'Rajdhani,"Avenir Next Condensed","Segoe UI",system-ui,sans-serif';

export function createRadar(canvas) {
  const ctx = canvas.getContext('2d'); let size = 0, dpr = 1, last = null, blips = []; const RANGE = 680;
  function fit() { const r = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); size = r.width; canvas.width = canvas.height = Math.max(2, Math.round(size * dpr)); }
  const glow = (col, blur) => { ctx.shadowColor = col; ctx.shadowBlur = blur; };

  function draw(S, city, css, time) {
    if (!size) fit(); if (!size) return;
    const R = size / 2, k = (R - 8) / RANGE, c = S.craft, fl = Math.hypot(c.T.x, c.T.z) || 1, f = [c.T.x / fl, c.T.z / fl], r = [c.R.x, c.R.z];
    last = { cx: c.pos.x, cz: c.pos.z, f, r, k, R }; blips = [];
    const at = (x, z) => { const dx = x - c.pos.x, dz = z - c.pos.z; return [(dx * r[0] + dz * r[1]) * k, -(dx * f[0] + dz * f[1]) * k]; };
    const rim = p => { const d = Math.hypot(p[0], p[1]), m = R - 10; return d > m ? [p[0] / d * m, p[1] / d * m, true] : [p[0], p[1], false]; };
    const jam = S.linkLost > 0, main = jam ? css.enemy : css.friendly;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size); ctx.save(); ctx.translate(R, R); ctx.lineCap = 'round';
    // a breath of glass, so blips read against a bright blast behind them — but never a face
    const g = ctx.createRadialGradient(0, 0, R * .2, 0, 0, R); g.addColorStop(0, 'rgba(2,10,16,.34)'); g.addColorStop(1, 'rgba(2,10,16,.04)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU); ctx.fill();

    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU); ctx.clip();
    // the sweep and its afterglow
    const sw = time * 1.7 % TAU; for (let i = 0; i < 30; i++) { ctx.globalAlpha = .13 * (1 - i / 30); ctx.fillStyle = main; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sw - i * .028 - .028, sw - i * .028); ctx.closePath(); ctx.fill(); }
    // what the windscreen sees
    ctx.globalAlpha = .08; ctx.fillStyle = main; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / 2 - .66, -Math.PI / 2 + .66); ctx.closePath(); ctx.fill();
    // range rings, bearing ticks
    ctx.strokeStyle = main; ctx.lineWidth = 1; for (const q of [.34, .67]) { ctx.globalAlpha = .2; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.arc(0, 0, (R - 8) * q, 0, TAU); ctx.stroke(); } ctx.setLineDash([]);
    ctx.globalAlpha = .45; for (let i = 0; i < 36; i++) { const a = i / 36 * TAU, l = i % 9 === 0 ? 8 : i % 3 === 0 ? 5 : 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3)); ctx.lineTo(Math.cos(a) * (R - 3 - l), Math.sin(a) * (R - 3 - l)); ctx.stroke(); }

    // the city limits and the circuit you are flying
    ctx.globalAlpha = .34; ctx.strokeStyle = css.ground; ctx.beginPath(); const h = city.half; [[-h, -h], [h, -h], [h, h], [-h, h]].forEach((p, i) => { const q = at(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = .4; ctx.setLineDash([1.5, 3.5]); ctx.beginPath(); city.route.map.forEach((p, i) => { const q = at(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);

    for (const b of S.blasts) { if (b.r <= 0) continue; const q = at(b.pos.x, b.pos.z); ctx.globalAlpha = .8; ctx.strokeStyle = b.hostile ? css.enemy : css.ground; ctx.lineWidth = 1.3; glow(ctx.strokeStyle, 8); ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2, b.r * k), 0, TAU); ctx.stroke(); }
    ctx.lineWidth = 1.4;
    for (const p of S.pickups) if (p && !p.taken) { const q = rim(at(p.pos.x, p.pos.z)); ctx.globalAlpha = .85; ctx.strokeStyle = css.friendly; glow(css.friendly, 6); ctx.beginPath(); ctx.arc(q[0], q[1], 2.4, 0, TAU); ctx.stroke(); }
    for (const p of S.mines) if (p && !p.hit) { const q = rim(at(p.pos.x, p.pos.z)); ctx.globalAlpha = .9; ctx.strokeStyle = css.enemy; glow(css.enemy, 6); ctx.beginPath(); ctx.moveTo(q[0] - 2.4, q[1] - 2.4); ctx.lineTo(q[0] + 2.4, q[1] + 2.4); ctx.moveTo(q[0] + 2.4, q[1] - 2.4); ctx.lineTo(q[0] - 2.4, q[1] + 2.4); ctx.stroke(); }

    // the six, and base camp
    for (const t of S.towers) { const q = rim(at(t.x, t.z)), warn = t.alive && t.threat < 5 && (time * 6 % 1) < .5, col = warn ? css.enemy : css.friendly; ctx.globalAlpha = t.alive ? 1 : .4; glow(col, t.alive ? 9 : 0);
      ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(Math.PI / 4); if (t.alive) { ctx.fillStyle = col; ctx.fillRect(-3, -3, 6, 6); } else { ctx.strokeStyle = css.enemy; ctx.strokeRect(-2.4, -2.4, 4.8, 4.8); } ctx.restore(); }
    { const q = rim(at(city.mast.x, city.mast.z)); ctx.globalAlpha = 1; ctx.strokeStyle = main; ctx.lineWidth = 1.6; glow(main, 9); ctx.beginPath(); ctx.moveTo(q[0], q[1] - 5.5); ctx.lineTo(q[0] + 4.8, q[1] + 3.6); ctx.lineTo(q[0] - 4.8, q[1] + 3.6); ctx.closePath(); ctx.stroke(); }

    for (const s of S.shots) { const q = rim(at(s.pos.x, s.pos.z)); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; glow(css.friendly, 8); ctx.beginPath(); ctx.arc(q[0], q[1], 1.5, 0, TAU); ctx.fill(); }
    // the raid
    for (const e of S.enemies) { const plane = e.drops !== undefined, p = at(e.pos.x, e.pos.z), q = rim(p), urgent = e.eta !== undefined && e.eta < 4.5; blips.push({ x: q[0] + R, y: q[1] + R, wx: e.pos.x, wz: e.pos.z });
      if (urgent && (time * 7 % 1) < .4) continue; const col = e.type === 'smart' ? css.ground : css.enemy; ctx.globalAlpha = 1; ctx.fillStyle = ctx.strokeStyle = col; glow(col, 10);
      if (plane) { const v = at(e.pos.x + e.vel.x, e.pos.z + e.vel.z), a = Math.atan2(v[1] - p[1], v[0] - p[0]), s = e.type === 'bomber' ? 6 : 4; ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * .8, s * .75); ctx.lineTo(-s * .3, 0); ctx.lineTo(-s * .8, -s * .75); ctx.closePath(); ctx.fill(); ctx.restore(); continue; }
      const low = 1 - Math.min(1, e.pos.y / 540), size2 = 1.4 + low * 2.3;                                                  // the lower it is, the bigger it reads
      if (!q[2]) { const tl = at(e.pos.x - e.vel.x * 1.5, e.pos.z - e.vel.z * 1.5); ctx.globalAlpha = .5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tl[0], tl[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(q[0], q[1], size2, 0, TAU); ctx.fill(); }
    ctx.restore(); glow('transparent', 0);

    // you, and the two fine rims
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; glow(main, 10); ctx.beginPath(); ctx.moveTo(0, -6.5); ctx.lineTo(4.4, 4.8); ctx.lineTo(0, 2.4); ctx.lineTo(-4.4, 4.8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = main; ctx.globalAlpha = .9; ctx.lineWidth = 1.2; glow(main, 12); ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .35; ctx.lineWidth = 3; glow('transparent', 0); ctx.beginPath(); ctx.arc(0, 0, R - 2, -Math.PI / 2 - .5, -Math.PI / 2 + .5); ctx.stroke(); ctx.restore();
  }
  // radar-local CSS pixels → the world spot under a BLIP, or null. Only a blip takes the click; everywhere else the radar is sky.
  function blipAt(px, py) { if (!last || px < 0 || py < 0 || px > size || py > size) return null; let best = null, bd = 17 * 17; for (const b of blips) { const d = (b.x - px) ** 2 + (b.y - py) ** 2; if (d < bd) { bd = d; best = b; } } return best && { x: best.wx, z: best.wz }; }
  return { draw, fit, blipAt };
}

// The flat layer: reticle, target marks, tower and aircraft brackets, edge warnings, score pops, the altitude tape, the thumb stick.
export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d'); let W = 0, H = 0, dpr = 1; const out = {};
  function fit(w, h) { W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(2, Math.round(w * dpr)); canvas.height = Math.max(2, Math.round(h * dpr)); }
  const edge = (x, y, m) => { const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy, s = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6)); return [cx + dx * s, cy + dy * s, Math.atan2(dy, dx)]; };
  const glow = (col, blur) => { ctx.shadowColor = col; ctx.shadowBlur = blur; };
  function chevron(x, y, a, col, size) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.strokeStyle = col; ctx.lineWidth = 2; glow(col, 8); ctx.beginPath(); ctx.moveTo(-size, -size); ctx.lineTo(0, 0); ctx.lineTo(-size, size); ctx.stroke(); ctx.restore(); }
  function corners(x, y, s, gap) { ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + sx * s, y + sy * (s - gap)); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * (s - gap), y + sy * s); } ctx.stroke(); }

  function draw(S, world, css, time, ui) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); if (!ui.live) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineCap = 'round';

    for (const t of S.towers) { if (!t.alive) continue; const p = world.project(t.top, out), warn = t.threat < 5, blink = (time * 6 % 1) < .55, col = warn ? css.enemy : css.friendly;
      if (p.on) { ctx.globalAlpha = warn ? (blink ? 1 : .35) : .42; ctx.strokeStyle = col; ctx.lineWidth = warn ? 1.8 : 1.1; glow(col, warn ? 10 : 4); corners(p.x, p.y, warn ? 16 : 11, 5);
        if (warn) { ctx.font = '700 11px ' + FONT; ctx.fillStyle = col; ctx.fillText('T−' + t.threat.toFixed(1), p.x, p.y - 26); } }
      else if (warn && blink) { let x = p.x, y = p.y; if (p.behind) { x = W - x; y = H + 400; } const e = edge(x, y, 30); ctx.globalAlpha = 1; chevron(e[0], e[1], e[2], css.enemy, 9); ctx.font = '700 11px ' + FONT; ctx.fillStyle = css.enemy; ctx.fillText('TOWER', e[0] - Math.cos(e[2]) * 36, e[1] - Math.sin(e[2]) * 24); } }

    for (const e of S.enemies) { const plane = e.drops !== undefined; if (plane) { const p = world.project(e.pos, out); if (p.on) { ctx.globalAlpha = .9; ctx.strokeStyle = css.enemy; ctx.lineWidth = 1.3; glow(css.enemy, 8); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4 + time * .6); corners(0, 0, e.type === 'bomber' ? 17 : 11, 5); ctx.restore();
          ctx.font = '700 10px ' + FONT; ctx.fillStyle = css.enemy; ctx.fillText(e.type.toUpperCase(), p.x, p.y + (e.type === 'bomber' ? 31 : 23)); } continue; }
      if (e.eta === undefined || e.eta > 7) continue; const p = world.project(e.pos, out); if (p.on) continue; let x = p.x, y = p.y; if (p.behind) { x = W - x; y = H + 400; } const q = edge(x, y, 16); ctx.globalAlpha = .45 + .55 * (1 - e.eta / 7); chevron(q[0], q[1], q[2], css.enemy, 5); }

    ctx.lineWidth = 1.5;
    for (const s of S.shots) { const p = world.project(s.target, out); if (!p.on) continue; ctx.globalAlpha = .95; ctx.strokeStyle = css.friendly; glow(css.friendly, 8); ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); ctx.stroke(); }
    for (const p of S.popups) { const q = world.project(p.pos, out); if (!q.on) continue; const u = p.t / p.life, col = p.col === 'ground' ? css.ground : css.friendly; ctx.globalAlpha = 1 - u * u; ctx.fillStyle = col; glow(col, 10); ctx.font = '700 17px ' + FONT; ctx.fillText(p.text, q.x, q.y - 14 - u * 28); }
    for (const r of ui.ripples) { const u = r.t / .4, col = r.ok ? css.friendly : css.enemy; ctx.globalAlpha = (1 - u) * .9; ctx.strokeStyle = col; ctx.lineWidth = 1.6; glow(col, 8); ctx.beginPath(); ctx.arc(r.x, r.y, 8 + u * 26, 0, TAU); ctx.stroke(); }

    // altitude: a slim tape on the right edge, with the roofline marked — above it the canyon opens
    if (ui.alt !== undefined && !ui.mobile) { const x = W - 26, y0 = H * .3, y1 = H * .72, yOf = a => y1 - (y1 - y0) * Math.min(1, a / ui.top), col = css.friendly; glow(col, 6); ctx.strokeStyle = col; ctx.globalAlpha = .4; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      for (let a = 0; a <= ui.top; a += 65) { ctx.beginPath(); ctx.moveTo(x - 4, yOf(a)); ctx.lineTo(x, yOf(a)); ctx.stroke(); }
      ctx.globalAlpha = .85; ctx.strokeStyle = css.ground; glow(css.ground, 6); ctx.beginPath(); ctx.moveTo(x - 9, yOf(ui.roof)); ctx.lineTo(x + 5, yOf(ui.roof)); ctx.stroke(); ctx.font = '600 9px ' + FONT; ctx.fillStyle = css.ground; ctx.textAlign = 'right'; ctx.fillText('ROOFLINE', x - 13, yOf(ui.roof));
      const ya = yOf(ui.alt); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; glow(col, 10); ctx.beginPath(); ctx.moveTo(x - 2, ya); ctx.lineTo(x - 10, ya - 5); ctx.lineTo(x - 10, ya + 5); ctx.closePath(); ctx.fill(); ctx.font = '700 13px ' + FONT; ctx.fillStyle = col; ctx.fillText(String(Math.round(ui.alt)), x - 15, ya); ctx.font = '600 9px ' + FONT; ctx.globalAlpha = .6; ctx.fillText('ALT', x + 4, y0 - 12); ctx.textAlign = 'center'; }

    if (ui.stick) { const s = ui.stick; ctx.globalAlpha = .35; ctx.strokeStyle = css.friendly; ctx.lineWidth = 1.3; glow(css.friendly, 8); ctx.beginPath(); ctx.arc(s.x0, s.y0, 46, 0, TAU); ctx.stroke(); ctx.globalAlpha = .8; ctx.fillStyle = css.friendly; ctx.beginPath(); ctx.arc(s.x0 + s.ix * 46, s.y0 - s.iy * 46, 10, 0, TAU); ctx.fill(); }

    if (ui.reticle) { const { x, y } = ui.reticle, lock = ui.lock, col = S.linkLost > 0 ? css.enemy : css.friendly; ctx.globalAlpha = 1; ctx.strokeStyle = col; glow(col, 10); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.stroke(); for (let i = 0; i < 3; i++) { const a = time * 1.1 + i * TAU / 3; ctx.beginPath(); ctx.arc(x, y, 15, a, a + 1.25); ctx.stroke(); }
      ctx.globalAlpha = .55; for (let i = 0; i < 4; i++) { const a = i * TAU / 4 - time * .5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 21, y + Math.sin(a) * 21); ctx.lineTo(x + Math.cos(a) * 27, y + Math.sin(a) * 27); ctx.stroke(); }
      if (lock) { const s = 8 + Math.sin(time * 9) * 1.5; ctx.globalAlpha = 1; ctx.strokeStyle = css.ground; ctx.lineWidth = 1.6; glow(css.ground, 12); ctx.beginPath(); ctx.moveTo(lock.x, lock.y - s); ctx.lineTo(lock.x + s, lock.y); ctx.lineTo(lock.x, lock.y + s); ctx.lineTo(lock.x - s, lock.y); ctx.closePath(); ctx.stroke();   // the diamond is where the shot will actually burst
        ctx.font = '700 10px ' + FONT; ctx.fillStyle = css.ground; ctx.fillText('LOCK', lock.x, lock.y + s + 11); } }
    ctx.globalAlpha = 1; glow('transparent', 0);
  }
  return { draw, fit };
}
