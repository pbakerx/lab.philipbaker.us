// MISSILE COMMAND DELUXE · CITY RUN — main.js: the rules, the flying, the controls, the panels.
//
// THE GAME. Each level is one city. You fly a spotter through its avenues — it always flies
// forward along the circuit; you bend its path inside the canyon — and you carry no weapons.
// You DESIGNATE: point at the sky and your base camp, tied to you by a wireless uplink, launches
// an interceptor from ALPHA, DELTA or OMEGA. Base camp chooses the pad (there is no manual pad
// selection any more: AUTO is the only mode). Six towers must stand when the raid ends. Then the
// next city, harder: more missiles, faster, MIRVs, carriers, smart bombs, jammers in the avenues.
//
// WHAT IS KEPT FROM THE ORIGINAL, deliberately: its wave table and scoring, its blast (grow, hold,
// shrink over 2.35 s; chain kills; the three colour phases), ten missiles a pad and a pad lost when
// it is hit, a bonus every 10,000, the ×1–×6 multiplier, the eight-line initials board, and its
// colour schemes on its cadence (a new one every two levels).
//
// AIMING IN 3D. A tap is a ray, and a ray has no depth. So the shot bursts where your ray passes
// closest to a missile's FUTURE path — tap ahead of it along its line, exactly as you would lead it
// in 2D, and the depth solves itself. Nothing near the ray? It bursts on the ray at altitude.
// The radar is the same trick from above: tap a blip, base camp picks the height.
import * as THREE from 'three';
import { createWorld, GRID } from '/missile-command-deluxe/scene.js';
import { createRadar, createOverlay } from '/missile-command-deluxe/radar.js';
import * as SFX from '/missile-command-deluxe/audio.js';

const V3 = THREE.Vector3, UP = new V3(0, 1, 0), TAU = Math.PI * 2;
const $ = id => document.getElementById(id), Q = new URLSearchParams(location.search), QA = Q.has('qa');
const canvas = $('game'), menu = $('menu'), root = document.documentElement;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n)), rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];
const fmt = n => Math.floor(n).toLocaleString('en-US');

// The arcade's six were, by its programmer's account, the California coast. They are the campaign; after San Diego it loops, harder.
const CITIES = ['EUREKA', 'SAN FRANCISCO', 'SAN LUIS OBISPO', 'SANTA BARBARA', 'LOS ANGELES', 'SAN DIEGO'];
const PADS = ['ALPHA', 'DELTA', 'OMEGA'];
// [ground, friendly, enemy] — the original's four schemes, verbatim from /missile-command.
const PALETTES = [['#f4ec66', '#66e5ff', '#ff533e'], ['#f777e7', '#8bfa8b', '#f6e870'], ['#69e88c', '#69baff', '#ff5c80'], ['#75a9ff', '#f4ec66', '#ff836b']];
// [ballistic missiles, speed, aircraft, smart bombs, MIRV chance] — the original's table, verbatim. CONFIG scales it to this world.
const WAVES = [[12, 24, 0, 0, 0], [15, 28, 1, 0, .12], [18, 33, 1, 0, .16], [20, 38, 2, 0, .20], [22, 44, 2, 0, .24], [24, 49, 2, 1, .25], [26, 55, 2, 2, .28], [28, 61, 3, 2, .30], [30, 67, 3, 3, .32], [32, 73, 3, 3, .34], [34, 79, 3, 4, .36], [36, 85, 4, 4, .38]];
const CONFIG = { ammo: 10, bonusEvery: 10000, blastRadius: 32, blastLife: 2.35, shotSpeed: [540, 800, 540], smartFirst: 6,
  count: 1.1, speed: 1.22,                      // a city is bigger than a 450-pixel screen: units for pixels. (Aircraft now bring the rest of the missiles.)
  flight: 46, flightStep: 2, flightMax: 72,
  // THE SKY HAS TWO PARTS. Below `roof` you are in the canyon: a slot `boundX` wide over the avenue. Above it the slot opens like a bowl —
  // the higher, the wider, out to `boundHigh` — and the street route melts into one long easy loop over the rooftops (scene.js, "the high road").
  boundX: 7.5, boundHigh: 135, roof: 305, altMin: 12, altMax: 520, climb: 105, dive: 88 };
const STORE = 'mc-cityrun-scores-v1', SETTINGS = 'mc-mobile-sound-v1';   // its own board; the sound switch is shared with the original

let storageOK = true, scores = [], soundOn = true;
try { const data = JSON.parse(localStorage.getItem(STORE) || '[]');
  if (Array.isArray(data)) scores = data.filter(e => e && /^[A-Z0-9 ]{1,3}$/.test(e.name) && Number.isSafeInteger(e.score) && e.score >= 0 && Number.isSafeInteger(e.wave) && e.wave > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  soundOn = localStorage.getItem(SETTINGS) !== 'off';
} catch (e) { storageOK = false; }

const S = { mode: 'boot', level: 1, score: 0, reserve: 0, nextBonus: CONFIG.bonusEvery, demo: false,
  towers: [], pads: [], enemies: [], shots: [], blasts: [], trails: [], schedule: [], pickups: [], mines: [], popups: [],
  time: 0, total: 0, intro: 0, settle: 0, linkLost: 0, toast: 0, falling: 0, speed: 30, split: 0, aiClock: 0,
  craft: { u: 0, ox: 0, oy: 0, vx: 0, vy: 0, s: 0, roll: 0, pitch: 0, speed: CONFIG.flight, pos: new V3(), P: new V3(), T: new V3(0, 0, 1), R: new V3(1, 0, 0), U: new V3(0, 1, 0) } };
const lean = new V3(), view = { lookX: 0, lookY: 0, leanX: 0, leanY: 0, hideCraft: false }, ui = { live: false, reticle: null, lock: null, ripples: [], stick: null };
const input = { x: 0, y: 0 }, keys = new Set();
let world = null, city = null, radar = null, overlay = null, css = { ground: PALETTES[0][0], friendly: PALETTES[0][1], enemy: PALETTES[0][2] };
let mobile = isMobile(), blocked = false, last = 0, acc = 0, letters = [0, 0, 0], slot = 0, saved = false, pointer = null, lostGpu = false;

function isMobile() { return navigator.maxTouchPoints > 0 && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); }
const multiplier = () => Math.min(6, Math.floor((S.level - 1) / 2) + 1);
const palette = n => PALETTES[Math.floor((n - 1) / 2) % PALETTES.length];
const cityName = n => CITIES[(n - 1) % CITIES.length] + (n > CITIES.length ? ' ' + 'I'.repeat(Math.floor((n - 1) / CITIES.length) + 1) : '');
function waveConfig(n) { if (n <= WAVES.length) return WAVES[n - 1]; const x = Math.min(12, n - WAVES.length); return [36 + Math.min(18, x * 2), 85 + x * 4, 4 + Math.floor(x / 5), 4 + Math.floor(x / 3), .4]; }
function writeScores() { try { localStorage.setItem(STORE, JSON.stringify(scores)); } catch (e) { storageOK = false; } }
function toast(message) { if (S.demo) return; $('toast').textContent = message; $('toast').hidden = false; S.toast = 1.8; }

