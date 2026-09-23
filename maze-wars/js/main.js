/* Glue: the canvas, whole-number pixel scaling, mouse / touch / keys, and the frame loop. */
(function () {
  const G = MW.gfx, ui = MW.ui, game = MW.game;
  const canvas = document.getElementById('screen'), stage = document.getElementById('stage'), root = document.documentElement;
  const Q = new URLSearchParams(location.search), SHOT = !!Q.get('shot');
  G.attach(canvas);
  ui.touch = Q.get('touch') === '1' || (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);   // ?touch=1 shows the phone layout on a desktop
  ui.canvas = canvas; ui.stage = stage;
  ui.ime = document.getElementById('ime'); ui.ime.addEventListener('input', () => ui.imeInput());
  if (ui.touch) root.classList.add('touch');

  // Whole multiples of 512x342 stay razor sharp; a phone takes whatever fits.
  const size = (s) => { if (s >= 1) s = Math.floor(s * (s < 2 ? 4 : 1)) / (s < 2 ? 4 : 1); s = Math.max(0.3, s); canvas.style.width = Math.round(512 * s) + 'px'; canvas.style.height = Math.round(342 * s) + 'px'; return s; };
  // A phone: the screen goes to the top (in a tall window that also keeps every dialog clear of the keyboard), a cluster of
  // controls under each thumb, and --dp — the round pad's diameter — is as big as whatever room is left will allow.
  let probe = null;
  const inset = () => { if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(probe); }
    const c = getComputedStyle(probe); return { t: parseFloat(c.paddingTop) || 0, r: parseFloat(c.paddingRight) || 0, b: parseFloat(c.paddingBottom) || 0, l: parseFloat(c.paddingLeft) || 0 }; };
  function fitTouch(force) {
    if (!force && (ui.typing || ui.isIme(document.activeElement))) return;   // the keyboard is up: a layout that moves under it can drop it
    const i = inset(), aw = innerWidth - i.l - i.r, ah = innerHeight - i.t - i.b, land = aw > ah;
    root.classList.toggle('land', land); root.classList.toggle('port', !land);
    const s = size(land ? Math.min((aw - 2 * Math.max(132, Math.min(190, aw * 0.2))) / 512, ah / 342) : Math.min(aw / 512, (ah - 60 - 236) / 342));
    const strip = !land && !SHOT && ah - 60 - 342 * s - 82 - 54 >= 150; root.classList.toggle('nav', strip);                  // the strip: upright only, and only if the pad keeps at least 150px
    const dp = land ? Math.min((aw - 512 * s) / 2 - 22, ah - 66) : Math.min(ah - 60 - 342 * s - 82 - (strip ? 54 : 0), aw / 2 - 22);
    const px = Math.round(Math.max(land ? 108 : 128, Math.min(land ? 200 : 220, dp))); root.style.setProperty('--dp', px + 'px'); root.classList.toggle('snug', px < 140);
    ui.placeIME();
  }
  function fit(force) {
    if (ui.touch) return fitTouch(force === true);
    const s = size(Math.min(innerWidth / 512, innerHeight / 342));
    // The strip: the screen is sized FIRST and never gives any room up. Under it if 76px are spare there; else beside it (a wide, short
    // laptop window) if 112px are spare there; else not at all — the Mac's own menus are always there.
    const cw = Math.round(512 * s), below = innerHeight - Math.round(342 * s) >= 76, beside = !below && (innerWidth - cw) / 2 >= 112;
    root.style.setProperty('--cw', cw + 'px'); root.classList.toggle('nav', !SHOT && below); root.classList.toggle('navside', !SHOT && beside);
  }
  addEventListener('resize', fit); addEventListener('orientationchange', () => fit(true)); fit(true);

  // ui.inGesture: true only while a tap is being handled. A phone raises its keyboard for focus() inside a tap and at no other time.
  const tap = (fn) => (e) => { ui.inGesture = true; try { fn(e); } finally { ui.inGesture = false; } };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(511, Math.floor((e.clientX - r.left) * 512 / r.width))), Math.max(0, Math.min(341, Math.floor((e.clientY - r.top) * 342 / r.height)))]; };
  canvas.addEventListener('pointerdown', tap((e) => { e.preventDefault(); if (e.pointerType === 'mouse' && e.button !== 0) return; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } const p = pos(e); ui.mouse.x = p[0]; ui.mouse.y = p[1]; game.down(p[0], p[1]); }));
  canvas.addEventListener('pointermove', (e) => { const p = pos(e); ui.move(p[0], p[1]); game.move(p[0], p[1]); });
  canvas.addEventListener('pointerup', tap((e) => { const p = pos(e); const taken = ui.up(p[0], p[1]); game.up(p[0], p[1], taken); }));
  canvas.addEventListener('pointercancel', () => { ui.mouse.down = false; ui.pressed = null; game.up(-1, -1, true); });
  canvas.addEventListener('wheel', (e) => { const p = pos(e); if (game.wheel(p[0], p[1], e.deltaY)) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => { if (ui.isIme(e.target) && !(e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab')) return; game.keydown(e); });
  addEventListener('keyup', (e) => game.keyup(e));
  addEventListener('blur', () => game.blur());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.blur(); });

  if (ui.touch) {
    const stop = (e) => e.preventDefault(), quiet = (el) => { for (const t of ['touchstart', 'touchend']) el.addEventListener(t, stop, { passive: false }); el.addEventListener('mousedown', stop); el.addEventListener('contextmenu', stop); };
    // After a touch iOS replays it as a mouse click, and a mouse click on something that cannot take focus — a canvas — takes
    // focus AWAY from the text field: the keyboard came up and went straight back down. No replay, no blur.
    quiet(canvas);
    // iOS counts a touch as "the user did something" when the finger LIFTS, so sound is unlocked there as well as on the press
    document.addEventListener('touchend', () => { try { MW.audio.unlock(); } catch (e) { } }, { capture: true, passive: true });
    const buzz = () => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(8); } catch (e) { } };   // Android; iOS has no vibrate

    // THE ROUND PAD IS A JOYSTICK (Philip, Sep 22 2026: "make the mobile arrows work as though they're a joystick… i want to just mash it
    // down and drive the character… press and hold and then use the thumb position on the wheel"). The whole left column is the grab
    // area, not only the wheel. A thumb planted on the middle of the wheel — or anywhere in the column — takes hold of the stick at rest:
    // where it landed is neutral, and pushing from there gives the direction (a floating stick, as most phone games do it). A thumb
    // planted on the RIM, on an arrow, has already pushed the stick that way and acts at once, so a tap on an arrow still works as a
    // button. Direction is by angle, and holds until 14 degrees past the diagonal so a thumb lying on the line cannot chatter; letting
    // the stick back to the middle stops. The knob follows the thumb, so the wheel reads as what it is.
    // THE STICK IS THE MAP (Philip, the same evening: "If I jam it left, the player should 'move left', not turn left… The joy stick is
    // always forward and it mirrors what we see on the radar"). Up is north, left is west, as on the map: every push MOVES you, turning
    // you to face that way as you go — the original's own compass keys. Turning in place moved to the two buttons above the wheel.
    const padL = document.getElementById('padL'), dp = document.getElementById('dpad'), knob = dp.querySelector('.knob'), ORDER = ['east', 'south', 'west', 'north'];
    let pid = null, cur = null, ox = 0, oy = 0, R = 80;
    const set = (a) => { if (a === cur) return; if (cur) game.press(cur, false); cur = a; dp.dataset.on = a || ''; if (a) { game.press(a, true); buzz(); } };
    const stick = (e) => { const dx = e.clientX - ox, dy = e.clientY - oy, d = Math.hypot(dx, dy), dead = Math.max(12, R * 0.16); let a = null;
      if (d >= (cur ? dead * 0.7 : dead)) { let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360; a = ORDER[Math.round(ang / 90) % 4];
        if (cur) { let off = Math.abs(ang - ORDER.indexOf(cur) * 90); if (off > 180) off = 360 - off; if (off < 59) a = cur; } }
      set(a); const lim = R * 0.68, f = (d > lim ? lim / d : 1) * 100 / R; knob.style.transform = 'translate(' + (dx * f).toFixed(1) + 'px, ' + (dy * f).toFixed(1) + 'px)'; };
    const grab = (e) => { const r = dp.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; R = Math.max(40, (r.width - 28) / 2);
      const d = Math.hypot(e.clientX - cx, e.clientY - cy), onRim = d > R * 0.5 && d <= R + 14;      // on the wheel's outer half: the stick is already pushed that way. Off the wheel: a plain grab.
      ox = onRim ? cx : e.clientX; oy = onRim ? cy : e.clientY; dp.classList.add('live'); stick(e); };
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; set(null); dp.classList.remove('live'); knob.style.transform = ''; };
    quiet(padL);
    padL.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { padL.setPointerCapture(pid); } catch (x) { } grab(e); });
    padL.addEventListener('pointermove', (e) => { if (e.pointerId === pid) stick(e); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) padL.addEventListener(t, end);

    for (const b of document.querySelectorAll('.pad button[data-a]')) { const a = b.dataset.a;
      // the envelope opens a text field, so it has to be a real click: that is the one moment a phone will raise its keyboard
      if (a === 'msg') { b.addEventListener('click', tap(() => game.press('msg', true))); b.addEventListener('contextmenu', stop); continue; }
      let bp = null;
      const off = (e) => { if (e.pointerId !== bp) return; bp = null; b.classList.remove('on'); game.press(a, false); };
      quiet(b);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (bp !== null) return; bp = e.pointerId; try { b.setPointerCapture(bp); } catch (x) { } b.classList.add('on'); game.press(a, true); buzz(); });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, off);
    }

    // When the keyboard goes away iOS can leave the page scrolled, or a few pixels out (26.0 shipped exactly that): put it back.
    const settle = () => { if (ui.typing || ui.isIme(document.activeElement)) return; try { scrollTo(0, 0); } catch (e) { } fit(true); };
    ui.onTyping = (on) => { if (!on) { setTimeout(settle, 80); setTimeout(settle, 450); } };
    if (window.visualViewport) visualViewport.addEventListener('resize', () => fit());
  }

  // ---- the strip under the screen: modern buttons for the game's own windows. The Mac above is not touched: each button runs the
  // very menu item it names (ui.pick), so "is it enabled?" and "is a dialog in the way?" are answered exactly as the menu answers them.
  // Invite is the exception, because a browser can do better than a 1986 dialog: a phone's own share sheet, a copied link elsewhere.
  const toast = document.getElementById('toast'); let toastT = 0; const say = (s) => { toast.textContent = s; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 2600); };
  async function invite() { const url = 'https://lab.philipbaker.us/maze-wars/' + (game.cfg.zone ? '?line=' + game.cfg.zone : ''), text = 'Come and play Maze Wars+ with me: the 1986 Macintosh network shooter, in your browser.';
    if (ui.touch && navigator.share) { try { await navigator.share({ title: 'Maze Wars+', text, url }); } catch (e) { } return; }
    try { await navigator.clipboard.writeText(url); say(game.cfg.zone ? 'Private-line link copied. Send it to a friend.' : 'Link copied. Send it to a friend.'); } catch (e) { ui.pick('Invite a Friend'); } }
  // ON A PHONE the strip also works BEFORE play (Philip, Sep 21: "the welcome screen mutes the new buttons… only fix the mobile").
  // The menu items are switched off until you are playing, so ui.pick would refuse — and simply opening High Scores over the welcome page
  // would strand you: close it and no dialog is left, with sign-in never reached. So the window you were on (the welcome page; the name
  // box for someone who skips it) is remembered ONCE, the thing you asked for opens, and the frame loop puts you back when it has all
  // been closed — however you got out of it, including the windows that lead to one another.
  let stripBack = null;
  const OPEN = { 'High Scores': () => MW.club.scores(), 'Suggest a Feature': () => MW.club.request(), 'Everyone': () => MW.club.ideas(), 'High Score Card': () => MW.club.card() };
  function welcomePick(go) { const d = ui.dialog; if (!d || ui.busy) return;                       // still reading the mazes: nothing to come back to yet
    if (go === 'How to Play') { if (d.isHowTo) return; if (!stripBack) stripBack = d; ui.close(); if (!stripBack.isHowTo) MW.club.howTo(); return; }   // (from the welcome page's own windows, closing is enough: it comes back)
    if (!OPEN[go]) return; if (!stripBack) stripBack = d; ui.close(); OPEN[go](); }
  for (const b of document.querySelectorAll('#bar button')) b.addEventListener('click', tap(() => { b.blur(); const playing = game.dev.phase === 'play';      // blur: Space is FIRE, and must not press this button again
    if (!playing && !ui.touch) return; if (b.dataset.go === 'invite') invite(); else if (playing) ui.pick(b.dataset.go); else welcomePick(b.dataset.go); }));
  let seenPhase = '';

  // rAF draws. In a hidden tab rAF stops, so something else has to keep the player's heartbeat going — and it cannot be a timer
  // of this page's: Chrome slows a hidden page's timers to one a second, and after five minutes to one a MINUTE, which is how a
  // window left in the background fell off the network (Sep 20 2026). A worker's clock is not slowed, so the tick comes from one;
  // the page timer stays as the fallback for a browser that will not start a worker.
  let last = 0; const tick = () => { last = performance.now(); game.frame(last); const ph = game.dev.phase; if (ph !== seenPhase) { seenPhase = ph; root.classList.toggle('playing', ph === 'play'); }
    if (stripBack) { if (ph === 'play') stripBack = null; else if (!ui.dialog) { const d = stripBack; stripBack = null; ui.show(d); } } };
  const loop = () => { tick(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const slow = () => { if (performance.now() - last > 400) tick(); };
  setInterval(slow, 500);
  try { const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 500);'], { type: 'text/javascript' }))); w.onmessage = slow; } catch (e) { }
  if (Q.get('shot')) { // social-card pose: 2x, pinned to the top, no chrome
    stage.style.justifyContent = 'flex-start'; canvas.style.width = '1024px'; canvas.style.height = '684px'; canvas.style.borderRadius = '0'; removeEventListener('resize', fit); const hide = document.createElement('style'); hide.textContent = '#pb-menu{display:none!important}'; document.head.appendChild(hide);
    const warm = MW.art.warm(); while (!warm.next().done) { } game.demo(); return; }
  game.start();
})();
