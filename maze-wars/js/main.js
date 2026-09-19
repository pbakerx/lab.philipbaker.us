/* Glue: the canvas, whole-number pixel scaling, mouse / touch / keys, and the frame loop. */
(function () {
  const G = MW.gfx, ui = MW.ui, game = MW.game;
  const canvas = document.getElementById('screen'), stage = document.getElementById('stage'), pad = document.getElementById('pad');
  G.attach(canvas);
  ui.touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  ui.ime = document.getElementById('ime'); ui.ime.addEventListener('input', () => ui.imeInput());
  if (ui.touch) document.documentElement.classList.add('touch');

  // Whole multiples of 512x342 stay razor sharp; a phone takes whatever fits.
  function fit() {
    const padH = ui.touch ? Math.min(150, innerHeight * 0.3) : 0, aw = innerWidth, ah = innerHeight - (innerWidth < innerHeight ? padH : 0);
    let s = Math.min(aw / 512, ah / 342); if (s >= 1) s = Math.floor(s * (s < 2 ? 4 : 1)) / (s < 2 ? 4 : 1); s = Math.max(0.3, s);
    canvas.style.width = Math.round(512 * s) + 'px'; canvas.style.height = Math.round(342 * s) + 'px';
  }
  addEventListener('resize', fit); addEventListener('orientationchange', fit); fit();

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(511, Math.floor((e.clientX - r.left) * 512 / r.width))), Math.max(0, Math.min(341, Math.floor((e.clientY - r.top) * 342 / r.height)))]; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (e.pointerType === 'mouse' && e.button !== 0) return; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } const p = pos(e); ui.mouse.x = p[0]; ui.mouse.y = p[1]; game.down(p[0], p[1]); });
  canvas.addEventListener('pointermove', (e) => { const p = pos(e); ui.move(p[0], p[1]); });
  canvas.addEventListener('pointerup', (e) => { const p = pos(e); ui.up(p[0], p[1]); });
  canvas.addEventListener('pointercancel', () => { ui.mouse.down = false; ui.pressed = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => { if (e.target === ui.ime && !(e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab')) return; game.keydown(e); });
  addEventListener('keyup', (e) => game.keyup(e));
  addEventListener('blur', () => game.blur());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.blur(); });

  if (pad) for (const b of pad.querySelectorAll('[data-a]')) { const a = b.dataset.a;
    const on = (e) => { e.preventDefault(); b.classList.add('on'); game.press(a, true); }, off = (e) => { e.preventDefault(); b.classList.remove('on'); game.press(a, false); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); b.addEventListener('contextmenu', (e) => e.preventDefault()); }

  // rAF draws; a slow timer keeps the network heartbeat alive in a background tab
  let last = 0; const tick = () => { last = performance.now(); game.frame(last); };
  const loop = () => { tick(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  setInterval(() => { if (performance.now() - last > 400) tick(); }, 500);
  if (new URLSearchParams(location.search).get('shot')) { // social-card pose: 2x, pinned to the top, no chrome
    stage.style.justifyContent = 'flex-start'; canvas.style.width = '1024px'; canvas.style.height = '684px'; canvas.style.borderRadius = '0'; removeEventListener('resize', fit); const hide = document.createElement('style'); hide.textContent = '#pb-menu{display:none!important}'; document.head.appendChild(hide);
    const warm = MW.art.warm(); while (!warm.next().done) { } game.demo(); return; }
  game.start();
})();