// ------------------------------------------------------------------ HUD
function updateHUD() {
  $('score').textContent = fmt(S.demo ? 0 : S.score); $('high').textContent = fmt(Math.max(S.demo ? 0 : S.score, scores[0]?.score || 0));
  $('level').textContent = S.demo ? '' : S.level; $('cityname').textContent = S.demo ? 'DEMO' : cityName(S.level); $('mult').textContent = S.demo ? '' : multiplier() + '×'; $('reserve').textContent = S.reserve;   // the title screen plays itself; it is nobody's city 5
  $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on');
  let total = 0; document.querySelectorAll('[data-pad]').forEach((el, i) => { const p = S.pads[i]; if (!p) return; total += p.alive ? p.ammo : 0;
    el.classList.toggle('out', !p.alive); el.querySelector('b').textContent = p.alive ? p.ammo : '×'; el.querySelector('i').style.width = (p.alive ? p.ammo / CONFIG.ammo * 100 : 0) + '%'; });
  $('ammo-total').textContent = total;
  $('pause').disabled = S.mode !== 'playing' && S.mode !== 'paused'; $('pause').classList.toggle('on', S.mode === 'paused'); $('pause').setAttribute('aria-label', S.mode === 'paused' ? 'Resume' : 'Pause');
}
function chrome(pal) { css = { ground: pal[0], friendly: pal[1], enemy: pal[2] }; root.style.setProperty('--ground', pal[0]); root.style.setProperty('--friendly', pal[1]); root.style.setProperty('--enemy', pal[2]); }
function addScore(points, at, col) {
  if (S.demo) return; S.score += Math.round(points);
  if (at) S.popups.push({ pos: at.clone(), text: '+' + fmt(points), t: 0, life: 1.1, col });
  while (S.score >= S.nextBonus) { S.reserve++; S.nextBonus += CONFIG.bonusEvery; toast('RESERVE TOWER EARNED'); say('bonus'); }
  updateHUD();
}
// Every sound is placed: panned by where it is on screen, quieter and duller with range. No position = it is yours (UI, cockpit).
const heard = {};
function say(kind, at) {
  if (S.demo) return; if (!at) return SFX.voice(kind);
  const p = world.project(at, heard), w = canvas.clientWidth || 1, d = at.distanceTo(S.craft.pos);
  SFX.voice(kind, { pan: p.behind ? 0 : clamp((p.x / w) * 2 - 1, -1, 1) * .85, far: clamp((d - 140) / 1100, 0, 1) });
}

// ------------------------------------------------------------------ a level
function beginLevel() {
  const pal = palette(S.level); chrome(pal); city = world.buildCity(S.level, pal);
  const along = (x, z) => { let best = 0, bd = 1e9; city.route.map.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = i; } }); return best / city.route.map.length; };
  S.towers = city.towers.map(t => ({ ...t, alive: true, threat: 99, u: along(t.x, t.z) })); S.pads = city.pads.map(p => ({ id: p.id, pos: p.pos, alive: true, ammo: CONFIG.ammo, u: along(p.pos.x, p.pos.z) }));
  for (const k of ['enemies', 'shots', 'blasts', 'trails', 'schedule', 'pickups', 'mines', 'popups']) S[k] = [];
  S.time = 0; S.settle = 0; S.linkLost = 0; S.falling = 0; S.aiClock = 1; S.intro = S.demo ? .6 : 3.6;
  const c = S.craft; c.u = 0; c.ox = c.oy = c.vx = c.vy = c.s = c.roll = c.pitch = 0; c.speed = Math.min(CONFIG.flightMax, CONFIG.flight + (S.level - 1) * CONFIG.flightStep); flyCraft(0);

  const [count0, speed, , smart, split] = waveConfig(S.level), count = Math.round(count0 * CONFIG.count); S.speed = speed * CONFIG.speed; S.split = split;
  let t = 1.4; for (let i = 0; i < count;) { const batch = Math.min(count - i, 2 + Math.floor(Math.random() * 3)); for (let j = 0; j < batch; j++, i++) S.schedule.push({ at: t + j * .2, type: 'missile' }); t += Math.max(1.6, 4.2 - S.level * .12); }
  // MORE BAD GUYS. Bombers from the first city — half cross your view, half come straight down your road overhead — then raiders in a V of
  // three, then satellites. They bring their own missiles, so the table's ballistic count is scaled down a little (CONFIG.count).
  const bombers = Math.min(5, 1 + Math.floor(S.level / 2)), raids = S.level >= 2 ? Math.min(3, 1 + Math.floor((S.level - 2) / 3)) : 0, sats = S.level >= 4 ? Math.min(2, 1 + Math.floor((S.level - 4) / 5)) : 0;
  for (let i = 0; i < bombers; i++) S.schedule.push({ at: 3 + i * Math.max(4.5, t / bombers) + rnd(0, 2), type: 'bomber' });
  for (let i = 0; i < raids; i++) S.schedule.push({ at: 9 + i * Math.max(7, t / raids) + rnd(0, 2), type: 'raider' });
  for (let i = 0; i < sats; i++) S.schedule.push({ at: 6 + i * 11, type: 'satellite' });
  for (let i = 0; i < smart; i++) S.schedule.push({ at: 6 + i * Math.max(1.8, t / Math.max(1, smart)), type: 'smart' });
  S.schedule.sort((a, b) => a.at - b.at);
  scatter(); $('toast').hidden = true; $('intro').hidden = true; menuHide();
  if (!S.demo) { showIntro(); say('level'); } warned.clear(); updateHUD();
}
// Rings and jammers live OFF the centreline, always. Left alone, the craft flies the middle of the avenue and meets neither:
// steering is a choice — a ring is three more missiles, and a jammer beside it is three seconds with none.
function scatter() {
  const P = new V3(), T = new V3(), R = new V3(), Uv = new V3(), put = (u, arr, extra) => { city.route.frame(u, P, T); R.crossVectors(T, UP).normalize(); Uv.crossVectors(R, T).normalize();
    const side = Math.random() < .5 ? -1 : 1, ox = side * rnd(3.6, CONFIG.boundX * .92), oy = rnd(-2.5, 7); arr.push({ u, pos: P.clone().addScaledVector(R, ox).addScaledVector(Uv, oy), T: T.clone(), ...extra }); };
  S.pickups = []; S.mines = []; const rings = S.demo ? 0 : 5, jam = S.demo ? 0 : Math.min(9, Math.max(0, S.level - 2) + Math.floor(S.level / 3));
  for (let i = 0; i < rings; i++) put((.08 + (i + rnd(.15, .85)) / rings * .9) % 1, S.pickups, { taken: false });
  for (let i = 0; i < jam; i++) put((.05 + (i + rnd(.1, .9)) / jam * .93) % 1, S.mines, { hit: false });
}

