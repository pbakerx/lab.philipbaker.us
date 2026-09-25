/**
 * Holo — dependency-free holographic glass overlay (Minority Report style).
 * Holo.open({anchor,title,html,wide}) -> panel el; Holo.close(); Holo.isOpen() -> bool.
 * Holo.tip(anchor, text) shows a hover tooltip after 120ms; call again to update text.
 * Pair with holo.css. `html`/tip `text` render via innerHTML/textContent respectively.
 */
(function () {
  'use strict';

  // ---- shared state ------------------------------------------------------
  var panelEl = null;            // the open .holo panel, or null
  var panelAnchor = null;        // its anchor element, or null (centered)
  var rafId = null;              // requestAnimationFrame id for the idle canvas fx
  var keyHandler = null;
  var docClickHandler = null;
  var tipEl = null;              // the visible .holo-tip, or null
  var tipStore = new WeakMap();  // anchor -> current tooltip text
  function reducedMotion() {
    try { return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  // ---- placement: below anchor if room else above; clamped to viewport --
  function placeNear(el, anchorEl, margin) {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    var w = el.offsetWidth, h = el.offsetHeight, top, left;
    var a = (anchorEl && anchorEl.isConnected) ? anchorEl.getBoundingClientRect() : null;
    if (a) {
      top = (vh - a.bottom - margin >= h) ? a.bottom + 8 : a.top - h - 8;
      left = a.left;
    } else {
      top = (vh - h) / 2;
      left = (vw - w) / 2;
    }
    el.style.left = clamp(left, margin, Math.max(margin, vw - w - margin)) + 'px';
    el.style.top = clamp(top, margin, Math.max(margin, vh - h - margin)) + 'px';
  }
  function reposition() { if (panelEl) placeNear(panelEl, panelAnchor, 12); }

  // ---- idle canvas fx: drifting particles + a faint scanning band -------
  function startIdleFx(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cyan = cssVar('--cyan', '#5fd4ff');
    var lime = cssVar('--lime', '#9dff6b');
    var particles = [];
    for (var i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random(),
        vy: 0.05 + Math.random() * 0.12,
        a: 0.12 + Math.random() * 0.25,
        c: Math.random() < 0.5 ? cyan : lime
      });
    }
    var band = 0;
    function frame() {
      if (!canvas.isConnected) { rafId = null; return; }
      ctx.clearRect(0, 0, w, h);
      band = (band + 0.12) % (h + 60);
      var g = ctx.createLinearGradient(0, band - 30, 0, band + 30);
      g.addColorStop(0, 'rgba(95,212,255,0)');
      g.addColorStop(0.5, 'rgba(95,212,255,.06)');
      g.addColorStop(1, 'rgba(95,212,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, band - 30, w, 60);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.y += p.vy;
        if (p.y > h) { p.y = 0; p.x = Math.random() * w; }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---- panel: open --------------------------------------------------------
  function open(opts) {
    opts = opts || {};
    close(); // only one panel at a time
    var anchor = (opts.anchor && opts.anchor.nodeType === 1) ? opts.anchor : null;
    var reduced = reducedMotion();
    var panel = document.createElement('div');
    panel.className = 'holo' + (opts.wide ? ' wide' : '');
    var tl = document.createElement('span'); tl.className = 'holo-br tl';
    var tr = document.createElement('span'); tr.className = 'holo-br tr';
    var bl = document.createElement('span'); bl.className = 'holo-br bl';
    var br = document.createElement('span'); br.className = 'holo-br br';
    var canvas = document.createElement('canvas'); canvas.className = 'holo-fx';
    var kicker = document.createElement('div'); kicker.className = 'holo-kicker';
    kicker.textContent = opts.title || '';
    var body = document.createElement('div'); body.className = 'holo-body';
    if (opts.html) body.innerHTML = opts.html;
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'holo-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    panel.appendChild(tl);
    panel.appendChild(tr);
    panel.appendChild(bl);
    panel.appendChild(br);
    panel.appendChild(canvas);
    panel.appendChild(kicker);
    panel.appendChild(body);
    panel.appendChild(closeBtn);
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    closeBtn.addEventListener('click', close);
    document.body.appendChild(panel);
    panelEl = panel;
    panelAnchor = anchor;
    reposition();
    void panel.offsetWidth; // commit initial state so the transition below runs
    panel.classList.add('holo-in');
    if (!reduced) {
      var scan = document.createElement('div');
      scan.className = 'holo-scan';
      panel.appendChild(scan);
      var dropScan = function () { if (scan.parentNode) scan.parentNode.removeChild(scan); };
      scan.addEventListener('animationend', dropScan);
      setTimeout(dropScan, 750);
      startIdleFx(canvas);
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    keyHandler = function (e) { if (e.key === 'Escape' || e.key === 'Esc') close(); };
    document.addEventListener('keydown', keyHandler);
    docClickHandler = function () { close(); };
    setTimeout(function () { document.addEventListener('click', docClickHandler); }, 0);
    return panel;
  }

  // ---- panel: close --------------------------------------------------------
  function close() {
    if (!panelEl) return;
    var panel = panelEl;
    panelEl = null;
    panelAnchor = null;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (docClickHandler) document.removeEventListener('click', docClickHandler);
    keyHandler = null;
    docClickHandler = null;
    panel.classList.remove('holo-in');
    panel.classList.add('holo-out');
    setTimeout(function () { if (panel.parentNode) panel.parentNode.removeChild(panel); }, 160);
  }
  function isOpen() { return !!panelEl; }

  // ---- tooltip: show/hide + public attach point --------------------------
  function showTip(anchor, text) {
    hideTip();
    if (!anchor || !anchor.isConnected) return;
    var el = document.createElement('div');
    el.className = 'holo-tip';
    el.textContent = text || '';
    document.body.appendChild(el);
    tipEl = el;
    placeNear(el, anchor, 12);
    void el.offsetWidth;
    el.classList.add('holo-in');
  }
  function hideTip() {
    if (!tipEl) return;
    var el = tipEl;
    tipEl = null;
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  function tip(anchor, text) {
    if (!anchor || anchor.nodeType !== 1) return;
    var already = tipStore.has(anchor);
    tipStore.set(anchor, text == null ? '' : String(text));
    if (already) return; // text updated in place; listeners already bound
    var timer = null;
    var show = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { showTip(anchor, tipStore.get(anchor)); }, 120);
    };
    var hide = function () { clearTimeout(timer); hideTip(); };
    anchor.addEventListener('mouseenter', show);
    anchor.addEventListener('focus', show);
    anchor.addEventListener('mouseleave', hide);
    anchor.addEventListener('blur', hide);
    anchor.addEventListener('click', hide);
  }

  window.Holo = { open: open, close: close, isOpen: isOpen, tip: tip };
})();
