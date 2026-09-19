/* The four levels as something you can walk around in: walls, teleporters, elevators,
   line of sight and a breadth-first route finder for the robots. No drawing, no network. */
window.MW = window.MW || {};
(function () {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], BIT = [8, 1, 2, 4];   // N E S W
  const levels = MW.LEVELS.map((src) => {
    const w = src.walls.map(r => Array.from(r, ch => parseInt(ch, 16)));
    const L = { w, tele: src.tele.map(t => ({ x: t[0], y: t[1], g: t[2] })), elev: src.elev.map(e => ({ x: e[0], y: e[1], to: e[2] })), teleAt: {}, elevAt: {}, elevFace: {}, open: [] };
    L.tele.forEach((t, i) => { L.teleAt[t.y * 16 + t.x] = i; });
    L.elev.forEach((e) => { const k = e.y * 16 + e.x; L.elevAt[k] = e.to; let face = 0; for (let d = 0; d < 4; d++) if (!(w[e.y][e.x] & BIT[d])) face = (d + 2) & 3; L.elevFace[k] = face; });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (w[y][x] !== 15 && L.teleAt[y * 16 + x] === undefined && L.elevAt[y * 16 + x] === undefined) L.open.push([x, y]);
    return L;
  });
  const W = MW.world = {
    DX, DY, BIT, levels,
    wall(l, x, y, dir) { if (x < 0 || y < 0 || x > 15 || y > 15) return true; return (levels[l].w[y][x] & BIT[dir]) !== 0; },
    isTele(l, x, y) { return levels[l].teleAt[y * 16 + x] !== undefined; },
    elevTo(l, x, y) { const t = levels[l].elevAt[y * 16 + x]; return t === undefined ? -1 : t; },
    // teleporters sharing a group number pass you round the group; a lone one hands you to the next booth on the level
    teleDest(l, x, y) { const L = levels[l], i = L.teleAt[y * 16 + x]; if (i === undefined) return null; const me = L.tele[i];
      const grp = L.tele.filter(t => t.g === me.g); const ring = grp.length > 1 ? grp : L.tele; if (ring.length < 2) return null;
      return ring[(ring.indexOf(me) + 1) % ring.length]; },
    // stepping OUT of a booth: the one open side
    exitDir(l, x, y) { for (let d = 0; d < 4; d++) if (!W.wall(l, x, y, d)) return d; return 0; },
    randomCell(l, rnd, avoid) { const L = levels[l]; for (let n = 0; n < 40; n++) { const c = L.open[Math.floor((rnd || Math.random)() * L.open.length)]; if (!avoid || !avoid(c[0], c[1])) return c; } return L.open[0]; },
    // how many cells ahead (1..n) the target sits in a straight clear line, else -1
    los(l, x, y, dir, tx, ty, max) { for (let n = 1; n <= (max || 16); n++) { if (W.wall(l, x, y, dir)) return -1; x += DX[dir]; y += DY[dir]; if (x === tx && y === ty) return n; } return -1; },
    // first step of a shortest route; -1 if already there or walled off. Booths and lifts are not walked through.
    route(l, x, y, tx, ty) { if (x === tx && y === ty) return -1; const L = levels[l], prev = new Int16Array(256).fill(-1), first = new Int8Array(256).fill(-1); const q = [y * 16 + x]; prev[q[0]] = q[0];
      for (let qi = 0; qi < q.length; qi++) { const c = q[qi], cx = c & 15, cy = c >> 4;
        for (let d = 0; d < 4; d++) { if (L.w[cy][cx] & BIT[d]) continue; const nx = cx + DX[d], ny = cy + DY[d], k = ny * 16 + nx; if (prev[k] !== -1) continue;
          if ((L.teleAt[k] !== undefined || L.elevAt[k] !== undefined) && !(nx === tx && ny === ty)) continue;
          prev[k] = c; first[k] = c === q[0] ? d : first[c]; if (nx === tx && ny === ty) return first[k]; q.push(k); } }
      return -1; },
    exits(l, x, y) { const o = []; for (let d = 0; d < 4; d++) if (!W.wall(l, x, y, d)) o.push(d); return o; }
  };
})();