// THE RAID FOLLOWS YOU. A forward-flying camera and targets scattered city-wide would put most of the battle off-screen,
// so three strikes in four go for a tower you are ABOUT TO REACH — far enough along the circuit that the missile is falling
// into your windscreen as you arrive. The fourth lands anywhere, which is what the radar is for.
// "About to reach" cannot mean "further along the road": the circuit turns a corner every few seconds, and a tower twenty
// seconds up the road is usually round one. So ask the real question — fly the craft forward in the mind to three moments of
// the missile's fall, and keep a tower only if it sits inside the forward cone, at a sensible range, for most of them.
const fP = new V3(), fT = new V3(), XZ = o => o.pos ? [o.pos.x, o.pos.z] : [o.x, o.z];
function ahead(list, eta) {
  const c = S.craft, route = city.route, out = [];
  for (const t of list) { const [x, z] = XZ(t); let seen = 0;
    for (const k of [.35, .55, .75, .92]) { route.frame(c.u + c.speed * eta * k / route.length, fP, fT); const dx = x - fP.x, dz = z - fP.z, d = Math.hypot(dx, dz); if (d > 110 && d < 1150 && (dx * fT.x + dz * fT.z) / (d * Math.hypot(fT.x, fT.z)) > .36) seen++; }
    if (seen >= 2) out.push(t); }
  return out.length ? out : null;
}
function pickTarget(eta = 18) {
  const live = S.towers.filter(t => t.alive), pads = S.pads.filter(p => p.alive), r = Math.random();
  const staged = Math.random() < .8;                                                        // four in five are staged for the windscreen
  if (live.length && (r < .72 || !pads.length)) { const front = staged && ahead(live, eta), t = pick(front || live); return { kind: 'tower', ref: t, pos: t.top.clone(), staged: !!front }; }
  if (pads.length && r < .9) { const front = staged && ahead(pads, eta), p = pick(front || pads); return { kind: 'pad', ref: p, pos: p.pos.clone(), staged: !!front }; }
  const b = pick(city.buildings); return { kind: 'building', ref: b, pos: new V3(b.x, b.dead ? 4 : b.h * .92, b.z) };
}
function spawnMissile(origin, type = 'missile', canSplit = true) {
  const eta = 500 / S.speed, tg = pickTarget(eta); let a = Math.random() * TAU;
  if (tg.staged) { city.route.frame(S.craft.u + S.craft.speed * eta * .65 / city.route.length, fP, fT); a = Math.atan2(tg.pos.z - fP.z, tg.pos.x - fP.x) + rnd(-1.5, 1.5); }   // it comes in from beyond the tower, so the whole fall is in front of you
  const rad = rnd(120, 500), o = origin ? origin.clone() : new V3(tg.pos.x + Math.cos(a) * rad, rnd(430, 540), tg.pos.z + Math.sin(a) * rad);
  const speed = S.speed * (type === 'smart' ? 1.45 : rnd(.92, 1.09)), dir = tg.pos.clone().sub(o), dist = dir.length();
  S.enemies.push({ type, pos: o.clone(), origin: o.clone(), dest: tg.pos, target: tg, vel: dir.multiplyScalar(speed / dist), speed, eta: dist / speed,
    split: type === 'missile' && canSplit && Math.random() < S.split, splitY: rnd(220, 350), dead: false });
}
const isPlane = e => e.drops !== undefined, warned = new Set();
function spawnPlane(type) {
  const c = S.craft, P = new V3(), T = new V3(); city.route.frame(c.u + rnd(.09, .16), P, T); T.y = 0; T.normalize();                             // a point on your road, a few seconds ahead of you
  const R = GRID.half + 300, side = Math.random() < .5 ? -1 : 1, across = new V3(-T.z * side, 0, T.x * side), headOn = type === 'bomber' && Math.random() < .5;
  const alt = type === 'satellite' ? rnd(440, 520) : type === 'bomber' ? rnd(250, 340) : rnd(305, 365), speed = type === 'satellite' ? 60 + S.level * 2 : type === 'bomber' ? (80 + Math.min(S.level, 24) * 3.3) * 1.1 : 190 + S.level * 4;
  const max = type === 'satellite' ? 3 : type === 'bomber' ? 4 + Math.floor(S.level / 4) : 1 + (S.level > 4 ? 1 : 0), dir = headOn ? T.clone().negate() : across, start = new V3(P.x, alt, P.z).addScaledVector(dir, headOn ? -R * .9 : -R), wing = new V3(-dir.z, 0, dir.x);
  for (const [w, b] of type === 'raider' ? [[0, 0], [-24, -18], [24, -18]] : [[0, 0]]) { const o = start.clone().addScaledVector(wing, w).addScaledVector(dir, b);   // raiders come as a V of three
    S.enemies.push({ type, pos: o, origin: o.clone(), dest: o.clone().addScaledVector(dir, R * 2 + 320), vel: dir.clone().multiplyScalar(speed), speed, drop: rnd(1.2, 2.6) + Math.abs(w) * .02, drops: 0, max, bank: 0, dead: false }); }
}

