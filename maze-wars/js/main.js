/* Glue: the canvas, whole-number pixel scaling, mouse / touch / keys, and the frame loop. */
(function () {
  const G = MW.gfx, ui = MW.ui, game = MW.game;
  const canvas = document.getElementById('screen'), stage = document.getElementById('stage'), root = document.documentElement;
  const Q = new URLSearchParams(location.search);
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
    const dp = land ? Math.min((aw - 512 * s) / 2 - 22, ah - 66) : Math.min(ah - 60 - 342 * s - 82, aw / 2 - 22);
    const px = Math.round(Math.max(land ? 108 : 128, Math.min(land ? 200 : 220, dp))); root.style.setProperty('--dp', px + 'px'); root.classList.toggle('snug', px < 140);
    ui.placeIME();
  }
  function fit(force) {
    if (ui.touch) return fitTouch(force === true);
    size(Math.min(innerWidth / 512, innerHeight / 342));
  }
  addEventListener('resize', fit); addEventListener('orientationchange', () => fit(true)); fit(true);

  // ui.inGesture: true only while a tap is being handled. A phone raises its keyboard for focus() inside a tap and at no other time.
  const tap = (fn) => (e) => { ui.inGesture = true; try { fn(e); } finally { ui.inGesture = false; } };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(511, Math.floor((e.clientX - r.left) * 512 / r.width))), Math.max(0, Math.min(341, Math.floor((e.clientY - r.top) * 342 / r.height)))]; };
  canvas.addEventListener('pointerdown', tap((e) => { e.preventDefault(); if (e.pointerType === 'mouse' && e.button !== 0) return; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } const p = pos(e); ui.mouse.x = p[0]; ui.mouse.y = p[1]; game.down(p[0], p[1]); }));
  canvas.addEventListener('pointermove', (e) => { const p = pos(e); ui.move(p[0], p[1]); });
  canvas.addEventListener('pointerup', tap((e) => { const p = pos(e); ui.up(p[0], p[1]); }));
  canvas.addEventListener('pointercancel', () => { ui.mouse.down = false; ui.pressed = null; });
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

    // The round pad is read by ANGLE from its centre, not by which arrow was hit: "turn left" is everything to the left, a
    // target several times the size of a button and impossible to fall between. Slide from one to the next without lifting;
    // a direction holds until the thumb is 14 degrees past the diagonal, so a thumb resting on the line cannot chatter; the
    // middle is a rest. Eyes stay on the hall.
    const dp = document.getElementById('dpad'), ORDER = ['right', 'back', 'left', 'fwd'];
    let pid = null, cur = null;
    const sector = (e) => { const r = dp.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.09) return null;
      let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 360;
      if (cur) { let off = Math.abs(a - ORDER.indexOf(cur) * 90); if (off > 180) off = 360 - off; if (off < 59) return cur; }
      return ORDER[Math.round(a / 90) % 4]; };
    const set = (a) => { if (a === cur) return; if (cur) game.press(cur, false); cur = a; dp.dataset.on = a || ''; if (a) { game.press(a, true); buzz(); } };
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; set(null); };
    quiet(dp);
    dp.addEventListener('pointerdown', (e) => { e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { dp.setPointerCapture(pid); } catch (x) { } set(sector(e)); });
    dp.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(sector(e)); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) dp.addEventListener(t, end);

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

  // rAF draws. In a hidden tab rAF stops, so something else has to keep the player's heartbeat going — and it cannot be a timer
  // of this page's: Chrome slows a hidden page's timers to one a second, and after five minutes to one a MINUTE, which is how a
  // window left in the background fell off the network (Sep 20 2026). A worker's clock is not slowed, so the tick comes from one;
  // the page timer stays as the fallback for a browser that will not start a worker.
  let last = 0; const tick = () => { last = performance.now(); game.frame(last); };
  const loop = () => { tick(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const slow = () => { if (performance.now() - last > 400) tick(); };
  setInterval(slow, 500);
  try { const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 500);'], { type: 'text/javascript' }))); w.onmessage = slow; } catch (e) { }
  if (Q.get('shot')) { // social-card pose: 2x, pinned to the top, no chrome
    stage.style.justifyContent = 'flex-start'; canvas.style.width = '1024px'; canvas.style.height = '684px'; canvas.style.borderRadius = '0'; removeEventListener('resize', fit); const hide = document.createElement('style'); hide.textContent = '#pb-menu{display:none!important}'; document.head.appendChild(hide);
    const warm = MW.art.warm(); while (!warm.next().done) { } game.demo(); return; }
  game.start();
})();
