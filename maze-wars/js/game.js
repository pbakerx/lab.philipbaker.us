/* Maze Wars+ — the game itself: you, your robot, everyone else on the wire, missiles, booths,
   lifts, and the five windows of the 1986 screen.
   Rules of the network, as in the original: nobody is in charge. Each machine owns its own man
   and its own robot, decides for itself when THEY have been hit, and tells the others. */
window.MW = window.MW || {};
(function () {
  const G = MW.gfx, W = MW.world, ui = MW.ui, net = MW.net, A = MW.audio, CHI = MW.FONT.chi, GEN = MW.FONT.gen;
  const DX = W.DX, DY = W.DY;
  const VERBS = ['annihilated', 'exterminated', 'blasted', 'bruised', 'creamed', 'crushed', 'flattened', 'iced', 'mangled', 'massacred', 'nullified', 'pulverized', 'punished', 'quashed', 'routed', 'slaughtered', 'smeared', 'stomped', 'terminated', 'trashed', 'tromped', 'undone', 'whupped', 'zapped', 'zorked'];
  const STOMPS = [5, 6, 17, 20];                                        // the verbs that suit being walked over
  const GRIPES = ['Phooey!', 'Bah Humbug!', 'What a BOZO!', 'Revenge!', 'Fap!', 'Oh Farp.', 'Why ME!', 'No respect at all.', 'Cut that OUT!'];
  const EXCUSES = ['Blind-sided me', 'Surprised me', 'Stupid mistake', 'Sneaky', 'Sheesh.', 'MEOW!!', 'ARF!!', 'Hiss, Boo!'];
  const ROBOTS = ['Alter-Ego', 'Teleporter', 'Hunter', 'Shadow Master'], ROBOT_KIND = ['dome', 'box', 'heavy', 'shadow'], ROBOT_THINK = [400, 420, 300, 340];
  const OPT = { MAZES: 1, BLACKOUT: 2, INVISIBLE: 4, STATIONARY: 8 }, OPT_NAMES = { 1: '4 Mazes', 2: 'Maze Black-out', 4: 'Invisible Neighbors', 8: 'Stationary Radar' };
  const STEP_MS = 165, TURN_MS = 190, MISSILE_MS = 190, RELOAD_MS = 350;
  const KEYS = {
    std: { k: 'fire', ' ': 'fire', t: 'peekR', e: 'peekL', g: 'right', d: 'left', f: 'fwd', r: 'fwd', v: 'back', i: 'north', l: 'east', ',': 'south', j: 'west', a: 'about', u: 'about' },
    typist: { k: 'fire', ' ': 'fire', r: 'peekR', w: 'peekL', f: 'right', s: 'left', d: 'fwd', e: 'fwd', c: 'back', i: 'north', l: 'east', ',': 'south', j: 'west', a: 'about', u: 'about' },
    arrows: { arrowup: 'fwd', arrowdown: 'back', arrowleft: 'left', arrowright: 'right' }
  };
  const HELP = { fire: 'Shoots a missile.', peekR: 'Peeks around the right corner without exposing you.', peekL: 'Peeks around the left corner without exposing you.', right: 'Turns your guy to the right.', left: 'Turns your guy to the left.', fwd: 'Moves your guy forward.', back: 'Backs your guy up.', north: 'Moves your guy North.', east: 'Moves your guy East.', south: 'Moves your guy South.', west: 'Moves your guy West.', about: 'Makes your guy do an about-face.' };

  const store = { get() { try { return JSON.parse(localStorage.getItem('mazewars.v1')) || {}; } catch (e) { return {}; } }, set(o) { try { localStorage.setItem('mazewars.v1', JSON.stringify(o)); } catch (e) { } } };
  const saved = store.get();
  const me = { name: saved.name || '', look: saved.look >= 0 && saved.look < 5 ? saved.look : 1, level: 0, x: 0, y: 0, dir: 0, kills: 0, deaths: 0, alive: false, inMaze: false, arrived: 0, movedAt: 0, reloadAt: 0, shots: 0 };
  const cfg = { robotOn: saved.robotOn !== false, robotType: saved.robotType >= 0 && saved.robotType < 4 ? saved.robotType : 0, typist: !!saved.typist, allEyes: !!saved.allEyes, sound: saved.sound !== false, net: saved.net !== false, zone: '', limit: 0 };
  const robot = { alive: false, level: 0, x: 0, y: 0, dir: 0, thinkAt: 0, backAt: 0, seenAt: 0, jumpAt: 0, arrived: 0, reloadAt: 0 };
  let opts = OPT.MAZES, optClock = 0;
  const others = new Map();     // id -> remote player
  const missiles = [], blasts = [], skulls = [];
  const log = [];               // chat + notices, already wrapped to the Mail Box width
  let phase = 'boot', bootPct = 0, ride = null, poof = 0, peek = 0, boss = false, listTop = 0, lastSent = '', lastSentAt = 0, stateDirty = true, over = false;
  const held = {}; let heldOrder = []; let nextActAt = 0;

  const persist = () => store.set({ name: me.name, look: me.look, robotOn: cfg.robotOn, robotType: cfg.robotType, typist: cfg.typist, allEyes: cfg.allEyes, sound: cfg.sound, net: cfg.net });
  const now = () => performance.now();
  const rint = (n) => Math.floor(Math.random() * n);
  const humans = () => { let n = 0; for (const o of others.values()) if (o.inMaze) n++; return n; };
  const mazesOn = () => (opts & OPT.MAZES) !== 0;

  // ---------------------------------------------------------------- the Mail Box log
  function say(text, from) { const s = from ? from + ': ' + text : text; for (const l of G.wrap(CHI, s, 226)) log.push(l); while (log.length > 60) log.shift(); }
  function notice(text) { say('• ' + text); }

  // ---------------------------------------------------------------- beings
  function beings(includeMe) { // everything a missile or a robot cares about
    const out = []; if (includeMe && me.alive) out.push({ who: 'me', kind: 0, owner: net.id, level: me.level, x: me.x, y: me.y, dir: me.dir });
    if (robot.alive) out.push({ who: 'myrobot', kind: 1, owner: net.id, level: robot.level, x: robot.x, y: robot.y, dir: robot.dir });
    for (const [id, o] of others) { if (o.alive) out.push({ who: id, kind: 0, owner: id, level: o.level, x: o.x, y: o.y, dir: o.dir, o }); if (o.robot) out.push({ who: id + '#r', kind: 1, owner: id, level: o.robot.level, x: o.robot.x, y: o.robot.y, dir: o.robot.dir, o }); }
    return out;
  }
  function occupied(l, x, y) { if (me.alive && me.level === l && me.x === x && me.y === y) return true; for (const b of beings(false)) if (b.level === l && b.x === x && b.y === y) return true; return false; }
  function place(who, level) { const c = W.randomCell(level, Math.random, (x, y) => occupied(level, x, y) || (me.alive && W.los(level, me.x, me.y, me.dir, x, y) > 0)); who.level = level; who.x = c[0]; who.y = c[1]; const ex = W.exits(level, who.x, who.y); who.dir = ex.length ? ex[rint(ex.length)] : 0; who.arrived = now(); }

  function materialize() { place(me, mazesOn() ? me.level : 0); me.alive = true; me.inMaze = true; poof = now() + 350; A.tele(); stateDirty = true; }
  function spawnRobot() { if (!cfg.robotOn) { robot.alive = false; return; } place(robot, mazesOn() ? rint(4) === 0 ? rint(4) : me.level : 0); robot.alive = true; robot.thinkAt = now() + 1200; robot.jumpAt = now() + 9000 + rint(6000); stateDirty = true; }

  // ---------------------------------------------------------------- moving
  function canAct() { return phase === 'play' && me.alive && !ride && !ui.dialog && !boss; }
  function step(dirAbs) {
    if (W.wall(me.level, me.x, me.y, dirAbs)) { A.bump(); return false; }
    me.x += DX[dirAbs]; me.y += DY[dirAbs]; me.arrived = me.movedAt = now(); A.step(); stateDirty = true;
    if (robot.alive && robot.level === me.level && robot.x === me.x && robot.y === me.y && humans() === 0) killRobot(net.id, 0, null, true);
    const t = W.teleDest(me.level, me.x, me.y);
    if (t) { me.x = t.x; me.y = t.y; me.dir = W.exitDir(me.level, me.x, me.y); me.arrived = now(); poof = now() + 350; A.tele(); net.event({ t: 't', l: me.level, x: me.x, y: me.y }); }
    else { const to = W.elevTo(me.level, me.x, me.y); if (to >= 0 && mazesOn()) { ride = { t0: now(), to }; A.lift(); } }
    return true;
  }
  function act(a) {
    if (!canAct()) return; const t = now();
    if (a === 'fire') { if (t >= me.reloadAt && !missiles.some(m => m.mine === 1)) { launch(1, me.level, me.x, me.y, me.dir); me.reloadAt = t + RELOAD_MS; } return; }
    if (a === 'left') { me.dir = (me.dir + 3) & 3; stateDirty = true; }
    else if (a === 'right') { me.dir = (me.dir + 1) & 3; stateDirty = true; }
    else if (a === 'about') { me.dir = (me.dir + 2) & 3; stateDirty = true; }
    else if (a === 'fwd') step(me.dir);
    else if (a === 'back') step((me.dir + 2) & 3);
    else if (a === 'north' || a === 'east' || a === 'south' || a === 'west') { const d = ['north', 'east', 'south', 'west'].indexOf(a); me.dir = d; stateDirty = true; step(d); }
  }

  // ---------------------------------------------------------------- missiles
  // mine: 1 my own, 2 my robot's, 0 somebody else's. Only the machine that owns the VICTIM calls a hit.
  function launch(mine, l, x, y, d) { const mid = net.id + (me.shots++).toString(36); missiles.push({ mid, mine, owner: net.id, ok: mine === 2 ? 1 : 0, level: l, x, y, dir: d, stepAt: now() + 110, holdUntil: 0 }); net.event({ t: 'f', m: mid, k: mine === 2 ? 1 : 0, l, x, y, d }); if (l === me.level) A.shot(loud(x, y)); }
  function loud(x, y) { const d = Math.abs(x - me.x) + Math.abs(y - me.y); return Math.max(0.12, 1 - d / 14); }
  function boom(l, x, y, small) { blasts.push({ level: l, x, y, t0: now() }); if (l === me.level) (small ? A.thud : A.boom)(loud(x, y)); }
  function tickMissiles(t) {
    for (let i = missiles.length - 1; i >= 0; i--) { const m = missiles[i]; if (t < m.stepAt || t < m.holdUntil) continue;
      if (W.wall(m.level, m.x, m.y, m.dir)) { boom(m.level, m.x, m.y, true); missiles.splice(i, 1); continue; }
      m.x += DX[m.dir]; m.y += DY[m.dir]; m.stepAt = t + MISSILE_MS;
      if (me.alive && !ride && m.mine !== 1 && m.level === me.level && m.x === me.x && m.y === me.y) { missiles.splice(i, 1); killMe(m.owner, m.ok, m.mid, false); continue; }
      if (robot.alive && m.mine !== 2 && m.level === robot.level && m.x === robot.x && m.y === robot.y) { missiles.splice(i, 1); killRobot(m.owner, m.ok, m.mid, false); continue; }
      for (const b of beings(false)) if (b.who !== 'myrobot' && b.level === m.level && b.x === m.x && b.y === m.y) { m.holdUntil = t + 380; break; } // their machine gets to call it
    }
    for (let i = blasts.length - 1; i >= 0; i--) if (t - blasts[i].t0 > 620) blasts.splice(i, 1);
    for (let i = skulls.length - 1; i >= 0; i--) if (t - skulls[i].t0 > 2200) skulls.splice(i, 1);
  }

  // ---------------------------------------------------------------- dying, and saying something about it
  function obit(subject, verb, by, byKind, stomp) {
    const who = by === net.id ? (byKind ? 'your robot' : 'you') : ((others.get(by) || {}).name || 'Somebody') + (byKind ? "'s robot" : '');
    if (stomp) return subject + ' ' + VERBS[verb] + ' by ' + who + '.';
    return subject + ' ' + VERBS[verb] + ' by ' + (who === 'you' ? 'your' : who + "'s") + ' missile.';
  }
  function killMe(by, byKind, mid, stomp) {
    if (!me.alive) return; me.alive = false; me.deaths++; const verb = stomp ? STOMPS[rint(STOMPS.length)] : rint(VERBS.length); boom(me.level, me.x, me.y); A.die(); skulls.push({ level: me.level, x: me.x, y: me.y, t0: now() });
    net.event({ t: 'h', w: 0, by, bk: byKind, m: mid, how: stomp ? 1 : 0, v: verb, l: me.level, x: me.x, y: me.y }); stateDirty = true;
    const line = obit('You were', verb, by, byKind, stomp); const killer = by === net.id ? 'Your robot' : ((others.get(by) || {}).name || 'Somebody');
    held.__clear = true; setTimeout(() => showObit(line, killer, by), 900);
  }
  function killRobot(by, byKind, mid, stomp) {
    if (!robot.alive) return; robot.alive = false; robot.backAt = now() + 4500; const verb = stomp ? STOMPS[rint(STOMPS.length)] : rint(VERBS.length); boom(robot.level, robot.x, robot.y); skulls.push({ level: robot.level, x: robot.x, y: robot.y, t0: now() });
    net.event({ t: 'h', w: 1, by, bk: byKind, m: mid, how: stomp ? 1 : 0, v: verb, l: robot.level, x: robot.x, y: robot.y }); stateDirty = true;
    if (by === net.id && !byKind) { me.kills++; A.score(); checkLimit(); }
    notice(obit('Your robot was', verb, by, byKind, stomp));
  }
  function showObit(line, killer, by) {
    if (phase !== 'play') return; const a = GRIPES[rint(GRIPES.length)], b = EXCUSES[rint(EXCUSES.length)];
    const done = (text) => { ui.close(); if (text && by !== net.id) { net.event({ t: 'm', n: me.name, s: text, to: by }); say(text, me.name); } if (!over) materialize(); };
    ui.show({ x: 12, y: 32, w: 236, h: 216, escDefault: true, items: [
      { t: 'text', x: 4, y: 5, w: 228, s: line }, { t: 'text', x: 4, y: 58, w: 228, s: killer + ' appreciates your comments:' },
      { t: 'button', x: 4, y: 95, w: 194, h: 20, label: a, act: () => done(a) }, { t: 'button', x: 4, y: 117, w: 194, h: 20, label: b, act: () => done(b) },
      { t: 'edit', x: 6, y: 146, w: 224, h: 38, multi: true, max: 90, id: 'c' },
      { t: 'button', x: 3, y: 194, w: 70, h: 19, label: 'OK', def: true, act: (d) => done(ui.field('c').value.trim()) }] });
  }
  function checkLimit() { if (!cfg.limit || over) return; let top = me.kills; for (const o of others.values()) top = Math.max(top, o.kills); if (top >= cfg.limit) { over = true; ui.alert('GAME OVER\rThe Score limit was reached.\rUse New to start again.', [{ label: 'OK', def: true }, { label: 'New', act: () => dlgNew() }]); } }

  // ---------------------------------------------------------------- the robot sidekick
  // Alone, it is your opponent. With other people on the wire it is on your side.
  function targets() { const solo = humans() === 0; const out = []; if (solo) { if (me.alive && !ride) out.push({ level: me.level, x: me.x, y: me.y, dir: me.dir }); } else for (const b of beings(false)) if (b.who !== 'myrobot' && b.owner !== net.id) out.push(b); return out.filter(t => t.level === robot.level); }
  function robotStep(d) { if (W.wall(robot.level, robot.x, robot.y, d)) return false; const nx = robot.x + DX[d], ny = robot.y + DY[d]; if (W.isTele(robot.level, nx, ny) || W.elevTo(robot.level, nx, ny) >= 0) return false; robot.dir = d; robot.x = nx; robot.y = ny; robot.arrived = now(); stateDirty = true;
    if (me.alive && !ride && humans() === 0 && me.level === robot.level && me.x === nx && me.y === ny) killMe(net.id, 1, null, true); return true; }
  function wander() { const ex = W.exits(robot.level, robot.x, robot.y).filter(d => { const nx = robot.x + DX[d], ny = robot.y + DY[d]; return !W.isTele(robot.level, nx, ny) && W.elevTo(robot.level, nx, ny) < 0; }); if (!ex.length) return; const fwd = ex.filter(d => d !== ((robot.dir + 2) & 3)); const pick = fwd.length ? (fwd.includes(robot.dir) && Math.random() < 0.7 ? robot.dir : fwd[rint(fwd.length)]) : ex[0]; robotStep(pick); }
  function tickRobot(t) {
    if (!cfg.robotOn) { if (robot.alive) { robot.alive = false; stateDirty = true; } return; }
    if (!robot.alive) { if (t >= robot.backAt && me.inMaze) spawnRobot(); return; }
    if (t < robot.thinkAt) return; const type = cfg.robotType; robot.thinkAt = t + ROBOT_THINK[type] + rint(120);
    const ts = targets(); let best = null, bd = 99, bdir = -1;
    for (const tg of ts) for (let d = 0; d < 4; d++) { const n = W.los(robot.level, robot.x, robot.y, d, tg.x, tg.y, 12); if (n > 0 && n < bd) { bd = n; best = tg; bdir = d; } }
    if (best) { if (robot.dir !== bdir) { robot.dir = bdir; stateDirty = true; robot.seenAt = t; return; }
      if (t - robot.seenAt > (type === 2 ? 250 : 520) && t >= robot.reloadAt && !missiles.some(m => m.mine === 2)) { launch(2, robot.level, robot.x, robot.y, robot.dir); robot.reloadAt = t + 900; }
      else if (type === 2 && bd > 2) robotStep(bdir); return; }
    robot.seenAt = t;
    if (type === 1 && t >= robot.jumpAt) { robot.jumpAt = t + 8000 + rint(7000); const tg = ts[0]; const L = robot.level; let c = null;
      for (let n = 0; n < 30 && !c; n++) { const q = W.randomCell(L); const dd = tg ? Math.abs(q[0] - tg.x) + Math.abs(q[1] - tg.y) : 5; if (dd >= 2 && dd <= 6 && !occupied(L, q[0], q[1])) c = q; }
      if (c) { robot.x = c[0]; robot.y = c[1]; const ex = W.exits(L, c[0], c[1]); robot.dir = ex[rint(ex.length)] || 0; robot.arrived = t; stateDirty = true; if (L === me.level) A.tele(); net.event({ t: 't', l: L, x: c[0], y: c[1] }); return; } }
    if ((type === 2 || type === 3) && ts.length) { let tg = ts[0], dist = 1e9; for (const q of ts) { const dd = Math.abs(q.x - robot.x) + Math.abs(q.y - robot.y); if (dd < dist) { dist = dd; tg = q; } }
      let gx = tg.x, gy = tg.y; if (type === 3) { const bk = (tg.dir + 2) & 3; if (!W.wall(robot.level, tg.x, tg.y, bk)) { gx += DX[bk]; gy += DY[bk]; } } // the Shadow Master comes from behind
      const d = W.route(robot.level, robot.x, robot.y, gx, gy); if (d >= 0 && robotStep(d)) return; }
    if (mazesOn() && Math.random() < 0.004 && humans() === 0 && robot.level !== me.level) { place(robot, me.level); stateDirty = true; return; }
    wander();
  }

  // ---------------------------------------------------------------- the network
  function clampInt(v, lo, hi) { v = v | 0; return v < lo ? lo : v > hi ? hi : v; }
  function sendState(t) { const r = robot.alive ? [cfg.robotType, robot.level, robot.x, robot.y, robot.dir] : 0;
    const s = { n: me.name, a: me.look, l: me.level, x: me.x, y: me.y, d: me.dir, k: me.kills, q: me.deaths, v: me.alive && !ride ? 1 : 0, i: me.inMaze ? 1 : 0, o: opts, oc: optClock, r };
    const j = JSON.stringify(s); if (j === lastSent && t - lastSentAt < 2000) return; if (net.state(s)) { lastSent = j; lastSentAt = t; stateDirty = false; } }
  net.onState = (id, s) => {
    let o = others.get(id); const t = now(); const fresh = !o;
    if (fresh) { if (others.size >= 40) return; o = { name: '?', look: 1, level: 0, x: 0, y: 0, dir: 0, kills: 0, deaths: 0, alive: false, inMaze: false, robot: null, arrived: t, msgs: [] }; others.set(id, o); }
    const name = MW.FONT.clean(s.n, 15).trim() || 'Nobody'; const x = clampInt(s.x, 0, 15), y = clampInt(s.y, 0, 15), l = clampInt(s.l, 0, 3);
    if (W.levels[l].w[y][x] === 15) return;                                                   // nobody stands inside a wall
    if (o.x !== x || o.y !== y || o.level !== l) o.arrived = t;
    o.name = name; o.look = clampInt(s.a, 0, 4); o.level = l; o.x = x; o.y = y; o.dir = clampInt(s.d, 0, 3); o.kills = clampInt(s.k, 0, 9999); o.deaths = clampInt(s.q, 0, 9999); o.alive = s.v === 1; o.inMaze = s.i === 1; o.seen = t;
    if (Array.isArray(s.r) && s.r.length === 5) { const rx = clampInt(s.r[2], 0, 15), ry = clampInt(s.r[3], 0, 15), rl = clampInt(s.r[1], 0, 3); if (W.levels[rl].w[ry][rx] !== 15) { const moved = !o.robot || o.robot.x !== rx || o.robot.y !== ry; o.robot = { type: clampInt(s.r[0], 0, 3), level: rl, x: rx, y: ry, dir: clampInt(s.r[4], 0, 3), arrived: moved ? t : o.robot.arrived }; } } else o.robot = null;
    const oc = +s.oc || 0; if (oc > optClock && oc < Date.now() + 60000) { optClock = oc; opts = clampInt(s.o, 0, 15); }
    if (fresh && o.inMaze) { notice(name + ' joined the game.'); A.mail(); stateDirty = true; }
    // somebody has walked into the cell you were already standing in
    if (me.alive && !ride && o.alive && o.level === me.level && o.x === me.x && o.y === me.y && o.arrived > me.arrived + 60) killMe(id, 0, null, true);
    if (me.alive && !ride && o.robot && o.robot.level === me.level && o.robot.x === me.x && o.robot.y === me.y && o.robot.arrived > me.arrived + 60) killMe(id, 1, null, true);
    checkLimit();
  };
  net.onEvent = (e) => {
    const o = others.get(e.id), t = now();
    if (e.t === 'bye') { if (o) { if (o.inMaze) notice(o.name + ' left the game.'); others.delete(e.id); } return; }
    if (!o) return;
    if (e.t === 'f') { if (typeof e.m !== 'string' || e.m.length > 24 || missiles.length > 80) return; const x = clampInt(e.x, 0, 15), y = clampInt(e.y, 0, 15), l = clampInt(e.l, 0, 3); missiles.push({ mid: e.m, mine: 0, owner: e.id, ok: e.k ? 1 : 0, level: l, x, y, dir: clampInt(e.d, 0, 3), stepAt: t + 60, holdUntil: 0 }); if (l === me.level) A.shot(loud(x, y)); }
    else if (e.t === 'h') { const i = missiles.findIndex(m => m.mid === e.m); if (i >= 0) missiles.splice(i, 1); const x = clampInt(e.x, 0, 15), y = clampInt(e.y, 0, 15), l = clampInt(e.l, 0, 3); boom(l, x, y); skulls.push({ level: l, x, y, t0: t });
      if (e.w === 0) o.alive = false; else o.robot = null;
      if (e.by === net.id) { if (!e.bk) { me.kills++; A.score(); } else { me.kills++; } stateDirty = true; notice((e.bk ? 'Your robot ' : 'You ') + VERBS[clampInt(e.v, 0, VERBS.length - 1)] + ' ' + o.name + (e.w ? "'s robot." : '.')); checkLimit(); } }
    else if (e.t === 'm') { if (e.to && e.to !== net.id) return; const s = MW.FONT.clean(e.s, 120).trim(); if (!s) return; o.msgs = o.msgs.filter(q => t - q < 6000); if (o.msgs.length >= 5) return; o.msgs.push(t); say(s, o.name); A.mail(); }
    else if (e.t === 'o') { const bit = clampInt(e.c, 0, 15); if (OPT_NAMES[bit]) { const on = (clampInt(e.o, 0, 15) & bit) !== 0; notice(bit === OPT.BLACKOUT && on ? 'Blacked-out by ' + o.name + '.' : OPT_NAMES[bit] + (on ? ' switched on by ' : ' switched off by ') + o.name + '.'); } }
    else if (e.t === 't') { if (clampInt(e.l, 0, 3) === me.level) A.tele(); }
  };
  net.onStatus = (s) => { if (s === 'on') { notice('AppleTalk is on' + (net.zone !== 'lobby' ? ', private line ' + net.zone : '') + '.'); stateDirty = true; lastSent = ''; } else if (s === 'off') { others.clear(); } };
  function sweep(t) { for (const [id, o] of others) if (t - o.seen > 9000) { if (o.inMaze) notice(o.name + ' dropped off the network.'); others.delete(id); } }
  function setOpt(bit) { opts ^= bit; optClock = Date.now(); stateDirty = true; net.event({ t: 'o', o: opts, c: bit, n: me.name }); if (bit === OPT.MAZES && !mazesOn() && me.inMaze && me.level !== 0) { me.level = 0; materialize(); } }

  // ---------------------------------------------------------------- dialogs (laid out from the original's)
  function dlgName(after) { ui.show({ x: 126, y: 270, w: 270, h: 62, items: [
      { t: 'text', x: 6, y: 6, s: 'Please Enter Your Name:' }, { t: 'edit', x: 26, y: 30, w: 172, h: 16, max: 15, id: 'n', value: me.name },
      { t: 'button', x: 220, y: 5, w: 40, h: 20, label: 'OK', def: true, act: () => { const v = ui.field('n').value.trim(); if (!v) { A.beep(); return; } me.name = v; persist(); ui.close(); after(); } }] }); }
  function dlgNew() { let reset = true, lim = cfg.limit > 0; ui.show({ x: 6, y: 200, w: 266, h: 128, items: [
      { t: 'text', x: 6, y: 6, s: 'Please Enter Your New Name:' }, { t: 'edit', x: 26, y: 30, w: 172, h: 16, max: 15, id: 'n', value: me.name },
      { t: 'check', x: 24, y: 56, label: 'Reset score (to 0-0)', on: () => reset, set: () => { reset = !reset; } },
      { t: 'check', x: 24, y: 80, label: "Play until someone's score", on: () => lim, set: () => { lim = !lim; } },
      { t: 'text', x: 41, y: 104, s: 'reaches' }, { t: 'edit', x: 100, y: 104, w: 27, h: 16, max: 3, digits: true, id: 'p', value: String(cfg.limit || 10) }, { t: 'text', x: 136, y: 104, s: 'points' },
      { t: 'button', x: 220, y: 5, w: 40, h: 20, label: 'OK', def: true, act: () => { const v = ui.field('n').value.trim(); if (!v) { A.beep(); return; } me.name = v; cfg.limit = lim ? Math.max(1, parseInt(ui.field('p').value, 10) || 10) : 0; if (reset) { me.kills = 0; me.deaths = 0; } over = false; persist(); ui.close(); dlgLook(() => { if (!me.alive) materialize(); stateDirty = true; }); } }] }); }
  function dlgLook(after) { let pick = me.look; const pos = [[8, 115], [102, 115], [217, 114], [63, 212], [169, 212]], art = [['arcade', 0, 0.5, 40], ['eyeball', 0, 0.5, 140], ['mac', 0, 0.5, 230], ['boot', 3, 0.45, 95], ['taxi', 0, 0.52, 200]];
    const pics = art.map(a => MW.art.big(a[0], a[1], a[2]));
    const items = [{ t: 'text', x: 5, y: 3, s: 'Select Your Appearance.' }, { t: 'custom', x: 0, y: 0, w: 282, h: 230, draw: (x, y) => { pics.forEach((b, i) => G.blit(b, x + art[i][3] - (b.w >> 1), y + (i < 3 ? 112 : 210) - b.h)); }, click: (cx, cy) => { for (let i = 0; i < 5; i++) { const b = pics[i], x0 = art[i][3] - (b.w >> 1), y1 = i < 3 ? 112 : 210; if (cx >= x0 && cx < x0 + b.w && cy >= y1 - b.h && cy < y1) pick = i; } } }];
    MW.LOOK_NAMES.forEach((nm, i) => items.push({ t: 'radio', x: pos[i][0], y: pos[i][1], label: nm, on: () => pick === i, set: () => { pick = i; } }));
    items.push({ t: 'button', x: 99, y: 244, w: 66, h: 20, label: 'OK', def: true, act: () => { me.look = pick; persist(); ui.close(); stateDirty = true; if (after) after(); } });
    ui.show({ x: 98, y: 38, w: 282, h: 274, items, escDefault: true, onKey: (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { pick = (pick + 1) % 5; return true; } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { pick = (pick + 4) % 5; return true; } return false; } }); }
  function dlgRobot() { let pick = cfg.robotType; const items = [{ t: 'text', x: 5, y: 2, s: 'Select your robot type.' }, { t: 'text', x: 5, y: 22, s: '1. Choose Robot Type:' }, { t: 'text', x: 5, y: 117, s: '2. Materialize in maze.' }];
    ['Alter-Ego', 'Tardis', 'Hunter', 'Shadow Master'].forEach((nm, i) => items.push({ t: 'radio', x: 21, y: 39 + i * 20, label: nm, on: () => pick === i, set: () => { pick = i; } }));
    items.push({ t: 'button', x: 22, y: 137, w: 66, h: 20, label: 'OK', def: true, act: () => { cfg.robotType = pick; cfg.robotOn = true; robot.alive = false; robot.backAt = 0; persist(); ui.close(); } });
    ui.show({ x: 28, y: 42, w: 182, h: 168, items, escDefault: true }); }
  function dlgMessage() { if (phase !== 'play' || ui.dialog) return; ui.show({ x: 7, y: 268, w: 261, h: 68, plain: true, items: [
      { t: 'text', x: 7, y: 4, s: 'Message:' }, { t: 'edit', x: 9, y: 29, w: 242, h: 34, multi: true, max: 120, id: 'm' },
      { t: 'button', x: 118, y: 2, w: 64, h: 20, label: 'OK', def: true, act: () => { const s = ui.field('m').value.trim(); ui.close(); if (s) { say(s, me.name); if (!net.event({ t: 'm', n: me.name, s }) && cfg.net) notice('Not connected: nobody heard that.'); } } },
      { t: 'button', x: 192, y: 2, w: 64, h: 20, label: 'Cancel', cancel: true, act: () => ui.close() }] }); }
  function dlgTalk() { let on = cfg.net; ui.show({ x: 7, y: 268, w: 261, h: 68, plain: true, items: [
      { t: 'text', x: 1, y: 4, s: 'Apple Talk:' }, { t: 'radio', x: 90, y: 4, label: 'On', on: () => on, set: () => { on = true; } }, { t: 'radio', x: 136, y: 4, label: 'Off', on: () => !on, set: () => { on = false; } },
      { t: 'custom', x: 3, y: 24, w: 190, h: 40, draw: (x, y) => { const st = !cfg.net ? 'AppleTalk is off.' : net.status === 'on' ? 'Apple Talk is on. ' + (humans() + 1) + ' in zone “' + net.zone + '”.' : net.status === 'error' ? 'No answer. Still trying…' : 'Looking for the network…'; G.wrap(GEN, st.replace(/[“”]/g, '"'), 190).forEach((l, k) => G.text(GEN, l, x, y + 10 + k * 13, 1)); } },
      { t: 'button', x: 204, y: 41, w: 55, h: 20, label: 'OK', def: true, act: () => { ui.close(); if (on !== cfg.net) { cfg.net = on; persist(); if (on) net.connect(cfg.zone); else net.disconnect(); } } }], escDefault: true }); }
  function dlgPhone() { ui.show({ x: 7, y: 268, w: 261, h: 68, plain: true, items: [
      { t: 'text', x: 6, y: 6, s: 'Phone#' }, { t: 'edit', x: 71, y: 6, w: 127, h: 15, max: 16, id: 'z', value: cfg.zone },
      { t: 'custom', x: 6, y: 28, w: 190, h: 38, draw: (x, y) => { G.wrap(GEN, cfg.zone ? 'On a private line. Anyone who dials the same number joins you.' : 'Dial any number to open a private line. Friends dial the same one.', 192).forEach((l, k) => G.text(GEN, l, x, y + 9 + k * 12, 1)); } },
      { t: 'button', x: 205, y: 3, w: 55, h: 20, label: 'Dial', def: true, act: () => { const z = net.cleanZone(ui.field('z').value); ui.close(); cfg.zone = z === 'lobby' ? '' : z; cfg.net = true; persist(); others.clear(); net.disconnect(); net.connect(cfg.zone); syncURL(); } },
      { t: 'button', x: 205, y: 25, w: 55, h: 20, label: 'HangUp', act: () => { ui.close(); if (cfg.zone) { cfg.zone = ''; others.clear(); net.disconnect(); if (cfg.net) net.connect(''); syncURL(); } } },
      { t: 'button', x: 205, y: 47, w: 55, h: 20, label: 'OK', cancel: true, act: () => ui.close() }] }); }
  function syncURL() { try { const u = new URL(location.href); if (cfg.zone) u.searchParams.set('line', cfg.zone); else u.searchParams.delete('line'); history.replaceState(null, '', u); } catch (e) { } }
  function dlgKeys() { let msg = 'Press a key to learn its purpose.'; const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm,'];
    ui.show({ x: 106, y: 40, w: 300, h: 250, escDefault: true, onKey: (e) => { if (e.key === 'Enter' || e.key === 'Escape') return false; const k = e.key.toLowerCase(), a = (cfg.typist ? KEYS.typist : KEYS.std)[k] || KEYS.arrows[k]; msg = a ? HELP[a] : (k === 'tab' ? 'Opens the message box.' : 'Useful for typing words.'); ui.dialog.lit = k; return true; }, items: [
      { t: 'custom', x: 10, y: 8, w: 280, h: 100, draw: (x, y) => { const map = cfg.typist ? KEYS.typist : KEYS.std; rows.forEach((r, j) => Array.from(r).forEach((ch, i) => { const kx = x + 12 + j * 9 + i * 26, ky = y + j * 26, a = map[ch]; G.rrect(kx, ky, 23, 23, 4, 1, ui.dialog.lit === ch ? 1 : a ? 0 : G.P.lt); G.textC(CHI, ch.toUpperCase(), kx + 12, ky + 16, ui.dialog.lit === ch ? 0 : 1); }));
          G.rrect(x + 70, y + 80, 140, 18, 4, 1, ui.dialog.lit === ' ' ? 1 : 0); G.textC(GEN, 'space', x + 140, y + 93, ui.dialog.lit === ' ' ? 0 : 1); } },
      { t: 'custom', x: 10, y: 122, w: 280, h: 60, draw: (x, y) => { G.wrap(CHI, msg, 280).forEach((l, k) => G.text(CHI, l, x, y + 11 + k * 16, 1)); } },
      { t: 'text', x: 10, y: 176, w: 280, s: () => (cfg.typist ? 'Touch Typist layout.' : 'Standard layout.') + ' Arrow keys move too; Return opens the message box; click the hall to fire.' },
      { t: 'button', x: 117, y: 224, w: 66, h: 20, label: 'Done', def: true, act: () => ui.close() }] }); }
  function dlgAbout() { const eye = MW.art.big('eyeball', 0, 0.42); ui.show({ x: 86, y: 60, w: 340, h: 216, escDefault: true, items: [
      { t: 'custom', x: 8, y: 6, w: 70, h: 70, draw: (x, y) => G.blit(eye, x, y) },
      { t: 'text', x: 84, y: 8, s: 'Maze Wars+' }, { t: 'text', x: 84, y: 28, w: 250, s: 'A rebuild for the web of the 1986 Macintosh game by MacroMind (Alan McNeil and Burt Sloane), itself a descendant of Maze War, 1973.' },
      { t: 'text', x: 8, y: 98, w: 326, s: 'The four mazes, the rules, the keys and the screen layout follow the original. Every picture was drawn again for this version. AppleTalk is now a public message broker: keep it friendly, and do not type secrets.' },
      { t: 'button', x: 137, y: 190, w: 66, h: 20, label: 'OK', def: true, act: () => ui.close() }] }); }

  // ---------------------------------------------------------------- menus
  const playing = () => phase === 'play';
  ui.menus = [
    { title: '', items: [{ label: 'About Maze Wars+…', action: dlgAbout }, { sep: true }, { label: 'Help with Keys…', action: dlgKeys, enabled: playing }, { label: 'Sound', check: () => cfg.sound, action: () => { cfg.sound = !cfg.sound; A.set(cfg.sound); persist(); } }] },
    { title: 'File', items: [{ label: 'New', key: 'N', action: dlgNew, enabled: playing }, { label: 'Quit', action: () => { net.disconnect(); location.href = '/'; } }] },
    { title: 'Edit', dim: () => !ui.dialog, items: [{ label: 'Undo', key: 'Z', enabled: () => false }, { sep: true }, { label: 'Cut', key: 'X', enabled: () => false }, { label: 'Copy', key: 'C', enabled: () => false }, { label: 'Paste', key: 'V', enabled: () => false }, { label: 'Clear', enabled: () => false }] },
    { title: 'Options', items: [{ label: 'Message…', key: 'M', action: dlgMessage, enabled: playing }, { label: 'Boss is Looking…', key: 'B', action: () => { boss = true; }, enabled: playing }, { sep: true },
        { label: 'Phone…', key: 'P', action: dlgPhone, enabled: playing }, { label: 'AppleTalk…', key: 'A', action: dlgTalk, enabled: playing }, { sep: true },
        { label: '4 Mazes', key: '7', check: () => (opts & 1) !== 0, action: () => setOpt(1), enabled: playing }, { label: 'Maze Black-out', key: '8', check: () => (opts & 2) !== 0, action: () => setOpt(2), enabled: playing }, { label: 'Invisible Neighbors', key: '9', check: () => (opts & 4) !== 0, action: () => setOpt(4), enabled: playing }, { label: 'Stationary Radar', key: '0', check: () => (opts & 8) !== 0, action: () => setOpt(8), enabled: playing }, { sep: true },
        { label: 'Touch Typist', key: 'T', check: () => cfg.typist, action: () => { cfg.typist = !cfg.typist; persist(); } }, { label: 'All Eyes', check: () => cfg.allEyes, action: () => { cfg.allEyes = !cfg.allEyes; persist(); } }] },
    { title: 'Robot', items: ROBOTS.map((nm, i) => ({ label: nm, key: String(i + 1), check: () => cfg.robotType === i, enabled: playing, action: () => { if (cfg.robotType !== i) { cfg.robotType = i; robot.alive = false; robot.backAt = now() + 600; persist(); stateDirty = true; } } })).concat([{ sep: true }, { label: 'Robot Sidekick', check: () => cfg.robotOn, enabled: playing, action: () => { if (cfg.robotOn) { cfg.robotOn = false; persist(); } else dlgRobot(); } }]) }
  ];
  ui.layoutMenus();

  // ---------------------------------------------------------------- drawing the five windows
  const SHADE = [G.P.white, G.P.lt, G.P.desk, G.P.dk];
  const ICON = { // 11x11, drawn facing NORTH; rotated for the other three
    me: ['...........', '..##...##..', '.###...###.', '.###...###.', '###########', '###########', '###########', '.#########.', '.#########.', '..#######..', '....###....'],
    man: ['....###....', '...#.#.#...', '..#..#..#..', '.#...#...#.', '.#.......#.', '.#.......#.', '.#.......#.', '..#.....#..', '...#####...', '...........', '...........'],
    bot: ['...........', '..##...##..', '..##...##..', '..##...##..', '..#######..', '..#######..', '..#######..', '..#######..', '...#####...', '....###....', '...........'],
    shot: ['...........', '.....#.....', '....###....', '....###....', '....###....', '....###....', '...#####...', '...#.#.#...', '...........', '...........', '...........'],
    skull: ['...........', '..#######..', '.#########.', '.##..#..##.', '.##..#..##.', '.#########.', '..###.###..', '...#####...', '...#.#.#...', '...........', '...........']
  };
  // the lift squares on the map carry the shade of the level they go to
  const LIFT = [['#######', '#.....#', '#.....#', '#..#..#', '#.....#', '#.....#', '#######'], ['#######', '#.#.#.#', '#.....#', '#.#.#.#', '#.....#', '#.#.#.#', '#######'],
    ['#######', '#.#.#.#', '##.#.##', '#.#.#.#', '##.#.##', '#.#.#.#', '#######'], ['#######', '#.###.#', '#######', '###.###', '#######', '#.###.#', '#######']];
  const PAC = ['....###....', '..#######..', '.#########.', '.#########.', '#######....', '#######....', '#######....', '.#########.', '.#########.', '..#######..', '....###....'];
  function icon(name, cx, cy, dir, c) { const r = ICON[name]; for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) { if (r[j][i] !== '#') continue; let x = i, y = j; if (dir === 1) { x = 10 - j; y = i; } else if (dir === 2) { x = 10 - i; y = 10 - j; } else if (dir === 3) { x = j; y = 10 - i; } G.pset(cx + x, cy + y, c); } }

  function drawMap(t) {
    const X = 272, Y = 28, L = W.levels[me.level], dark = (opts & OPT.BLACKOUT) !== 0 && phase === 'play';
    G.fill(269, 24, 213, 213, 1); G.clip(X, Y, X + 206, Y + 206); G.fill(X, Y, 206, 206, dark ? 1 : 0);
    if (phase === 'boot' && bootPct <= 0.04) { G.textC(GEN, 'Reading and Drawing Mazes\u2026', X + 103, Y + 40, 1); G.unclip(); return; }
    if (!dark) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = L.w[y][x], x0 = X + x * 13, y0 = Y + y * 13; if (v === 15) { G.fill(x0 - 2, y0 - 2, 15, 15, 1); continue; } if (v & 1) G.fill(x0 + 11, y0 - 2, 2, 15, 1); if (v & 2) G.fill(x0 - 2, y0 + 11, 15, 2, 1); }
      for (const q of L.tele) G.ellipse(X + q.x * 13 + 5, Y + q.y * 13 + 5, 3, 3, 1, 0);
      for (const e of L.elev) { const x0 = X + e.x * 13 + 2, y0 = Y + e.y * 13 + 2, r = LIFT[e.to]; for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) G.pset(x0 + i, y0 + j, r[j][i] === '#' ? 1 : 0); } }
    const ink = dark ? 0 : 1, at = (b) => [X + b.x * 13, Y + b.y * 13];
    const radar = !(opts & OPT.INVISIBLE) && (!(opts & OPT.STATIONARY) || t - me.movedAt > 900);
    for (const s of skulls) if (s.level === me.level) icon('skull', X + s.x * 13, Y + s.y * 13, 0, ink);
    if (radar) for (const [id, o] of others) { if (o.alive && o.level === me.level) icon('man', ...at(o), o.dir, ink); if (o.robot && o.robot.level === me.level && o.robot.type !== 3) icon('bot', ...at(o.robot), o.robot.dir, ink); }
    if (robot.alive && robot.level === me.level && (radar || humans() > 0)) icon('bot', ...at(robot), robot.dir, ink);
    for (const m of missiles) if (m.level === me.level && (m.mine || radar)) icon('shot', ...at(m), m.dir, ink);
    for (const b of blasts) if (b.level === me.level) { const f = Math.min(2, Math.floor((t - b.t0) / 200)); for (let k = 0; k < 9 + f * 5; k++) G.pset(X + b.x * 13 + ((k * 7 + f * 3) % 11), Y + b.y * 13 + ((k * 5 + f) % 11), ink); }
    if (me.inMaze && (me.alive || Math.floor(t / 160) & 1)) icon('me', ...at(me), me.dir, ink);
    G.unclip();
  }
  function drawLevels() {
    const counts = [0, 0, 0, 0], men = [0, 0, 0, 0], bots = [0, 0, 0, 0];
    if (me.inMaze && me.alive) { counts[me.level]++; men[me.level]++; } if (robot.alive) { counts[robot.level]++; bots[robot.level]++; }
    for (const o of others.values()) { if (o.alive) { counts[o.level]++; men[o.level]++; } if (o.robot) { counts[o.robot.level]++; bots[o.robot.level]++; } }
    G.fill(481, 48, 31, 126, 1);
    for (let i = 0; i < 4; i++) { const top = 53 + i * 31, cur = i === me.level && phase === 'play';
      G.fill(481, top - 3, 31, 30, cur ? 0 : SHADE[i]); G.fill(484, top, 28, 24, 0); G.frame(484, top, 28, 24, 1);
      if (!cur) { G.hline(481, 511, top - 4, 1); G.hline(481, 511, top + 27, 1); }
      if (phase !== 'play') continue;
      if (men[i]) { G.fill(488, top + 4, 4, 6, 1); G.fill(487, top + 5, 6, 4, 1); G.fill(491, top + 6, 2, 2, 0); }
      if (bots[i]) { G.fill(487, top + 15, 6, 4, 1); G.fill(491, top + 16, 2, 2, 0); }
      G.textR(GEN, String(counts[i]), 509, top + 16, 1); }
  }
  function drawNames(t) {
    G.fill(13, 264, 254, 78, 1); G.fill(14, 265, 252, 76, 0); G.hline(14, 265, 280, 1);
    G.vline(251, 281, 340, 1); G.hline(251, 266, 295, 1); G.hline(251, 266, 326, 1);
    const arrow = (y, up) => { const pts = up ? [[258, y], [252, y + 6], [255, y + 6], [255, y + 10], [261, y + 10], [261, y + 6], [264, y + 6]] : [[258, y + 10], [252, y + 4], [255, y + 4], [255, y], [261, y], [261, y + 4], [264, y + 4]]; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; G.line(a[0], a[1], b[0], b[1], 1); } };
    arrow(283, true); arrow(328, false);
    if (phase !== 'play') return;
    const all = [{ name: me.name, kills: me.kills, deaths: me.deaths, me: true }]; for (const o of others.values()) if (o.inMaze) all.push(o);
    let lead = null, top = 0; for (const p of all) if (p.kills > top) { top = p.kills; lead = p; }
    const row = (p, y, first) => { const inv = p === lead; if (inv) G.fill(14, y - 9, 238, 12, 1); const c = inv ? 0 : 1;
      G.text(GEN, G.fit(GEN, p.name, 128), 17, y, c); G.text(GEN, p.kills + '-' + p.deaths, 207, y, c);
      if (first) { for (let k = 0; k < 4; k++) G.text(GEN, (opts >> k) & 1 ? '\u25C6' : '\u25C7', 151 + k * 9, y, c); for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) if (PAC[j][i] === '#') G.pset(254 + i, 267 + j, 1); } };
    row(all[0], 275, true);
    const rest = all.slice(1).sort((a, b) => b.kills - a.kills); listTop = Math.max(0, Math.min(listTop, rest.length - 5));
    for (let k = 0; k < 5 && k + listTop < rest.length; k++) row(rest[k + listTop], 292 + k * 12, false);
    if (!rest.length) { G.text(GEN, net.status === 'on' ? 'Nobody else is on the network yet.' : cfg.net ? 'Looking for the network…' : 'AppleTalk is off.', 17, 296, 1); G.text(GEN, cfg.robotOn ? 'Your robot will keep you company.' : 'Robot menu: Robot Sidekick.', 17, 310, 1); }
  }
  function phoneIcon(x, y, live) { const p = live ? 0 : G.P.desk; G.rrect(x + 3, y + 4, 26, 9, 4, 1, p); G.fill(x + 8, y + 9, 16, 5, 0); G.hline(x + 8, x + 23, y + 9, 1);
    G.poly([[x + 8, y + 13], [x + 24, y + 13], [x + 29, y + 24], [x + 3, y + 24]], p === 0 ? 0 : p); G.line(x + 8, y + 13, x + 3, y + 24, 1); G.line(x + 23, y + 13, x + 28, y + 24, 1); G.hline(x + 3, x + 28, y + 24, 1); G.hline(x + 8, x + 23, y + 13, 1);
    if (live) G.ellipse(x + 16, y + 18, 4, 3, 1, 0); for (let i = 0; i < 8; i++) { if (i & 1) G.ellipse(x + 4 + i * 3 + 1, y + 28, 1, 2, 1, 0); else G.vline(x + 4 + i * 3 + 1, y + 26, y + 30, 1); } }
  function macIcon(x, y, st) { G.fill(x + 7, y + 2, 17, 20, 0); G.frame(x + 7, y + 2, 17, 20, 1); G.frame(x + 9, y + 4, 13, 10, 1); G.hline(x + 16, x + 21, y + 17, 1); G.fill(x + 6, y + 22, 19, 3, 0); G.frame(x + 6, y + 22, 19, 3, 1);
    if (st === 'on') { G.vline(x + 27, y + 20, y + 28, 1); G.fill(x + 26, y + 17, 3, 4, 1); G.hline(x + 1, x + 30, y + 29, 1); G.hline(x + 1, x + 30, y + 30, 1); G.line(x + 24, y + 23, x + 27, y + 23, 1); }
    else if (st === 'off') { for (let i = x + 1; i < x + 30; i += 3) G.pset(i, y + 29, 1); } else G.text(CHI, '?', x + 13, y + 13, 1); }
  function drawMail() {
    G.fill(269, 242, 241, 100, 1); G.fill(270, 243, 238, 97, 0); G.hline(270, 507, 275, 1); G.vline(302, 243, 274, 1); G.vline(475, 243, 274, 1);
    phoneIcon(270, 243, !!cfg.zone && net.status === 'on'); macIcon(476, 243, !cfg.net ? 'off' : net.status === 'on' ? 'on' : 'wait');
    G.text(CHI, '•', 365, 254, 1); G.text(GEN, 'Mail', 377, 254, 1); G.text(CHI, '•', 407, 254, 1); G.text(CHI, '•', 367, 270, 1); G.text(GEN, 'Box', 379, 270, 1); G.text(CHI, '•', 405, 270, 1);
    G.text(CHI, 'Click this spot to send messages.', 276, 288, 1);
    const tail = log.slice(-3); tail.forEach((l, k) => G.text(CHI, l, 276, 304 + k * 16, 1));
  }
  function drawHall(t) {
    G.fill(15, 25, 251, 237, 1);
    if (phase === 'boot') { G.fill(16, 26, 249, 235, 0); if (bootPct > 0.04) { G.text(GEN, "Reading MW Cast\u2026 (it's big!)", 30, 60, 1); G.frame(30, 72, 122, 9, 1); G.fill(31, 73, Math.round(120 * bootPct), 7, G.P.desk); } return; }
    if (phase !== 'play') { G.fill(16, 26, 249, 235, 0); return; }
    if (ride) { MW.hall.elevator(Math.min(1, (t - ride.t0) / 1300), t - ride.t0 < 650); return; }
    let vx = me.x, vy = me.y, vd = me.dir;
    if (peek && me.alive) { if (!W.wall(me.level, vx, vy, vd)) { vx += DX[vd]; vy += DY[vd]; } vd = (vd + (peek > 0 ? 1 : 3)) & 3; }
    const L = W.levels[me.level];
    MW.hall.draw({ L, x: vx, y: vy, dir: vd, elevOk: mazesOn(), things: (x, y) => { const out = []; const booth = W.isTele(me.level, x, y); if (booth) out.push({ kind: 'box', dir: 0 });
        for (const b of beings(false)) if (b.level === me.level && b.x === x && b.y === y && !booth) out.push({ kind: b.kind ? ROBOT_KIND[b.who === 'myrobot' ? cfg.robotType : b.o.robot.type] : (cfg.allEyes ? 'eyeball' : MW.LOOKS[b.o.look]), dir: b.dir });
        if (peek && me.alive && me.x === x && me.y === y) out.push({ kind: cfg.allEyes ? 'eyeball' : MW.LOOKS[me.look], dir: me.dir });
        for (const m of missiles) if (m.level === me.level && m.x === x && m.y === y) out.push({ kind: 'missile', dir: m.dir });
        for (const b of blasts) if (b.level === me.level && b.x === x && b.y === y) out.push({ kind: 'blast', frame: Math.min(2, Math.floor((t - b.t0) / 200)) });
        return out; } });
    if (t < poof) { const n = Math.floor((poof - t) / 50); for (let y = 26; y <= 260; y++) if (((y >> 2) + n) % 3 === 0) G.hline(16, 264, y, 2); }
    if (!me.alive) for (let y = 26; y <= 260; y += 2) G.hline(16, 264, y, 2);
  }
  function drawBoss() { G.fill(0, 21, 512, 321, G.P.desk); G.fill(20, 30, 472, 300, 0); G.frame(20, 30, 472, 300, 1); G.fill(21, 31, 470, 18, 0); for (let y = 34; y < 46; y += 2) G.hline(24, 487, y, 1); G.hline(20, 491, 49, 1);
    const tw = G.textW(CHI, 'Budget 1987') + 16; G.fill(256 - tw / 2, 32, tw, 16, 0); G.textC(CHI, 'Budget 1987', 256, 44, 1); G.fill(28, 34, 11, 11, 0); G.frame(28, 34, 11, 11, 1);
    const cols = ['', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'], rows = ['Salaries', 'Rent', 'Floppies', 'Phone', 'Travel', 'AppleTalk kit', 'Coffee', 'Printing', 'Postage', 'Software', 'Repairs', 'Sundries', 'TOTAL'];
    for (let c = 0; c <= 6; c++) G.vline(20 + (c === 0 ? 0 : 100 + (c - 1) * 74), 50, 329, 1); for (let r = 0; r <= 14; r++) G.hline(20, 491, 50 + r * 20, 1);
    cols.forEach((s, c) => { if (s) G.textC(CHI, s, 157 + (c - 1) * 74, 64, 1); });
    rows.forEach((s, r) => { G.text(GEN, s, 26, 84 + r * 20, 1); let sum = 0; for (let c = 0; c < 5; c++) { const v = c < 4 ? ((r * 37 + c * 53) % 90 + 10) * (r === 12 ? 12 : 1) * 10 : sum; sum += c < 4 ? v : 0; G.textR(GEN, String(v), 186 + c * 74, 84 + r * 20, 1); } });
    G.fill(150, 300, 212, 22, 0); G.frame(150, 300, 212, 22, 1); G.textC(GEN, 'Click anywhere when the coast is clear.', 256, 315, 1); }

  // ---------------------------------------------------------------- the frame
  function frame(t) {
    if (held.__clear) { for (const k in held) delete held[k]; heldOrder = []; peek = 0; }
    if (phase === 'play') {
      if (ride && t - ride.t0 > 1300) { me.level = ride.to; me.dir = W.exitDir(me.level, me.x, me.y); me.arrived = t; ride = null; stateDirty = true; }
      if (canAct() && heldOrder.length && t >= nextActAt) { const a = heldOrder[heldOrder.length - 1]; act(a); nextActAt = t + (a === 'fwd' || a === 'back' || a === 'north' || a === 'east' || a === 'south' || a === 'west' ? STEP_MS : a === 'fire' ? 120 : TURN_MS); }
      tickMissiles(t); tickRobot(t); sweep(t);
      if (net.status === 'on' && (stateDirty || t - lastSentAt > 2000) && t - lastSentAt > 70) sendState(t);
    }
    if (boss) { drawBoss(); ui.cursor = 'arrow'; }
    else { G.fill(0, 21, 512, 321, G.P.desk); drawHall(t); drawMap(t); drawLevels(); drawNames(t); drawMail();
      const m = ui.mouse; ui.cursor = (phase === 'play' && m.x >= 16 && m.x <= 264 && m.y >= 26 && m.y <= 260) ? 'cross' : 'arrow'; }
    ui.draw(t); ui.drawPointer(); G.present();
  }

  // ---------------------------------------------------------------- input
  function keyAction(e) { const k = e.key.toLowerCase(); return KEYS.arrows[k] || (cfg.typist ? KEYS.typist : KEYS.std)[k]; }
  const game = MW.game = {
    me, cfg, others, robot, missiles, frame, act, say,
    dev: { get opts() { return opts; }, set opts(v) { opts = v & 15; }, get phase() { return phase; }, log },   // for poking at from the console
    keydown(e) {
      A.unlock(); if (boss) { boss = false; e.preventDefault(); return; }
      if (ui.key(e)) { e.preventDefault(); return; }
      if (phase !== 'play' || ui.dialog || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); dlgMessage(); return; }
      const a = keyAction(e); if (!a) return; e.preventDefault(); if (e.repeat) return;
      if (a === 'peekR') { peek = 1; return; } if (a === 'peekL') { peek = -1; return; }
      if (!held[a]) { held[a] = true; heldOrder.push(a); act(a); nextActAt = now() + (a === 'fire' ? 120 : 260); }
    },
    keyup(e) { const a = keyAction(e); if (!a) return; if (a === 'peekR' || a === 'peekL') { peek = 0; return; } delete held[a]; heldOrder = heldOrder.filter(q => q !== a); },
    blur() { held.__clear = true; },
    down(x, y) { A.unlock(); if (boss) { boss = false; return; } if (ui.down(x, y)) return; if (phase !== 'play') return;
      if (x >= 16 && x <= 264 && y >= 26 && y <= 260) act('fire');
      else if (x >= 270 && x <= 301 && y >= 243 && y <= 274) dlgPhone(); else if (x >= 476 && x <= 507 && y >= 243 && y <= 274) dlgTalk();
      else if (x >= 270 && x <= 507 && y >= 276 && y <= 340) dlgMessage();
      else if (x >= 252 && x <= 265 && y >= 281 && y <= 294) listTop--; else if (x >= 252 && x <= 265 && y >= 327 && y <= 340) listTop++; },
    // touch pad buttons hold an action the way a held key does
    press(a, on) { A.unlock(); if (a === 'msg') { if (on) dlgMessage(); return; } if (on) { if (!held[a]) { held[a] = true; heldOrder.push(a); act(a); nextActAt = now() + 260; } } else { delete held[a]; heldOrder = heldOrder.filter(q => q !== a); } },
    // ?shot=1 — a posed scene with no dialogs and no network: what the social card is photographed from
    demo() { me.name = 'Philip'; me.look = 1; cfg.robotOn = false; cfg.net = false; phase = 'play'; ui.busy = false; ui.mouse.seen = false; opts = 1;
      Object.assign(me, { level: 0, x: 10, y: 11, dir: 3, alive: true, inMaze: true, kills: 2, deaths: 1 });
      others.set('demo01', { name: 'Bert', look: 1, level: 0, x: 8, y: 11, dir: 1, kills: 3, deaths: 2, alive: true, inMaze: true, robot: { type: 0, level: 0, x: 5, y: 11, dir: 1, arrived: 0 }, arrived: 0, seen: 1e15, msgs: [] });
      others.set('demo02', { name: 'Devorah', look: 4, level: 2, x: 3, y: 3, dir: 0, kills: 1, deaths: 3, alive: true, inMaze: true, robot: null, arrived: 0, seen: 1e15, msgs: [] });
      log.length = 0; say('There you are.', 'Bert'); say('Not for long.', 'Philip'); },
    start() {
      try { const z = new URL(location.href).searchParams.get('line'); if (z) cfg.zone = net.cleanZone(z) === 'lobby' ? '' : net.cleanZone(z); } catch (e) { }
      A.on = cfg.sound; const warm = MW.art.warm(); ui.busy = true;
      const pump = () => { const t0 = now(); let r; do { r = warm.next(); if (!r.done) bootPct = r.value; } while (!r.done && now() - t0 < 12);
        if (!r.done) { setTimeout(pump, 0); return; }
        ui.busy = false; phase = 'ready'; dlgName(() => dlgLook(() => { phase = 'play'; materialize(); notice('Welcome, ' + me.name + '. F forward, D and G turn, K or Space fires.'); if (cfg.net) net.connect(cfg.zone); else notice('AppleTalk is off (Options menu).'); })); };
      setTimeout(pump, 350);
    }
  };
})();