// ------------------------------------------------------------------ designate → launch
const tmpU = new V3(), tmpW = new V3();
function closest(o, d, a, b, out) { // ray (o, unit d) to segment a→b: s along the ray, the point on the SEGMENT, and the gap between them
  const u = tmpU.subVectors(b, a), w = tmpW.subVectors(o, a), bb = d.dot(u), c = u.dot(u), dd = d.dot(w), e = u.dot(w), den = c - bb * bb;
  let t = den < 1e-6 ? 0 : clamp((e - bb * dd) / den, 0, 1), s = bb * t - dd; if (s < 0) { s = 0; t = c > 0 ? clamp(e / c, 0, 1) : 0; }
  out.p.copy(a).addScaledVector(u, t); out.s = s; out.d = out.p.distanceTo(tmpW.copy(o).addScaledVector(d, s)); return out;
}
const hit = { p: new V3(), s: 0, d: 0 };
function solveAim(o, d, tolMin, tolK) {
  let best = null; for (const e of S.enemies) { if (e.dead) continue; closest(o, d, e.pos, e.dest, hit); if (hit.s < 25) continue; const tol = Math.max(tolMin, hit.s * tolK), q = hit.d / tol; if (q < 1 && (!best || q < best.q)) best = { q, p: hit.p.clone() }; }
  if (best) { best.p.y = Math.max(best.p.y, 16); return { target: best.p, lock: true }; }
  const s = clamp(d.y > .06 ? (180 - o.y) / d.y : 320, 90, 640), p = o.clone().addScaledVector(d, s); p.y = Math.max(p.y, 16); return { target: p, lock: false };
}
function fireAt(px, py) {
  const rr = $('radar').getBoundingClientRect(), cr = canvas.getBoundingClientRect(), spot = radar.blipAt(px + cr.left - rr.left, py + cr.top - rr.top);   // the radar sits over the sky: a click goes THROUGH it unless it lands on a blip
  if (spot) { const ok = fireAtMap(spot.x, spot.z); ui.ripples.push({ x: px, y: py, t: 0, ok }); return ok; }
  const r = world.ray(px, py), ok = launch(solveAim(r.o, r.d, 16, .06).target); ui.ripples.push({ x: px, y: py, t: 0, ok }); return ok;
}
function fireAtMap(x, z) { const a = solveAim(new V3(x, 0, z), UP, 60, 0); if (!a.lock) a.target.set(x, 165, z); return launch(a.target); }
function launch(target) {
  if ((S.mode !== 'playing' && !S.demo) || S.intro > 0 || blocked) return false;
  if (S.linkLost > 0) { say('dry'); toast('UPLINK JAMMED'); return false; }
  const ready = S.pads.filter(p => p.alive && (p.ammo > 0 || S.demo)); if (!ready.length) { say('dry'); toast(S.pads.some(p => p.alive) ? 'OUT OF MISSILES' : 'BASE CAMP DESTROYED'); return false; }
  const pad = ready.sort((a, b) => b.ammo - a.ammo || CONFIG.shotSpeed[b.id] - CONFIG.shotSpeed[a.id])[0]; if (!S.demo) pad.ammo--;   // AUTO: the fullest pad; on a tie, the fast one
  S.shots.push({ from: pad.pos.clone(), pos: pad.pos.clone(), target: target.clone(), speed: CONFIG.shotSpeed[pad.id] });
  world.pulse(); world.flash(pad.pos, 'friendly', 20, .2); say('launch'); updateHUD(); return true;
}
function burst(pos, max = CONFIG.blastRadius, hostile = false, sound = hostile ? 'impact' : 'blast') {
  S.blasts.push({ pos: pos.clone(), age: 0, r: 0, max, life: hostile ? 1.25 : CONFIG.blastLife, hostile, seed: Math.random() * 40 }); say(sound, pos);
  world.flash(pos, hostile ? 'enemy' : 'white', max * 2.6, .2); world.burst(pos, hostile ? 'enemy' : 'ground', hostile ? 26 : 14, hostile ? 60 : 46, 1.1, 1.5);
}
function kill(e) {
  if (e.dead) return; e.dead = true; const base = { smart: 125, missile: 25, bomber: 150, raider: 75, satellite: 100 }[e.type];
  addScore(base * multiplier(), e.pos, 'ground');
  if (isPlane(e)) { burst(e.pos, CONFIG.blastRadius * (e.type === 'bomber' ? 1.25 : .9), false, 'planekill'); world.burst(e.pos, 'enemy', e.type === 'bomber' ? 60 : 26, 90, 1.6, 2.2); world.shake(clamp(140 / (1 + e.pos.distanceTo(S.craft.pos)), 0, 1.2)); }
  else burst(e.pos, CONFIG.blastRadius * .84);                                                                                 // a kill is itself a (smaller) blast: chains
}
function impact(e) {
  const t = e.target;
  if (t.kind === 'tower' && t.ref.alive) { t.ref.alive = false; world.collapse(t.ref.idx, new V3(t.ref.x, 0, t.ref.z)); say('collapse', t.ref.top); world.shake(1.6); toast('TOWER LOST');
    if (!S.towers.some(w => w.alive)) cityFalls(t.ref); }
  else if (t.kind === 'pad' && t.ref.alive) { t.ref.alive = false; t.ref.ammo = 0; world.shake(1.2); toast(PADS[t.ref.id] + ' DESTROYED'); }
  else if (t.kind === 'building' && !t.ref.dead) { t.ref.dead = true; world.collapse(t.ref.idx, null); }
  burst(e.pos, 34, true); world.shake(clamp(90 / (1 + e.pos.distanceTo(S.craft.pos)), 0, .9)); updateHUD();
}
function cityFalls(lastTower) {
  if (S.demo) { S.falling = 2.5; return; }
  if (S.reserve > 0) { S.reserve--; lastTower.alive = true; world.rebuild(lastTower.idx, new V3(lastTower.x, 0, lastTower.z)); toast('RESERVE TOWER RAISED'); say('bonus'); updateHUD(); return; }
  S.mode = 'falling'; S.falling = 2.6; say('over');
}

// ------------------------------------------------------------------ flying
// KEYS ARE A VELOCITY, not a position: hold to climb, let go and you stay where you are. Nothing re-centres you, so a player who never
// touches them flies the middle of the avenue at the route's own height — and one who does can leave the canyon altogether.
const P1 = new V3(), T1 = new V3(), T0 = new V3(), ease = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;
function flyCraft(dt) {
  const c = S.craft, route = city.route, low = 1 - c.s; route.frame(c.u, c.P, T0); route.frame(c.u + 9 / route.length, P1, T1);
  const bend = clamp((1 - clamp(T0.dot(T1), -1, 1)) * 38, 0, 1) * low, yaw = (T1.x * T0.z - T1.z * T0.x) * low;      // how hard, and which way, the avenue is about to turn — it only matters down in it
  c.u = (c.u + c.speed * (1 - .3 * bend) * dt / route.length) % 1; route.frame(c.u, c.P, T0);
  const k = dt > 0 ? 1 - Math.exp(-dt * 7) : 0, open = ease(CONFIG.roof - 5, CONFIG.roof + 125, c.pos.y);
  c.vx += (input.x * mix(26, 96, open) - c.vx) * k; c.vy += (input.y * (input.y > 0 ? CONFIG.climb : CONFIG.dive) - c.vy) * k; c.ox += c.vx * dt; c.oy += c.vy * dt;
  let y = c.P.y + c.oy; const slot = CONFIG.boundX * (1 - .55 * bend), bound = mix(slot, CONFIG.boundHigh, ease(CONFIG.roof - 5, CONFIG.roof + 125, y));   // the bowl: the higher, the wider
  if (Math.abs(c.ox) > bound) { c.ox = Math.sign(c.ox) * bound; c.vx = 0; }
  const floor = mix(CONFIG.altMin, CONFIG.roof, ease(slot + 1, slot + 12, Math.abs(c.ox)));                           // off to one side there are rooftops under you: you come down only over the avenue
  if (y < floor) { y = floor; if (c.vy < 0) c.vy = 0; } if (y > CONFIG.altMax) { y = CONFIG.altMax; if (c.vy > 0) c.vy = 0; }
  c.oy = y - c.P.y; c.s = ease(CONFIG.roof + 5, CONFIG.roof + 115, y);
  route.frameAt(c.u, c.s, c.P, c.T); c.R.crossVectors(c.T, UP).normalize(); c.U.crossVectors(c.R, c.T).normalize();
  if (dt > 0) { const e = 1 - Math.exp(-dt * 6); c.roll += (clamp(c.vx * .016 - yaw * 7, -1.15, 1.15) - c.roll) * e; c.pitch += (clamp(c.vy * .0052 + c.T.y * .9, -.6, .6) - c.pitch) * e; }
  c.pos.copy(c.P).addScaledVector(c.R, c.ox); c.pos.y = y;
}
function readInput() {
  let x = 0, y = 0; if (keys.has('left')) x -= 1; if (keys.has('right')) x += 1; if (keys.has('up')) y += 1; if (keys.has('down')) y -= 1;
  if (!x && !y && ui.stick) { x = ui.stick.ix; y = ui.stick.iy; }
  if (S.demo) { x = Math.sin(S.total * .47) * .75; y = Math.sin(S.total * .31 + 1) * .55; }
  input.x = x; input.y = y;
}

