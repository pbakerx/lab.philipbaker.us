/* Thumbs — the house AI. When somebody finds the public maze empty, Thumbs joins four seconds later, plays them like a person
   would, and talks. The moment a second real player arrives he says goodbye and leaves: he is here so that nobody's first visit
   is to an empty room, never instead of people.

   WHERE HE LIVES. Thumbs only ever exists while exactly one human is present, so nothing about him needs to cross the network:
   his body is an entry in the game's `others` map that THIS browser moves, and every rule that would be settled by "the machine
   that owns the victim" is settled here. To the rest of the game he is simply another player — same roster row, same map dot,
   same sprites, same obituary — which is why none of the interface changed. His id starts with '~', which can never arrive over
   the wire (inbound ids must match /^[a-z0-9]{4,12}$/), so nobody can send us a fake one.

   WHAT HE IS NOT. He is not a robot sidekick (those are untouched; yours sides with you against him, as it would against anyone),
   and he never passes as a person. His first line — a fixed template below, NOT the model's — says he is an AI; api/thumbs.js
   holds the other two locks. The name is Philip's: "Thumbs" was a stray test player of Claude's that lay dead in his lobby for
   an hour and a half on Sep 20 2026, and he liked it. */
window.MW = window.MW || {};
(function () {
  const W = MW.world, A = MW.audio, net = MW.net, game = MW.game, X = game.x, DX = W.DX, DY = W.DY;
  const ID = '~thumbs', NAME = 'Thumbs', LOOK = 2;      // look 2 is the little Macintosh: the house AI is the house computer
  const JOIN_AFTER = 4000;                               // Philip, the morning after: "Make the bot come in at 4 seconds." (It was 8 for his first day.) Players send a heartbeat every 2 s, so 4 is still long enough to have heard anyone who is really here.
  const API = '/api/thumbs';
  const rnd = (a, b) => a + Math.random() * (b - a), chance = (p) => Math.random() < p, now = () => performance.now();
  // Every one of these says "AI". That is the point of their being templates: see api/thumbs.js.
  const HELLOS = [
    "hey {n}. i'm thumbs, the house AI. nobody else is on, so you get me. good luck.",
    "hi {n}! thumbs here - i'm the AI that keeps the maze warm when it's empty. come find me.",
    "yo {n}. i'm thumbs, the resident AI. no humans around right now, so it's you and me.",
    "{n}! welcome. i'm thumbs, the maze's AI. fair warning: i shoot back.",
    "oh good, company. i'm thumbs, the house AI. i'll keep you busy till a real person shows up, {n}."
  ];
  // Philip, Sep 21 2026: "have him occasionally prompt the user to invite friends to play by using the file menu". It is the point of him:
  // he is here so the room is not empty, and the cure for an empty room is people. The model words it (so it is never the same line);
  // these stand in when the model is quiet, capped or off — the invitation must not depend on it. No '>' : the chat font has none.
  const INVITES = ["this is more fun with real people. File menu, Invite a Friend - it gives you a link to send. i'll step aside.",
    "know anyone who'd like this? File menu, Invite a Friend. the moment a human shows up, i bow out.",
    "i'm decent practice, but people are better. File menu, Invite a Friend - send somebody the link."];
  const BYES = ["real people just showed up, so i'm off. have fun, {n}.", "a human! that's my cue. good game, {n}.", "you've got a real opponent now. later, {n}."];

  let o = null;                 // his entry in `others`, or null while he is not here
  let mode = 'absent';          // absent | here | leaving
  let aloneSince = 0, offlineSince = 0, joinedAt = 0;
  let nextAt = 0, lockedAt = 0, lockedDir = -1, reloadAt = 0, deadUntil = 0, ride = null, mercyUntil = 0, planAt = 0, plan = -1, followAt = 0, shots = 0;
  let typingUntil = 0, dodged = new Set(), anywhere = false;     // anywhere: tests only — lets him onto a private line, so that a test never puts a stray player in the public maze
  // talking
  let sid = '', seq = 0, hist = [], asked = 0, busy = false, queued = null, lastLineAt = 0, unprompted = 0, lastTalkAt = 0, nudges = 0, spoke = 0, ended = true, inviteAt = 0, invites = 0;

  const me = game.me, others = game.others, missiles = game.missiles;
  const realPlayers = () => { let n = 0; for (const p of others.values()) if (!p.local && p.inMaze && !p.idle) n++; return n; };   // someone whose window is in the background is not someone to play
  const lobby = () => !game.cfg.zone || anywhere;
  const wanted = () => X.phase() === 'play' && me.inMaze && game.cfg.net && lobby() && net.status === 'on' && realPlayers() === 0;
  const blind = () => (X.opts() & (X.OPT.BLACKOUT | X.OPT.INVISIBLE)) !== 0;                                                  // options that hide players from the map hide them from him too
  const fill = (s) => s.replace('{n}', me.name || 'you');

  // ------------------------------------------------------------------ coming and going
  function join(t) {
    o = { name: NAME, look: LOOK, level: 0, x: 0, y: 0, dir: 0, kills: 0, deaths: 0, alive: true, inMaze: true, robot: null, arrived: t, seen: t, msgs: [], idle: false, local: true };
    X.place(o, X.mazesOn() ? me.level : 0); others.set(ID, o); mode = 'here'; joinedAt = t; nextAt = t + rnd(1500, 2600); mercyUntil = t + 5000; ride = null; deadUntil = 0; dodged = new Set();
    sid = ''; for (let i = 0; i < 20; i++) sid += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; seq = 0; hist = []; asked = 0; unprompted = 0; nudges = 0; busy = false; queued = null; lastTalkAt = t; spoke = 0; ended = false; invites = 0; inviteAt = t + rnd(150000, 240000);      // the first pitch comes a few minutes in, once there is a game going
    game.notice(NAME + ' joined the game.'); A.mail();
    const hello = fill(HELLOS[Math.floor(Math.random() * HELLOS.length)]); typingUntil = t + rnd(1600, 2400);
    setTimeout(() => { if (mode === 'here' && o) { speak(hello); post({ kind: 'hello', line: hello }); } }, typingUntil - t);
  }
  // The talk is over: ask the server to mail Philip the transcript. Once per talk, and only if the player said anything. A beacon,
  // because one of the ways a talk ends is the page closing.
  function endTalk() { if (ended || !sid || !spoke) return; ended = true; const body = JSON.stringify({ op: 'end', sid });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'application/json' })))) fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => { }); } catch (e) { } }
  function gone(why) { endTalk(); if (o && others.get(ID) === o) { others.delete(ID); if (why) game.notice(NAME + why); } o = null; mode = 'absent'; aloneSince = 0; offlineSince = 0; for (let i = missiles.length - 1; i >= 0; i--) if (missiles[i].owner === ID) missiles.splice(i, 1); }
  function leave(t) { // a real player has arrived: stop fighting at once, say goodbye, go
    mode = 'leaving'; const canned = fill(BYES[Math.floor(Math.random() * BYES.length)]); let said = false; const say1 = (s) => { if (said || !o) return; said = true; speak(s); setTimeout(() => gone(' left the game.'), 1400); };
    post({ kind: 'bye' }).then((r) => say1(r && r.line ? r.line : canned)); setTimeout(() => say1(canned), 2600);
  }

  // ------------------------------------------------------------------ talking
  function speak(line) { line = MW.FONT.clean(String(line || ''), 120).trim(); if (!line || !o) return; game.say(line, NAME); A.mail(); hist.push({ w: 't', s: line }); if (hist.length > 14) hist.shift(); lastLineAt = lastTalkAt = now(); }
  function context() { const note = me.level === o.level ? 'You are both on level ' + (o.level + 1) + '.' : me.name + ' is on level ' + (me.level + 1) + ' and you are on level ' + (o.level + 1) + '.';
    return { pk: me.kills, pd: me.deaths, tk: o.kills, td: o.deaths, mins: Math.round((now() - joinedAt) / 60000), note: note + (o.alive ? '' : ' You are dead at the moment, about to rematerialize.') + (me.alive ? '' : ' ' + me.name + ' is dead at the moment.') }; }
  async function post(body) { if (!o) return null; const h = hist.slice(-13); if (body.kind === 'reply') { for (let i = h.length - 1; i >= 0; i--) if (h[i].w === 'p' && h[i].s === body.text) { h.splice(i, 1); break; } }      // the line being answered travels as `text`, not twice — and it may not be the newest entry: his reply to an EARLIER line can land after it
    try { const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ op: 'say', sid, seq: seq++, name: me.name, ctx: context(), hist: h.slice(-12) }, body)) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  // one request at a time; if the player says more while he is "typing", he answers the latest
  async function ask(kind, text, fallback) {
    if (!o || mode !== 'here' || asked >= 60) return; if (busy) { if (kind === 'reply') queued = text; return; }
    busy = true; asked++; const mine = o, t0 = now(); const r = await post({ kind, text }); const line = (r && r.line) || fallback || null; if (kind === 'event' && o === mine) hist.push({ w: 'g', s: text });
    if (line && o === mine && mode === 'here') { const wait = Math.max(0, Math.min(3800, 700 + line.length * 38) - (now() - t0)); if (kind === 'reply') typingUntil = now() + wait; setTimeout(() => { if (o === mine && mode === 'here') speak(line); }, wait); await new Promise((res) => setTimeout(res, wait + 400)); }
    busy = false; if (queued && o === mine) { const q = queued; queued = null; ask('reply', q); }
  }
  function remark(text, p) { const t = now(); if (!o || mode !== 'here' || busy || unprompted >= 10 || t - lastLineAt < 20000 || !chance(p)) return; unprompted++; ask('event', text); }

  // ------------------------------------------------------------------ what the game tells him
  function heard(text) { if (!o || mode !== 'here') return; text = String(text || '').trim(); if (!text) return; spoke++; hist.push({ w: 'p', s: text }); if (hist.length > 14) hist.shift(); lastTalkAt = now(); ask('reply', text); }
  function die(by, robotDid, stomp) { // a missile reached him, or he was walked over. This machine is the one that says so.
    if (!o || !o.alive) return; const t = now(); o.alive = false; o.deaths++; deadUntil = t + rnd(2600, 5200); ride = null; X.boom(o.level, o.x, o.y); X.skull(o.level, o.x, o.y);
    const verb = stomp ? X.STOMPS[X.rint(X.STOMPS.length)] : X.rint(X.VERBS.length), word = X.VERBS[verb] === 'undone' ? 'undid' : X.VERBS[verb];
    if (by === net.id) { if (!robotDid) { me.kills++; A.score(); MW.club.kill(); } game.notice((robotDid ? 'Your robot ' : 'You ') + word + ' ' + NAME + '.'); X.checkLimit(); }
    remark(robotDid ? me.name + "'s robot sidekick just shot you." : stomp ? me.name + ' just walked right over you. You are out until you rematerialize.' : me.name + ' just shot you. You are out until you rematerialize.', 0.5);
  }
  function hit(m) { die(m.owner, m.mine === 2, false); }
  function steppedOn(l, x, y) { if (o && o.alive && mode !== 'absent' && !ride && o.level === l && o.x === x && o.y === y) die(net.id, false, true); }
  function scored(stomp) { if (!o) return; mercyUntil = now() + 6000; X.checkLimit(); remark(stomp ? 'You just walked right over ' + me.name + '.' : 'You just shot ' + me.name + '.', 0.4); }

  // ------------------------------------------------------------------ the body
  const open = (l, x, y, d) => { if (W.wall(l, x, y, d)) return false; const nx = x + DX[d], ny = y + DY[d]; return !W.isTele(l, nx, ny) && W.elevTo(l, nx, ny) < 0; };
  function walk(d, t, intoLift) {
    if (W.wall(o.level, o.x, o.y, d)) return false; const nx = o.x + DX[d], ny = o.y + DY[d]; if (!intoLift && (W.isTele(o.level, nx, ny) || W.elevTo(o.level, nx, ny) >= 0)) return false;
    o.x = nx; o.y = ny; o.arrived = t;
    if (me.alive && !X.riding() && me.level === o.level && me.x === nx && me.y === ny) { X.killMe(ID, 0, null, true); return true; }     // he walked into the cell you were standing in
    const to = W.elevTo(o.level, nx, ny); if (to >= 0 && X.mazesOn()) { ride = { until: t + 1300, to }; o.alive = false; if (o.level === me.level) A.lift(); }     // in the lift: out of the maze for 1.3 s, as a real player's state says (v:0)
    return true;
  }
  function fire(t) { missiles.push({ mid: 'th' + (shots++).toString(36), mine: 0, owner: ID, ok: 0, level: o.level, x: o.x, y: o.y, dir: o.dir, stepAt: t + 110, holdUntil: 0 }); if (o.level === me.level) A.shot(X.loud(o.x, o.y)); reloadAt = t + 350 + rnd(120, 520); }
  // a missile coming straight down his corridor, close enough to matter
  function threat() { for (const m of missiles) { if (m.owner === ID || m.level !== o.level || dodged.has(m.mid)) continue; const n = W.los(m.level, m.x, m.y, m.dir, o.x, o.y, 7); if (n > 0) return { m, n }; } return null; }
  function wander(t) { const ex = [0, 1, 2, 3].filter((d) => open(o.level, o.x, o.y, d)); if (!ex.length) return; const fwd = ex.filter((d) => d !== ((o.dir + 2) & 3)); const d = fwd.length ? (fwd.includes(o.dir) && chance(0.72) ? o.dir : fwd[X.rint(fwd.length)]) : ex[0]; if (d !== o.dir) { o.dir = d; nextAt = t + rnd(190, 260); } else { walk(d, t); nextAt = t + rnd(230, 340) + (chance(0.12) ? rnd(300, 900) : 0); } }
  // which lift on this level leads towards level `goal`? (breadth-first over the four levels)
  function liftTowards(goal) { const L = W.levels, from = o.level, first = [-1, -1, -1, -1], seen = [false, false, false, false], q = [from]; seen[from] = true;
    for (let i = 0; i < q.length; i++) for (const e of L[q[i]].elev) if (!seen[e.to]) { seen[e.to] = true; first[e.to] = q[i] === from ? e.to : first[q[i]]; q.push(e.to); }
    const via = first[goal]; if (via < 0) return null; let best = null, bd = 1e9; for (const e of L[from].elev) if (e.to === via) { const dd = Math.abs(e.x - o.x) + Math.abs(e.y - o.y); if (dd < bd) { bd = dd; best = e; } } return best; }

  function think(t) {
    if (t < nextAt) return;
    // 1. incoming! Most of the time he notices; then it is a side-step if there is one, else back away down the hall
    const th = threat(); if (th) { dodged.add(th.m.mid); if (dodged.size > 40) dodged = new Set([th.m.mid]);
      if (chance(th.n >= 3 ? 0.8 : 0.45)) { const side = [(th.m.dir + 1) & 3, (th.m.dir + 3) & 3].filter((d) => open(o.level, o.x, o.y, d)); const d = side.length ? side[X.rint(side.length)] : (open(o.level, o.x, o.y, th.m.dir) ? th.m.dir : -1);
        if (d >= 0) { nextAt = t + rnd(150, 300); setTimeout(() => { if (o && o.alive && mode === 'here' && !ride) walk(d, now()); }, nextAt - t - 10); return; } } }
    if (t < typingUntil) { nextAt = t + 120; return; }                                   // he is typing: standing still, as you would be
    const slack = Math.max(0, Math.min(500, (o.kills - me.kills) * 90));                 // well ahead of you? he eases off. Behind? he is sharp.
    // 2. someone in his sights (you, or the robot that is now on your side)
    const idle = X.idleMs() > 60000, prey = [];
    if (me.alive && !X.riding() && me.level === o.level && !idle && t >= mercyUntil) prey.push(me);
    const rb = game.robot; if (rb.alive && rb.level === o.level) prey.push(rb);
    let bd = 99, bdir = -1; for (const p of prey) for (let d = 0; d < 4; d++) { const n = W.los(o.level, o.x, o.y, d, p.x, p.y, 12); if (n > 0 && n < bd) { bd = n; bdir = d; } }
    if (bdir >= 0) { if (o.dir !== bdir) { o.dir = bdir; nextAt = t + rnd(190, 270); return; }
      if (lockedDir !== bdir || t - lockedAt > 4000) { lockedDir = bdir; lockedAt = t; nextAt = t + rnd(300, 680) + slack + (chance(0.15) ? 350 : 0); return; }      // the beat between seeing you and firing
      if (t >= reloadAt && !missiles.some((m) => m.owner === ID)) { fire(t); nextAt = t + rnd(160, 320); return; }
      nextAt = t + 90; return; }
    lockedDir = -1;
    // 3. go looking. He sees what you see: everyone on his level is on the map, unless an option hides them
    if (me.alive && !idle && !blind() && t >= mercyUntil) {
      if (me.level === o.level) { followAt = 0; if (t >= planAt || plan < 0) { plan = W.route(o.level, o.x, o.y, me.x, me.y); planAt = t + rnd(500, 1100); if (plan >= 0 && chance(0.1)) { const ex = [0, 1, 2, 3].filter((d) => open(o.level, o.x, o.y, d)); if (ex.length) plan = ex[X.rint(ex.length)]; } }     // and now and then, a wrong turn
        if (plan >= 0) { if (o.dir !== plan) { o.dir = plan; nextAt = t + rnd(190, 260); return; } const ok = walk(plan, t); plan = -1; planAt = 0; nextAt = t + rnd(215, 300) + slack * 0.3 + (chance(0.08) ? rnd(250, 700) : 0); if (ok) return; } }
      else if (X.mazesOn()) { if (!followAt) followAt = t + rnd(3000, 8000); else if (t >= followAt) { const e = liftTowards(me.level); if (e) { const d = W.route(o.level, o.x, o.y, e.x, e.y); if (d >= 0) { if (o.dir !== d) { o.dir = d; nextAt = t + rnd(190, 260); return; } walk(d, t, true); nextAt = t + rnd(215, 300); return; } } } }
    }
    wander(t);
  }

  // ------------------------------------------------------------------ every frame
  function tick(t) {
    if (mode === 'absent') { if (!wanted() || (document.hidden && !anywhere)) { aloneSince = 0; return; } /* no greeting for somebody who is not looking */ if (!aloneSince) aloneSince = t; if (t - aloneSince >= JOIN_AFTER) join(t); return; }
    if (!o || others.get(ID) !== o) { o = null; mode = 'absent'; aloneSince = 0; return; }                                         // the game cleared its players (AppleTalk went off)
    o.seen = t;
    if (mode === 'leaving') return;
    if (realPlayers() > 0) { leave(t); return; }
    if (X.phase() !== 'play' || !game.cfg.net || !lobby()) { gone(' left the game.'); return; }
    if (net.status !== 'on') { if (!offlineSince) offlineSince = t; if (t - offlineSince > 20000) gone(' dropped off the network.'); return; } offlineSince = 0;
    if (ride) { if (t >= ride.until) { o.level = ride.to; o.dir = W.exitDir(o.level, o.x, o.y); o.arrived = t; o.alive = true; ride = null; nextAt = t + rnd(250, 500); if (o.level === me.level) A.lift(); } return; }
    if (!o.alive) { if (t >= deadUntil) { X.place(o, o.level); o.alive = true; nextAt = t + rnd(500, 1100); plan = -1; lockedDir = -1; if (o.level === me.level) A.tele(); } return; }
    if (X.over()) return;
    think(t);
    if (t - lastTalkAt > 150000 && nudges < 2 && X.idleMs() < 20000) { nudges++; lastTalkAt = t; remark('It has been quiet for a couple of minutes. ' + me.name + ' has not said anything. Say something short to get them talking, or taunt them into finding you.', 1); }
    // now and then, the pitch: three times a session at most, eight to twelve minutes apart, never on top of another line, and only while they are actually playing
    if (t >= inviteAt && invites < 3) { if (busy || t - lastLineAt < 20000 || X.idleMs() > 30000) inviteAt = t + 15000;
      else { invites++; inviteAt = t + rnd(480000, 720000); lastTalkAt = t; ask('event', 'Suggest that ' + me.name + ' invite a friend to play. Tell them how: the File menu, Invite a Friend, which gives them a link to send. Name the File menu. One short friendly line in your own words: it is more fun with real people, and you step aside the moment one arrives.', INVITES[Math.floor(Math.random() * INVITES.length)]); } }
  }

  addEventListener('pagehide', () => { if (mode !== 'absent') endTalk(); });
  MW.thumbs = { ID, tick, hit, steppedOn, scored, heard, get here() { return mode !== 'absent'; },
    dev: { set anywhere(v) { anywhere = !!v; }, invite: () => { inviteAt = 0; }, join: () => { if (mode === 'absent') join(now()); }, leave: () => { if (mode === 'here') leave(now()); }, get state() { return { mode, sid, asked, unprompted, busy, typing: typingUntil > now(), o }; } } };
})();
