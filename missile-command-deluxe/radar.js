// MISSILE COMMAND DELUXE · CITY RUN — radar.js: the scope, and the flat layer drawn over the 3D view.
//
// THE RADAR is heading-up and craft-centred: whatever is ahead of you is at the top. It shows what
// the windscreen cannot — everything behind, above and beside you — and it is a control, not just
// an instrument: tap a blip and base camp fires there. It is, on purpose, the original game in
// miniature: a flat field, dots falling on six squares, and your finger on the sky.
const TAU = Math.PI * 2;

export function createRadar(canvas) {
  const ctx = canvas.getContext('2d'); let size = 0, dpr = 1, last = null; const RANGE = 660;
  function fit() { const r = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); size = r.width; canvas.width = canvas.height = Math.max(2, Math.round(size * dpr)); }

  function draw(S, city, css, time) {
    if (!size) fit(); if (!size) return;
    const R = size / 2, k = (R - 5) / RANGE, c = S.craft, fx = c.T.x, fz = c.T.z, fl = Math.hypot(fx, fz) || 1, f = [fx / fl, fz / fl], r = [c.R.x, c.R.z];
    last = { cx: c.pos.x, cz: c.pos.z, f, r, k, R };
    const at = (x, z) => { const dx = x - c.pos.x, dz = z - c.pos.z; return [(dx * r[0] + dz * r[1]) * k, -(dx * f[0] + dz * f[1]) * k]; };
    const rim = (p) => { const d = Math.hypot(p[0], p[1]), m = R - 7; return d > m ? [p[0] / d * m, p[1] / d * m, true] : [p[0], p[1], false]; };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size); ctx.save(); ctx.translate(R, R);
    ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, TAU); ctx.fillStyle = 'rgba(0,6,10,.72)'; ctx.fill(); ctx.save(); ctx.clip();

    // range rings, and the sweep with its afterglow
    ctx.strokeStyle = css.friendly; ctx.lineWidth = 1; ctx.globalAlpha = .16; for (const q of [.33, .66]) { ctx.beginPath(); ctx.arc(0, 0, (R - 5) * q, 0, TAU); ctx.stroke(); }
    const sw = time * 1.9 % TAU; for (let i = 0; i < 26; i++) { ctx.globalAlpha = .17 * (1 - i / 26); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sw - i * .03 - .03, sw - i * .03); ctx.closePath(); ctx.fillStyle = css.friendly; ctx.fill(); }

    // the city limits and the circuit you are flying
    ctx.globalAlpha = .3; ctx.strokeStyle = css.ground; ctx.beginPath(); const h = city.half; [[-h, -h], [h, -h], [h, h], [-h, h]].forEach((p, i) => { const q = at(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = .42; ctx.setLineDash([2, 3]); ctx.beginPath(); city.route.map.forEach((p, i) => { const q = at(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);

    // what you can see: the windscreen's wedge
    ctx.globalAlpha = .1; ctx.fillStyle = css.friendly; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / 2 - .62, -Math.PI / 2 + .62); ctx.closePath(); ctx.fill();

    // blasts, then the things they are for
    for (const b of S.blasts) { if (b.r <= 0) continue; const q = at(b.pos.x, b.pos.z); ctx.globalAlpha = .75; ctx.strokeStyle = b.hostile ? css.enemy : css.ground; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2, b.r * k), 0, TAU); ctx.stroke(); }
    ctx.lineWidth = 1.5;
    for (const p of S.pickups) if (p && !p.taken) { const q = rim(at(p.pos.x, p.pos.z)); ctx.globalAlpha = .9; ctx.strokeStyle = css.friendly; ctx.beginPath(); ctx.arc(q[0], q[1], 2.6, 0, TAU); ctx.stroke(); }
    for (const p of S.mines) if (p && !p.hit) { const q = rim(at(p.pos.x, p.pos.z)); ctx.globalAlpha = .9; ctx.strokeStyle = css.enemy; ctx.beginPath(); ctx.moveTo(q[0] - 2.5, q[1] - 2.5); ctx.lineTo(q[0] + 2.5, q[1] + 2.5); ctx.moveTo(q[0] + 2.5, q[1] - 2.5); ctx.lineTo(q[0] - 2.5, q[1] + 2.5); ctx.stroke(); }

    for (const t of S.towers) { const q = rim(at(t.x, t.z)), warn = t.alive && t.threat < 5 && (time * 6 % 1) < .5; ctx.globalAlpha = t.alive ? 1 : .45;
      if (t.alive) { ctx.fillStyle = warn ? css.enemy : css.friendly; ctx.fillRect(q[0] - 3.2, q[1] - 3.2, 6.4, 6.4); } else { ctx.strokeStyle = css.enemy; ctx.strokeRect(q[0] - 2.6, q[1] - 2.6, 5.2, 5.2); } }
    { const q = rim(at(city.mast.x, city.mast.z)); ctx.globalAlpha = 1; ctx.fillStyle = css.friendly; ctx.beginPath(); ctx.moveTo(q[0], q[1] - 5.2); ctx.lineTo(q[0] + 4.6, q[1] + 3.6); ctx.lineTo(q[0] - 4.6, q[1] + 3.6); ctx.closePath(); ctx.fill(); }

    for (const s of S.shots) { const q = rim(at(s.pos.x, s.pos.z)); ctx.globalAlpha = 1; ctx.fillStyle = css.friendly; ctx.fillRect(q[0] - 1.3, q[1] - 1.3, 2.6, 2.6); const m = at(s.target.x, s.target.z); ctx.globalAlpha = .7; ctx.strokeStyle = css.friendly; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m[0] - 3, m[1] - 3); ctx.lineTo(m[0] + 3, m[1] + 3); ctx.moveTo(m[0] + 3, m[1] - 3); ctx.lineTo(m[0] - 3, m[1] + 3); ctx.stroke(); }
    for (const e of S.enemies) { const q = rim(at(e.pos.x, e.pos.z)), urgent = e.eta !== undefined && e.eta < 4.5; if (urgent && (time * 7 % 1) < .4) continue;
      ctx.globalAlpha = 1; ctx.fillStyle = ctx.strokeStyle = e.type === 'smart' ? css.ground : css.enemy;
      if (e.type === 'bomber' || e.type === 'satellite') { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(q[0] - 4.5, q[1] + 2.5); ctx.lineTo(q[0], q[1] - 3.5); ctx.lineTo(q[0] + 4.5, q[1] + 2.5); ctx.stroke(); continue; }
      const low = 1 - Math.min(1, e.pos.y / 560), s = 1.5 + low * 2.2;                                        // the lower it is, the bigger it reads
      if (!q[2]) { const tl = at(e.pos.x - e.vel.x * 1.4, e.pos.z - e.vel.z * 1.4); ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tl[0], tl[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(q[0], q[1], s, 0, TAU); ctx.fill(); }

    ctx.restore();
    // you, and the bezel
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 4.6); ctx.lineTo(0, 2.2); ctx.lineTo(-4.2, 4.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = S.linkLost > 0 ? css.enemy : css.friendly; ctx.globalAlpha = .85; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  // canvas-local CSS pixels → a spot on the map, or null outside the scope
  function toWorld(px, py) { if (!last) return null; const X = px - last.R, Y = py - last.R; if (Math.hypot(X, Y) > last.R) return null; const a = X / last.k, b = -Y / last.k; return { x: last.cx + last.r[0] * a + last.f[0] * b, z: last.cz + last.r[1] * a + last.f[1] * b }; }
  return { draw, fit, toWorld };
}

// The flat layer: reticle, target marks, tower brackets, edge warnings, score pops, the thumb stick.
export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d'); let W = 0, H = 0, dpr = 1; const out = {};
  function fit(w, h) { W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(2, Math.round(w * dpr)); canvas.height = Math.max(2, Math.round(h * dpr)); }
  const edge = (x, y, m) => { const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy, s = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6)); return [cx + dx * s, cy + dy * s, Math.atan2(dy, dx)]; };
  function chevron(x, y, a, col, size) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-size, -size); ctx.lineTo(0, 0); ctx.lineTo(-size, size); ctx.stroke(); ctx.restore(); }

  function draw(S, world, css, time, ui) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); if (!ui.live) return;
    ctx.font = '700 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    for (const t of S.towers) { if (!t.alive) continue; const p = world.project(t.top, out), warn = t.threat < 5, blink = (time * 6 % 1) < .55;
      if (p.on) { const s = warn ? 15 : 11, a = warn ? (blink ? 1 : .35) : .5; ctx.globalAlpha = a; ctx.strokeStyle = warn ? css.enemy : css.friendly; ctx.lineWidth = warn ? 2 : 1.3; ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(p.x + sx * s, p.y + sy * (s - 5)); ctx.lineTo(p.x + sx * s, p.y + sy * s); ctx.lineTo(p.x + sx * (s - 5), p.y + sy * s); } ctx.stroke(); }
      else if (warn && blink) { let x = p.x, y = p.y; if (p.behind) { x = W - x; y = H + 400; } const e = edge(x, y, 26); ctx.globalAlpha = 1; chevron(e[0], e[1], e[2], css.enemy, 9); ctx.fillStyle = css.enemy; ctx.fillText('TOWER', e[0] - Math.cos(e[2]) * 34, e[1] - Math.sin(e[2]) * 22); } }

    for (const e of S.enemies) { if (e.eta === undefined || e.eta > 7 || e.type === 'bomber' || e.type === 'satellite') continue; const p = world.project(e.pos, out); if (p.on) continue;
      let x = p.x, y = p.y; if (p.behind) { x = W - x; y = H + 400; } const q = edge(x, y, 14); ctx.globalAlpha = .45 + .55 * (1 - e.eta / 7); chevron(q[0], q[1], q[2], css.enemy, 5); }

    ctx.lineWidth = 1.6;
    for (const s of S.shots) { const p = world.project(s.target, out); if (!p.on) continue; ctx.globalAlpha = .95; ctx.strokeStyle = css.friendly; ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); ctx.stroke(); }

    for (const p of S.popups) { const q = world.project(p.pos, out); if (!q.on) continue; const u = p.t / p.life; ctx.globalAlpha = 1 - u * u; ctx.fillStyle = p.col === 'ground' ? css.ground : css.friendly; ctx.font = '800 14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'; ctx.fillText(p.text, q.x, q.y - 14 - u * 26); }

    for (const r of ui.ripples) { const u = r.t / .4; ctx.globalAlpha = (1 - u) * .9; ctx.strokeStyle = r.ok ? css.friendly : css.enemy; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, 8 + u * 26, 0, TAU); ctx.stroke(); }

    if (ui.stick) { const s = ui.stick; ctx.globalAlpha = .4; ctx.strokeStyle = css.friendly; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x0, s.y0, 46, 0, TAU); ctx.stroke(); ctx.globalAlpha = .85; ctx.fillStyle = css.friendly; ctx.beginPath(); ctx.arc(s.x0 + s.ix * 46, s.y0 - s.iy * 46, 11, 0, TAU); ctx.fill(); }

    if (ui.reticle) { const { x, y } = ui.reticle, lock = ui.lock, col = S.linkLost > 0 ? css.enemy : css.friendly; ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      for (const pass of [0, 1]) { if (pass) { ctx.strokeStyle = col; ctx.lineWidth = 1.7; } ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); for (const [a, b] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { ctx.moveTo(x + a * 15, y + b * 15); ctx.lineTo(x + a * 23, y + b * 23); } ctx.stroke(); }
      if (lock) { ctx.strokeStyle = css.ground; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(lock.x, lock.y - 8); ctx.lineTo(lock.x + 8, lock.y); ctx.lineTo(lock.x, lock.y + 8); ctx.lineTo(lock.x - 8, lock.y); ctx.closePath(); ctx.stroke(); } }  // the diamond is where the shot will actually burst
    ctx.globalAlpha = 1;
  }
  return { draw, fit };
}