// ------------------------------------------------------------------ the simulation: one fixed step
const seg = new V3(), segW = new V3();
function gapToSegment(p, a, b) { seg.subVectors(b, a); const l = seg.lengthSq(), u = l ? clamp(segW.subVectors(p, a).dot(seg) / l, 0, 1) : 0; return segW.copy(a).addScaledVector(seg, u).distanceTo(p); }
function simulate(dt) {
  S.total += dt; readInput(); flyCraft(dt);
  if (S.toast > 0) { S.toast -= dt; if (S.toast <= 0) $('toast').hidden = true; }
  for (const p of S.popups) p.t += dt; S.popups = S.popups.filter(p => p.t < p.life);
  for (const r of ui.ripples) r.t += dt; ui.ripples = ui.ripples.filter(r => r.t < .4);
  if (S.linkLost > 0) { S.linkLost -= dt; if (S.linkLost <= 0) { toast('UPLINK RESTORED'); say('restore'); } }
  if (S.falling > 0) { S.falling -= dt; if (S.falling <= 0) { if (S.demo) beginLevel(); else endGame(); return; } }
  if (S.intro > 0) { S.intro -= dt; if (S.intro <= 0) $('intro').hidden = true; else return; }

  S.time += dt; while (S.schedule.length && S.schedule[0].at <= S.time) { const it = S.schedule.shift(); it.type === 'bomber' || it.type === 'raider' || it.type === 'satellite' ? spawnPlane(it.type) : spawnMissile(null, it.type); }
  for (const b of S.blasts) { b.age += dt; const u = b.age / b.life; b.r = b.max * (u < .35 ? u / .35 : u < .65 ? 1 : (1 - u) / .35); }   // the original's envelope
  S.blasts = S.blasts.filter(b => b.age < b.life);
  for (const s of S.shots) { const d = s.pos.distanceTo(s.target), step = s.speed * dt; if (d <= step) { s.dead = true; burst(s.target); } else s.pos.addScaledVector(seg.subVectors(s.target, s.pos).normalize(), step); }
  S.shots = S.shots.filter(s => !s.dead);

  const old = new V3(); for (const t of S.towers) t.threat = 99;
  for (const e of [...S.enemies]) {                                                     // a snapshot: splits and drops move on the next tick
    if (e.dead) continue; old.copy(e.pos);
    if (isPlane(e)) {
      e.pos.addScaledVector(e.vel, dt); e.drop -= dt; e.bank = Math.sin(S.total * .9 + e.origin.x) * .12;
      if (e.drop <= 0 && Math.max(Math.abs(e.pos.x), Math.abs(e.pos.z)) < GRID.half && e.drops < e.max) { spawnMissile(e.pos, 'missile', false); e.drop = e.type === 'bomber' ? rnd(.5, .95) : rnd(1.3, 2.6); e.drops++; }   // a bomber lays a string
      if (!e.heard && !S.demo && e.type !== 'satellite' && e.pos.distanceTo(S.craft.pos) < 340) { e.heard = true; say('flyby', e.pos); }
      if (e.pos.distanceTo(e.origin) > e.origin.distanceTo(e.dest)) { e.gone = e.dead = true; continue; }
    } else {
      const step = e.speed * dt, d = e.pos.distanceTo(e.dest);
      if (d <= step) e.pos.copy(e.dest);
      else { seg.subVectors(e.dest, e.pos).normalize();
        if (e.type === 'smart') for (const b of S.blasts) { if (b.hostile) continue; const gap = e.pos.distanceTo(b.pos), reach = b.r + 52;             // a smart bomb slides sideways around a blast below it
          if (gap < reach && gap > 0 && b.pos.y <= e.pos.y + 26) { const k = (1 - gap / reach) * 3; seg.x += Math.sign(e.pos.x - b.pos.x || 1) * k; seg.z += Math.sign(e.pos.z - b.pos.z || 1) * k; seg.y = Math.min(seg.y, -.28); seg.normalize(); } }
        e.pos.addScaledVector(seg, step); e.vel.copy(seg).multiplyScalar(e.speed); }
      e.eta = e.pos.distanceTo(e.dest) / e.speed; if (e.target.kind === 'tower' && e.target.ref.alive) { e.target.ref.threat = Math.min(e.target.ref.threat, e.eta); if (e.eta < 5 && !warned.has(e)) { warned.add(e); say('warn'); } }
    }
    for (const b of S.blasts) if (!b.hostile && gapToSegment(b.pos, old, e.pos) <= b.r + (e.type === 'missile' ? 1 : e.type === 'bomber' ? 16 : 8)) { kill(e); break; }
    if (e.dead) continue;
    if (e.type === 'missile' && e.split && e.pos.y <= e.splitY) { e.split = false; for (let i = 0; i < (S.level > 10 ? 3 : 2); i++) spawnMissile(e.pos, 'missile', false); }
    if ((e.type === 'missile' || e.type === 'smart') && e.pos.distanceTo(e.dest) < .6) { e.dead = true; impact(e); }
  }
  for (const e of S.enemies) if (e.dead && !isPlane(e)) S.trails.push({ a: e.origin, b: e.pos.clone(), life: .45 });
  S.enemies = S.enemies.filter(e => !e.dead);
  for (const t of S.trails) t.life -= dt; S.trails = S.trails.filter(t => t.life > 0);

  const c = S.craft;
  for (const p of S.pickups) if (!p.taken && p.pos.distanceTo(c.pos) < 5.4) { p.taken = true; const pad = S.pads.filter(q => q.alive).sort((a, b) => a.ammo - b.ammo)[0];
    if (pad) pad.ammo = Math.min(CONFIG.ammo + 5, pad.ammo + 3); world.burst(p.pos, 'friendly', 22, 30, .7, 1.3, 0); world.flash(p.pos, 'friendly', 26, .25); say('pickup'); addScore(50 * multiplier(), p.pos, 'friendly'); toast('+3 MISSILES'); updateHUD(); }
  for (const m of S.mines) if (!m.hit && m.pos.distanceTo(c.pos) < 4.4) { m.hit = true; S.linkLost = 3; world.burst(m.pos, 'enemy', 30, 40, .8, 1.5, 0); world.flash(m.pos, 'enemy', 36, .3); world.shake(1.4); say('jam'); toast('UPLINK JAMMED'); }

  if (S.demo) demoGunner(dt);
  if (!S.schedule.length && !S.enemies.length && !S.shots.length && !S.blasts.length && S.falling <= 0) { S.settle += dt; if (S.settle > .8) S.demo ? beginLevel() : finishLevel(); } else S.settle = 0;
}
// The title screen plays itself: a gunner that leads its targets properly, so the attract mode shows how the game is meant to look.
function demoGunner(dt) {
  S.aiClock -= dt; if (S.aiClock > 0) return; S.aiClock = rnd(.45, .85);
  const pad = S.pads.find(p => p.alive); if (!pad) return; let best = null;
  for (const e of S.enemies) { if (e.dead || e.covered > S.total || isPlane(e)) continue; if (!best || e.eta < best.eta) best = e; }
  if (!best) return; let t = 1; const p = new V3(); for (let i = 0; i < 4; i++) { p.copy(best.pos).addScaledVector(best.vel, t); t = p.distanceTo(pad.pos) / 540 + .25; }
  if (t > best.eta - .2 || p.y < 20) return; best.covered = S.total + 3.2; launch(p);
}

// ------------------------------------------------------------------ panels
function menuShow(html) { menu.hidden = false; menu.innerHTML = html; ui.live = false; }
function menuHide() { menu.hidden = true; ui.live = true; }
function board() { if (!scores.length) return '<p>No scores yet. Set the first one.</p>';
  return '<table><thead><tr><th>#</th><th>NAME</th><th>CITY</th><th>SCORE</th></tr></thead><tbody>' + scores.map((e, i) => `<tr><td>${i + 1}</td><td>${e.name}</td><td>${e.wave}</td><td>${fmt(e.score)}</td></tr>`).join('') + '</tbody></table>'; }
function showIntro() {
  const how = mobile ? 'TAP THE SKY TO CALL A STRIKE · DRAG TO FLY — UP AND OUT OF THE CANYON · TAP A RADAR BLIP FOR WHAT YOU CAN’T SEE' : 'MOUSE AIMS, CLICK CALLS A STRIKE · W A S D FLIES — HOLD W TO CLIMB OUT OF THE CANYON · CLICK A RADAR BLIP FOR WHAT YOU CAN’T SEE';
  const note = S.level === 1 ? how : S.level === 3 ? 'JAMMERS IN THE AVENUES — RED MINES CUT YOUR UPLINK' : S.level === CONFIG.smartFirst ? 'SMART BOMBS INBOUND — THEY DODGE' : '';
  $('intro').innerHTML = `<div class="w">CITY ${S.level} · ${cityName(S.level)}</div><div class="m">${multiplier()}× POINTS</div><div class="d">SAVE THE SIX TOWERS</div>${note ? `<div class="k">${note}</div>` : ''}`; $('intro').hidden = false;
}
function showHome() {
  S.mode = 'home'; S.demo = true; S.level = 1 + 2 * Math.floor(Math.random() * 4); beginLevel();
  menuShow(`<div class="panel home-grid"><div><p class="eyebrow">MISSILE COMMAND DELUXE</p><div class="title">CITY<br>RUN</div><p>Fly the raid. Call the strikes. Save the six.</p><div class="actions"><button class="primary" id="start">START GAME</button><button id="scores">HIGH SCORES</button></div></div><div><p class="instructions">Each level is a city under attack, and you are in the air over it.<br><b>${mobile ? 'TAP' : 'MOUSE'}</b> — ${mobile ? 'tap the sky' : 'aim and click'} ahead of a missile. Base camp fires, not you.<br><b>${mobile ? 'DRAG' : 'W A S D'}</b> flies. Hold ${mobile ? 'up' : '<b>W</b>'} to climb out of the canyon and over the rooftops; come back down over an avenue.<br><b>RADAR</b> — ${mobile ? 'tap' : 'click'} a blip to strike what you can’t see.<br>Bombers and raiders bring more. Shoot them down.<br>Lead them. Chain the blasts. Six towers must stand.</p><p class="muted line">Thirty missiles a city · rings add three · a reserve tower every 10,000${mobile ? '' : '<br>SPACE fire · P pause · M sound · F full screen'}</p></div></div>`);
  $('start').onclick = startGame; $('scores').onclick = showScores; updateHUD();
}
function showScores() { menuShow(`<div class="panel" style="max-width:510px"><h2>HIGH SCORES</h2>${board()}<p class="muted">${storageOK ? 'Saved on this device and browser.' : 'Storage unavailable. Scores last for this session only.'}</p><div class="actions"><button class="primary" id="back">BACK</button></div></div>`); $('back').onclick = showHome; }
function startGame() {
  if (blocked || lostGpu || !world) return;
  window.pbTrack && window.pbTrack('game_start', { game_id: 'missile-command-deluxe', game_name: 'Missile Command Deluxe: City Run', game_host: 'lab' });
  SFX.unlock(true); S.demo = false; S.level = 1; S.score = 0; S.reserve = 0; S.nextBonus = CONFIG.bonusEvery; saved = false; S.mode = 'playing'; beginLevel();
  if (mobile && root.requestFullscreen && !document.fullscreenElement) { try { const f = root.requestFullscreen(); if (f?.then) f.then(() => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) {} }).catch(() => {}); } catch (e) {} }
}
function finishLevel() {
  const towers = S.towers.filter(t => t.alive).length, ammo = S.pads.reduce((n, p) => n + (p.alive ? p.ammo : 0), 0), m = multiplier(), tp = towers * 100 * m, ap = ammo * 5 * m; addScore(tp + ap);
  S.mode = 'bonus'; say('saved');
  menuShow(`<div class="panel center"><p class="eyebrow">CITY ${S.level} · ${cityName(S.level)}</p><h2>${towers === 6 ? 'CITY SAVED — ALL SIX STAND' : 'CITY SAVED'}</h2><div class="bonus-grid"><span>${towers} TOWERS × ${100 * m}</span><b>${fmt(tp)}</b><span>${ammo} MISSILES × ${5 * m}</span><b>${fmt(ap)}</b></div><p>NEXT: ${cityName(S.level + 1)}${S.reserve ? ' · ' + S.reserve + ' IN RESERVE' : ''}</p><div class="actions"><button id="next" class="primary">FLY ON</button></div></div>`);
  $('next').onclick = () => { if (blocked || lostGpu) return; SFX.unlock(true); S.level++; S.mode = 'playing'; beginLevel(); }; updateHUD();
}
function pauseGame() {
  if (S.mode !== 'playing') return; S.mode = 'paused';
  menuShow(`<div class="panel center"><p class="eyebrow">HOLDING PATTERN</p><h2>PAUSED</h2><p>${mobile ? 'Tap the sky to call a strike. Drag to fly — up and out of the canyon. Tap a radar blip for what you can’t see.' : 'Mouse aims, click calls a strike · W A S D flies, hold W to climb over the city · click a radar blip for what you can’t see<br>P or ENTER resumes'}</p><div class="actions"><button class="primary" id="resume">RESUME</button><button id="restart">RESTART</button></div></div>`);
  $('resume').onclick = resumeGame; $('restart').onclick = startGame; SFX.hush(); updateHUD();
}
function resumeGame() { if (blocked || lostGpu || S.mode !== 'paused') return; SFX.unlock(true); S.mode = 'playing'; menuHide(); last = performance.now(); acc = 0; updateHUD(); }
function endGame() {
  S.mode = 'over'; letters = [0, 0, 0]; slot = 0; const qualify = S.score > 0 && (scores.length < 8 || S.score > scores[scores.length - 1].score);
  menuShow(`<div class="panel center"><p class="eyebrow">CITY ${S.level} · ${cityName(S.level)}</p><h2>THE CITY HAS FALLEN</h2><div class="score-number">${fmt(S.score)}</div>${qualify ? `<p>HIGH SCORE · ${mobile ? 'ENTER' : 'TYPE'} YOUR INITIALS</p><div id="initials" class="initials"></div>` : '<p>All six towers are down.</p>'}<div class="actions">${qualify ? '<button id="save" class="primary">SAVE SCORE</button>' : '<button id="again" class="primary">PLAY AGAIN</button>'}<button id="home">MAIN MENU</button></div><p id="save-note" class="muted"></p></div>`);
  if (qualify) { drawInitials(); $('save').onclick = saveEntry; } else $('again').onclick = startGame;
  $('home').onclick = () => { if (qualify && !saved) saveEntry(false); showHome(); }; updateHUD();
}
function drawInitials() {
  $('initials').innerHTML = letters.map((n, i) => `<div class="letter${!mobile && !saved && i === Math.min(slot, 2) ? ' on' : ''}"><button data-letter="${i}" data-change="1" aria-label="Next letter ${i + 1}">+</button><span>${String.fromCharCode(65 + n)}</span><button data-letter="${i}" data-change="-1" aria-label="Previous letter ${i + 1}">−</button></div>`).join('');
  $('initials').querySelectorAll('button').forEach(b => b.onclick = () => { const i = +b.dataset.letter; letters[i] = (letters[i] + (+b.dataset.change) + 26) % 26; drawInitials(); });
}
function saveEntry(changeUI = true) {
  if (saved) return; saved = true; scores.push({ name: letters.map(n => String.fromCharCode(65 + n)).join(''), score: S.score, wave: S.level }); scores.sort((a, b) => b.score - a.score); scores = scores.slice(0, 8); writeScores();
  if (changeUI) { $('save').textContent = 'PLAY AGAIN'; $('save').onclick = startGame; $('save-note').textContent = storageOK ? 'HIGH SCORE SAVED' : 'Saved for this session. Browser storage is unavailable.'; drawInitials(); $('initials').querySelectorAll('button').forEach(b => b.disabled = true); } updateHUD();
}

// ------------------------------------------------------------------ size, and a governor that gives resolution back when the "load" was only a frame-rate cap
let baseRatio = 1, ratio = 1, gT = 0, gN = 0, gDowns = 0, gHold = 0, gPrev = 0;
function resize() {
  const r = $('arena').getBoundingClientRect(); mobile = isMobile(); blocked = mobile && window.innerWidth <= window.innerHeight; $('gate').hidden = !blocked;
  baseRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2); if (Q.has('dpr')) baseRatio = +Q.get('dpr') || 1; ratio = Math.min(ratio, baseRatio) || baseRatio; if (!gDowns) ratio = baseRatio;
  if (world) world.resize(r.width, r.height, ratio); overlay?.fit(r.width, r.height); radar?.fit(); if (blocked) pauseGame();
}
function govern(dt) {
  if (QA || !world) return; if (gHold > 0) { gHold -= dt; return; } gT += dt; gN++; if (gT < 2.5) return; const avg = gT / gN; gT = 0; gN = 0;
  if (avg > .0245 && ratio > .85) {
    if (gDowns >= 2 && Math.abs(avg - gPrev) < .0025 && avg > .029 && avg < .038) { ratio = baseRatio; gDowns = 0; gHold = 60; }   // two rungs down and nothing gained, at ~30 Hz: iOS Low Power Mode, not load
    else { ratio = Math.max(.85, ratio - .2); gDowns++; } gPrev = avg; resize(); }
}

// ------------------------------------------------------------------ controls
// Touch: a TAP calls a strike, a DRAG flies (from wherever it starts). Two thumbs work at once. Mouse: move aims, click fires, keys fly.
const touches = new Map();
const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.addEventListener('pointerdown', e => { e.preventDefault(); if (e.button !== 0) return; SFX.unlock(); const p = local(e);
  if (e.pointerType === 'mouse') { fireAt(p.x, p.y); return; } touches.set(e.pointerId, { x0: p.x, y0: p.y, t0: performance.now(), steer: false }); try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }, { passive: false });
canvas.addEventListener('pointermove', e => { const t = touches.get(e.pointerId); if (!t) return; const p = local(e), dx = p.x - t.x0, dy = p.y - t.y0;
  if (!t.steer && Math.hypot(dx, dy) > 14 && !ui.stick) { t.steer = true; ui.stick = { id: e.pointerId, x0: t.x0, y0: t.y0, ix: 0, iy: 0 }; }
  if (t.steer && ui.stick?.id === e.pointerId) { ui.stick.ix = clamp(dx / 64, -1, 1); ui.stick.iy = clamp(-dy / 56, -1, 1); } });
const release = (e, fire) => { const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId); if (ui.stick?.id === e.pointerId) { ui.stick = null; return; } if (fire && !t.steer && performance.now() - t.t0 < 650) { const p = local(e); fireAt(p.x, p.y); } };
canvas.addEventListener('pointerup', e => release(e, true)); canvas.addEventListener('pointercancel', e => release(e, false));
canvas.addEventListener('contextmenu', e => e.preventDefault());
for (const type of ['pointermove', 'pointerdown']) window.addEventListener(type, e => { if (e.pointerType !== 'touch') pointer = { x: e.clientX, y: e.clientY, sky: e.target === canvas }; }, true);   // sky: over the view itself, not the radar or a button

const KEYMAP = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down' };
const KEYCHAR = { a: 'left', d: 'right', w: 'up', s: 'down' };                                                // a fallback: on-screen keyboards and remote desktops send an empty code
function toggleFullscreen() { try { const f = document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.(); f?.catch?.(() => {}); } catch (e) {} }
document.addEventListener('keyup', e => { const k = KEYMAP[e.code] ?? KEYCHAR[e.key.toLowerCase()]; if (k) keys.delete(k); });
window.addEventListener('blur', () => keys.clear());
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || blocked || document.querySelector('#pb-menu .drawer.open')) return;
  const key = e.code === 'Space' ? ' ' : e.key.toLowerCase(), onButton = e.target instanceof HTMLButtonElement;
  if (S.mode === 'over' && !saved && $('initials')) {                                                          // typed initials first: W, A, S, D, P, M and F are letters too
    if (e.repeat) return; if (/^[a-z]$/.test(key)) { letters[Math.min(slot, 2)] = key.charCodeAt(0) - 97; slot = Math.min(3, slot + 1); drawInitials(); e.preventDefault(); return; }
    if (key === 'backspace') { slot = Math.max(0, slot - 1); letters[slot] = 0; drawInitials(); e.preventDefault(); return; } }
  const fly = KEYMAP[e.code] ?? KEYCHAR[key]; if (fly) { if (S.mode === 'playing') { keys.add(fly); e.preventDefault(); } return; }
  if (e.repeat) return;                                                                                        // a held key must not empty a pad
  if (onButton && (key === ' ' || key === 'enter')) return;                                                    // a focused button takes these natively
  if (key === ' ' || key === 'enter') { e.preventDefault(); if (!menu.hidden) menu.querySelector('.primary')?.click(); else if (key === ' ' && pointer) { const r = canvas.getBoundingClientRect(); fireAt(pointer.x - r.left, pointer.y - r.top); } }
  else if (key === 'p' || key === 'escape') $('pause').click(); else if (key === 'm') $('sound').click(); else if (key === 'f') toggleFullscreen();
});
// Panels take focus as they open and give it back as they close — Space on a hidden, still-focused FLY ON would skip a city.
new MutationObserver(() => { if (!menu.hidden) menu.querySelector('.primary')?.focus({ preventScroll: true }); else if (menu.contains(document.activeElement)) document.activeElement.blur(); }).observe(menu, { childList: true, attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('click', e => { if (e.target.closest('#pb-menu')) pauseGame(); else { const b = e.target.closest('#app button'); if (b) { SFX.voice('ui'); if (e.detail && b.closest('#tools')) b.blur(); } } });
$('full').onclick = toggleFullscreen;
$('pause').onclick = () => S.mode === 'paused' ? resumeGame() : pauseGame();
$('sound').onclick = () => { soundOn = !soundOn; SFX.unlock(soundOn); SFX.setSound(soundOn); try { localStorage.setItem(SETTINGS, soundOn ? 'on' : 'off'); } catch (e) {} updateHUD(); };
window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseGame(); SFX.keepAlive(false); } last = performance.now(); acc = 0; });
window.addEventListener('pagehide', pauseGame); window.addEventListener('blur', pauseGame);

// ------------------------------------------------------------------ the frame
const STEP = 1 / 60;
function paint(dt) {
  const r = pointer && !mobile ? canvas.getBoundingClientRect() : null;
  if (r && ui.live && pointer.sky && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom) { const x = pointer.x - r.left, y = pointer.y - r.top; ui.reticle = { x, y };
    const lx = (x / r.width - .5) * 2, ly = (.5 - y / r.height) * 2, dead = v => Math.sign(v) * Math.max(0, Math.abs(v) - .55) / .45; view.lookX += (dead(lx) * .8 - view.lookX) * .08; view.lookY += (dead(ly) * .8 - view.lookY) * .08;   // the edges of the screen turn your head
    const ray = world.ray(x, y), a = solveAim(ray.o, ray.d, 16, .06); ui.lock = a.lock ? world.project(a.target, {}) : null; }
  else { ui.reticle = null; ui.lock = null; view.lookX *= .92; view.lookY *= .92; }
  canvas.style.cursor = ui.reticle ? 'none' : '';
  { const c = S.craft; let ax = 0, ay = 0, best = 9; for (const e of S.enemies) { if (e.eta === undefined || e.eta > best) continue; const d = lean.subVectors(e.pos, c.pos), f = d.dot(c.T), len = d.length(); if (f < len * .25) continue; best = e.eta; ax = clamp(d.dot(c.R) / len, -1, 1) * .55; ay = clamp(d.dot(c.U) / len - .25, -.3, 1) * .5; }
    const k = dt > 0 ? 1 - Math.exp(-dt * 1.3) : 0; view.leanX += (ax - view.leanX) * k; view.leanY += (ay - view.leanY) * k; }
  ui.alt = S.craft.pos.y; ui.roof = CONFIG.roof; ui.top = CONFIG.altMax; ui.mobile = mobile;
  world.sync(S, dt, view); world.render(); radar.draw(S, city, css, S.total); overlay.draw(S, world, css, S.total, ui);
  $('hdg').textContent = String(Math.round((Math.atan2(S.craft.T.x, -S.craft.T.z) * 180 / Math.PI + 360) % 360)).padStart(3, '0');
  $('link').classList.toggle('lost', S.linkLost > 0); $('link-word').textContent = S.linkLost > 0 ? 'UPLINK JAMMED ' + S.linkLost.toFixed(1) : 'UPLINK';
}
function frame(now) {
  if (QA && window.__mcd?.hold) { last = now; requestAnimationFrame(frame); return; }               // QA: the test drives every step itself
  const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
  const running = !blocked && !document.hidden && !lostGpu && (S.mode === 'playing' || S.mode === 'falling' || S.demo);
  if (running) { acc += dt; let n = 0; while (acc >= STEP && n++ < 6) { simulate(STEP); acc -= STEP; } } else acc = 0;                  // PAUSE holds the world's clock too: dt 0 below
  SFX.engine(running && S.mode === 'playing' ? (S.intro > 0 ? .55 : 1) : 0, .92 + S.craft.s * .1 + clamp(S.craft.vy / 500, -.07, .1));
  paint(running ? dt : 0); govern(dt); requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
(async () => {
  try {
    SFX.init({ sound: soundOn, isPaused: () => S.mode === 'paused' }); document.fonts?.load('700 14px Rajdhani').catch(() => {});   // the overlay canvas can only draw a face the page has already loaded
    world = await createWorld(canvas, { mobile, quality: Q.get('quality') }); radar = createRadar($('radar')); overlay = createOverlay($('over'));
    world.onLost(() => { lostGpu = true; pauseGame(); SFX.hush(); const b = $('boot'); b.classList.remove('done'); $('boot-line').textContent = 'THE GRAPHICS CONTEXT WAS LOST'; $('boot-note').innerHTML = 'The browser took the GPU back — it happens to a tab left in the background. <a href="" onclick="location.reload();return false">Reload to fly again.</a>'; });
    resize(); showHome(); resize(); window.__mcdReady = true; $('boot').classList.add('done');
    if (QA) window.__mcd = { hold: Q.has('hold'), S, world, CONFIG, ui, view, sfx: SFX, start: startGame, fireAt, fireAtMap, launch, simulate, get city() { return city; },
      step(n = 1, render = true) { for (let i = 0; i < n; i++) simulate(STEP); if (render) paint(n * STEP); }, next() { S.level++; S.mode = 'playing'; beginLevel(); } };
    requestAnimationFrame(frame);
  } catch (err) { console.error(err); window.__mcdFail?.(String(err && err.message || err)); }
})();
