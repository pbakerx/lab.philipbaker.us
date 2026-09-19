/* A pocket Macintosh Toolbox: menu bar, pull-down menus, modal dialogs and their controls,
   drawn into the one-bit framebuffer. Menus work both ways — press-drag-release as in 1986,
   or click-to-open and click again. */
window.MW = window.MW || {};
(function () {
  const G = MW.gfx, CHI = () => MW.FONT.chi, GEN = () => MW.FONT.gen;
  const CURSORS = {
    arrow: { hx: 0, hy: 0, rows: ['#', '##', '#.#', '#..#', '#...#', '#....#', '#.....#', '#......#', '#.......#', '#........#', '#.....#####', '#..#..#', '#.#.#..#', '##..#..#', '#....#..#', '.....#..#', '......##'] },
    cross: { hx: 7, hy: 7, rows: ['', '', '.......#', '.......#', '.......#', '', '', '..###..#..###', '', '', '.......#', '.......#', '.......#'] },
    ibeam: { hx: 3, hy: 7, rows: ['##.##', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '..#', '##.##'] },
    eye: { hx: 7, hy: 7, rows: ['.....######', '...##########', '..############', '.#####....#####', '.###..####..###', '##..########..##', '#.##.######.##.#', '##...##..##...##', '#....##..##....#', '##...######...##', '####..####..####', '.#####....#####', '.##############', '..############', '...##########', '.....######'] }
  };
  // ink, plus a one-pixel white halo so the pointer reads over any dither; 'fill' cursors are white inside
  function drawCursor(kind, x, y) {
    const c = CURSORS[kind] || CURSORS.arrow, fill = kind === 'arrow' || kind === 'eye';
    const ink = (i, j) => { const r = c.rows[j]; return !!r && r[i] === '#'; };
    const body = (i, j) => { const r = c.rows[j]; if (!r) return false; if (r[i] === '#') return true; if (!fill) return false; const a = r.indexOf('#'), b = r.lastIndexOf('#'); return a >= 0 && i > a && i < b; };
    let w = 0; for (const r of c.rows) w = Math.max(w, r.length);
    for (let j = -1; j <= c.rows.length; j++) for (let i = -1; i <= w; i++)
      if (body(i, j) || body(i - 1, j) || body(i + 1, j) || body(i, j - 1) || body(i, j + 1)) G.pset(x - c.hx + i, y - c.hy + j, ink(i, j) ? 1 : 0);
  }

  const ui = MW.ui = {
    mouse: { x: 256, y: 171, down: false, seen: false }, cursor: 'arrow', busy: false,
    menus: [], open: -1, hot: -1, sticky: false, flash: null,
    dialog: null, caretOn: true,
    // ---------- menu bar ----------
    layoutMenus() { let x = 19; for (const m of ui.menus) { m.w = G.textW(CHI(), m.title); m.x = x; m.x0 = x - 8; m.x1 = x + m.w + 7; x += m.w + 15; } },
    menuRect(m) { let w = 60; for (const it of m.items) if (!it.sep) { let iw = 16 + G.textW(CHI(), it.label) + (it.key ? 40 : 12); if (iw > w) w = iw; } return { x: m.x0, y: 20, w, h: m.items.length * 16 + 2 }; },
    drawBar() {
      G.fill(0, 0, 512, 20, 0); G.hline(0, 511, 20, 1);
      const corner = [5, 3, 2, 1, 1]; for (let j = 0; j < 5; j++) { G.hline(0, corner[j] - 1, j, 1); G.hline(512 - corner[j], 511, j, 1); G.hline(0, corner[j] - 1, 341 - j, 1); G.hline(512 - corner[j], 511, 341 - j, 1); }
      ui.menus.forEach((m, i) => { const on = i === ui.open || (ui.flash && ui.flash.i === i); if (on) G.fill(m.x0, 1, m.x1 - m.x0, 19, 1); G.text(CHI(), m.title, m.x, 14, on ? 0 : 1, m.dim && m.dim()); });
      if (ui.open >= 0) { const m = ui.menus[ui.open], r = ui.menuRect(m);
        G.fill(r.x + 2, r.y + 2, r.w + 1, r.h + 1, 1); G.fill(r.x, r.y, r.w, r.h, 0); G.frame(r.x, r.y, r.w + 1, r.h + 1, 1);
        m.items.forEach((it, k) => { const y = r.y + 1 + k * 16;
          if (it.sep) { for (let x = r.x + 1; x < r.x + r.w; x += 2) G.pset(x, y + 8, 1); return; }
          const off = it.enabled && !it.enabled(), on = k === ui.hot && !off;
          if (on) G.fill(r.x + 1, y, r.w - 1, 16, 1);
          if (it.check && it.check()) G.text(CHI(), '✓', r.x + 3, y + 12, on ? 0 : 1);
          G.text(CHI(), it.label, r.x + 15, y + 12, on ? 0 : 1, off);
          if (it.key) { G.text(CHI(), '⌘', r.x + r.w - 30, y + 12, on ? 0 : 1, off); G.text(CHI(), it.key, r.x + r.w - 16, y + 12, on ? 0 : 1, off); } });
      }
    },
    menuHit(x, y) { if (y >= 20) return -1; for (let i = 0; i < ui.menus.length; i++) if (x >= ui.menus[i].x0 && x < ui.menus[i].x1) return i; return -1; },
    itemHit(x, y) { if (ui.open < 0) return -1; const m = ui.menus[ui.open], r = ui.menuRect(m); if (x < r.x || x > r.x + r.w || y < r.y + 1 || y >= r.y + r.h - 1) return -1; const k = Math.floor((y - r.y - 1) / 16); return m.items[k] && !m.items[k].sep ? k : -1; },
    choose(mi, k) { const it = ui.menus[mi] && ui.menus[mi].items[k]; ui.open = -1; ui.hot = -1; ui.sticky = false; if (it && !it.sep && !(it.enabled && !it.enabled()) && it.action) it.action(); },
    // command-key equivalents; returns true if one matched
    cmdKey(ch) { ch = ch.toUpperCase(); for (let i = 0; i < ui.menus.length; i++) for (let k = 0; k < ui.menus[i].items.length; k++) { const it = ui.menus[i].items[k]; if (it.key === ch) { if (!(it.enabled && !it.enabled())) { ui.flash = { i, until: performance.now() + 120 }; it.action && it.action(); } return true; } } return false; },

    // ---------- dialogs ----------
    // d = {x,y,w,h, plain?, items:[…], onOpen?, onKey?}; items: text/edit/button/radio/check/custom
    show(d) { ui.dialog = d; d.focus = d.items.findIndex(i => i.t === 'edit'); for (const it of d.items) if (it.t === 'edit') { it.value = it.value || ''; it.sel = it.value.length > 0; } ui.open = -1; if (d.onOpen) d.onOpen(d); ui.syncIME(); },
    close() { ui.dialog = null; ui.syncIME(); },
    field(id) { const d = ui.dialog; return d && d.items.find(i => i.id === id); },
    drawDialog() {
      const d = ui.dialog; if (!d) return; const ox = d.x, oy = d.y;
      if (d.plain) { G.fill(ox - 1, oy - 1, d.w + 2, d.h + 2, 0); G.frame(ox - 1, oy - 1, d.w + 2, d.h + 2, 1); G.fill(ox + 1, oy + d.h + 1, d.w + 1, 1, 1); G.fill(ox + d.w + 1, oy + 1, 1, d.h + 1, 1); }
      else { G.fill(ox - 8, oy - 8, d.w + 16, d.h + 16, 0); G.frame(ox - 8, oy - 8, d.w + 16, d.h + 16, 1); G.frame(ox - 5, oy - 5, d.w + 10, d.h + 10, 1); G.frame(ox - 4, oy - 4, d.w + 8, d.h + 8, 1); }
      d.items.forEach((it, idx) => {
        if (it.hidden && it.hidden()) return; const x = ox + it.x, y = oy + it.y;
        if (it.t === 'text') { const s = typeof it.s === 'function' ? it.s() : it.s; const lines = it.w ? [].concat(...String(s).split('\r').map(l => G.wrap(CHI(), l, it.w))) : String(s).split('\r'); lines.forEach((l, k) => G.text(CHI(), l, x, y + 11 + k * 16, 1)); }
        else if (it.t === 'button') { const dn = ui.pressed === it && ui.overPressed; G.rrect(x, y, it.w, it.h, 8, 1, dn ? 1 : 0); G.textC(CHI(), typeof it.label === 'function' ? it.label() : it.label, x + it.w / 2, y + Math.floor(it.h / 2) + 4, dn ? 0 : 1); if (it.def) { G.rrect(x - 4, y - 4, it.w + 8, it.h + 8, 11, 1); G.rrect(x - 3, y - 3, it.w + 6, it.h + 6, 10, 1); G.rrect(x - 2, y - 2, it.w + 4, it.h + 4, 9, 1); } }
        else if (it.t === 'radio') { G.ellipse(x + 6, y + 8, 5, 5, 1, 0); if (ui.pressed === it && ui.overPressed) G.ellipse(x + 6, y + 8, 4, 4, 1); if (it.on()) G.ellipse(x + 6, y + 8, 2, 2, 1, 1); G.text(CHI(), it.label, x + 18, y + 12, 1); }
        else if (it.t === 'check') { G.fill(x + 1, y + 3, 11, 11, 0); G.frame(x + 1, y + 3, 11, 11, 1); if (ui.pressed === it && ui.overPressed) G.frame(x + 2, y + 4, 9, 9, 1); if (it.on()) { G.line(x + 2, y + 4, x + 10, y + 12, 1); G.line(x + 10, y + 4, x + 2, y + 12, 1); } G.text(CHI(), it.label, x + 18, y + 12, 1); }
        else if (it.t === 'edit') { G.fill(x - 3, y - 3, it.w + 6, it.h + 6, 0); G.frame(x - 3, y - 3, it.w + 6, it.h + 6, 1);
          G.clip(x - 1, y - 2, x + it.w + 1, y + it.h + 2);
          const lines = it.multi ? G.wrap(CHI(), it.value, it.w - 2) : [it.value]; if (!lines.length) lines.push('');
          let shift = 0; if (!it.multi) { const tw = G.textW(CHI(), it.value); if (tw > it.w - 4) shift = tw - (it.w - 4); }
          lines.forEach((l, k) => { const ty = y + 11 + k * 16; if (it.sel && idx === d.focus && l) { const tw = G.textW(CHI(), l); G.fill(x - shift, ty - 11, tw + 2, 15, 1); G.text(CHI(), l, x + 1 - shift, ty, 0); } else G.text(CHI(), l, x + 1 - shift, ty, 1); });
          if (idx === d.focus && !it.sel && ui.caretOn) { const last = lines[lines.length - 1]; const cx = x + 1 - shift + G.textW(CHI(), last) + (last ? 1 : 0); G.vline(cx, y + (lines.length - 1) * 16, y + (lines.length - 1) * 16 + 13, 1); }
          G.unclip(); }
        else if (it.t === 'custom') it.draw(x, y, it);
      });
    },
    hitItem(mx, my) { const d = ui.dialog; if (!d) return null; for (let i = d.items.length - 1; i >= 0; i--) { const it = d.items[i]; if (it.hidden && it.hidden()) continue; const x = d.x + it.x, y = d.y + it.y;
        let w = it.w, h = it.h; if (it.t === 'radio' || it.t === 'check') { w = 20 + G.textW(CHI(), it.label); h = 16; } if (it.t === 'text' || (it.t === 'custom' && !it.click)) continue;
        if (mx >= x - 2 && mx < x + w + 2 && my >= y - 2 && my < y + h + 2) return it; } return null; },
    activate(it) { if (!it) return; if (it.t === 'button') { if (it.act) it.act(ui.dialog); } else if (it.t === 'radio' || it.t === 'check') it.set(); else if (it.t === 'custom' && it.click) it.click(ui.mouse.x - ui.dialog.x - it.x, ui.mouse.y - ui.dialog.y - it.y); },
    defaultButton() { const d = ui.dialog; return d && d.items.find(i => i.t === 'button' && i.def); },
    cancelButton() { const d = ui.dialog; return d && d.items.find(i => i.t === 'button' && i.cancel); },
    pressButton(it) { if (!it) return; ui.pressed = it; ui.overPressed = true; setTimeout(() => { ui.pressed = null; if (ui.dialog) ui.activate(it); }, 110); },

    // ---------- events (coordinates already in screen pixels) ----------
    down(x, y) {
      ui.mouse.x = x; ui.mouse.y = y; ui.mouse.down = true; ui.mouse.seen = true;
      if (ui.dialog) { const it = ui.hitItem(x, y); if (it && it.t === 'edit') { ui.dialog.focus = ui.dialog.items.indexOf(it); it.sel = false; } else if (it) { ui.pressed = it; ui.overPressed = true; } ui.syncIME(); return true; }
      const mi = ui.menuHit(x, y);
      if (mi >= 0) { if (ui.open === mi && ui.sticky) { ui.open = -1; ui.sticky = false; } else { ui.open = mi; ui.sticky = false; ui.hot = -1; ui.downAt = performance.now(); } return true; }
      if (ui.open >= 0) { const k = ui.itemHit(x, y); if (k >= 0) ui.choose(ui.open, k); else { ui.open = -1; ui.sticky = false; } return true; }
      return false;
    },
    move(x, y) { ui.mouse.x = x; ui.mouse.y = y; ui.mouse.seen = true; if (ui.open >= 0) { ui.hot = ui.itemHit(x, y); if (ui.mouse.down) { const mi = ui.menuHit(x, y); if (mi >= 0 && mi !== ui.open) { ui.open = mi; ui.hot = -1; } } } if (ui.pressed) ui.overPressed = ui.hitItem(x, y) === ui.pressed; },
    up(x, y) {
      ui.mouse.x = x; ui.mouse.y = y; ui.mouse.down = false;
      if (ui.dialog) { const p = ui.pressed; ui.pressed = null; if (p && ui.hitItem(x, y) === p) ui.activate(p); return true; }
      if (ui.open >= 0) { const k = ui.itemHit(x, y); if (k >= 0) ui.choose(ui.open, k); else if (ui.menuHit(x, y) === ui.open && !ui.sticky && performance.now() - ui.downAt < 400) ui.sticky = true; else if (!ui.sticky || ui.menuHit(x, y) < 0) { ui.open = -1; ui.sticky = false; } return true; }
      return false;
    },
    key(e) { // returns true when the interface consumed the key
      const d = ui.dialog;
      if ((e.metaKey || e.ctrlKey) && e.key.length === 1 && !e.altKey) { if (d) { const it = d.items[d.focus]; if (it && e.key.toLowerCase() === 'a') { it.sel = true; return true; } return false; } return ui.cmdKey(e.key); }
      if (!d) { if (e.key === 'Escape' && ui.open >= 0) { ui.open = -1; return true; } return false; }
      if (d.onKey && d.onKey(e, d)) return true;
      if (e.key === 'Enter') { ui.pressButton(ui.defaultButton()); return true; }
      if (e.key === 'Escape') { ui.pressButton(ui.cancelButton() || (d.escDefault ? ui.defaultButton() : null)); return true; }
      if (e.key === 'Tab') { const n = d.items.length; for (let k = 1; k <= n; k++) { const j = (d.focus + k) % n; if (d.items[j].t === 'edit' && !(d.items[j].hidden && d.items[j].hidden())) { d.focus = j; d.items[j].sel = d.items[j].value.length > 0; break; } } ui.syncIME(); return true; }
      const it = d.items[d.focus]; if (!it || it.t !== 'edit') return true;
      if (e.key === 'Backspace' || e.key === 'Delete') { if (it.sel) { it.value = ''; it.sel = false; } else it.value = Array.from(it.value).slice(0, -1).join(''); ui.syncIME(); return true; }
      if (e.key.length === 1 || Array.from(e.key).length === 1) { const ch = MW.FONT.clean(e.key, 1); if (it.sel) { it.value = ''; it.sel = false; } if (ch && it.value.length < (it.max || 40) && (!it.digits || /[0-9]/.test(ch))) it.value += ch; ui.syncIME(); return true; }
      return true;
    },
    // phones have no keys until a real text field has focus: keep an invisible one in step
    syncIME() { const el = ui.ime; if (!el) return; const d = ui.dialog, it = d && d.items[d.focus];
      if (it && it.t === 'edit') { if (el.value !== it.value) el.value = it.value; el.maxLength = it.max || 40; if (document.activeElement !== el) { try { el.focus({ preventScroll: true }); } catch (e) { } } if (it.sel) { try { el.select(); } catch (e) { } } }
      else if (document.activeElement === el) { try { el.blur(); } catch (e) { } } },
    imeInput() { const d = ui.dialog, it = d && d.items[d.focus]; if (!it || it.t !== 'edit') return; let v = MW.FONT.clean(ui.ime.value, it.max || 40); if (it.digits) v = v.replace(/[^0-9]/g, ''); it.value = v; it.sel = false; if (ui.ime.value !== v) ui.ime.value = v; },

    draw(now) {
      ui.caretOn = (now % 1000) < 560;
      if (ui.flash && now > ui.flash.until) ui.flash = null;
      ui.drawBar(); ui.drawDialog();
    },
    drawPointer() { if (!ui.mouse.seen || ui.touch) return; let k = ui.cursor; if (ui.busy) k = 'eye'; else if (ui.dialog) { const it = ui.hitItem(ui.mouse.x, ui.mouse.y); k = it && it.t === 'edit' ? 'ibeam' : 'arrow'; } else if (ui.open >= 0 || ui.mouse.y < 21) k = 'arrow'; drawCursor(k, ui.mouse.x, ui.mouse.y); },

    // ---------- ready-made ----------
    alert(text, buttons) { const w = 300, lines = [].concat(...text.split('\r').map(l => G.wrap(CHI(), l, w - 20))); const h = lines.length * 16 + 50; const bs = buttons || [{ label: 'OK', def: true }];
      const items = [{ t: 'text', x: 10, y: 6, s: lines.join('\r') }]; bs.forEach((b, i) => items.push({ t: 'button', x: w - 80 - i * 86, y: h - 28, w: 66, h: 20, label: b.label, def: !!b.def, cancel: !!b.cancel, act: () => { ui.close(); if (b.act) b.act(); } }));
      ui.show({ x: 106, y: 90, w, h, items, escDefault: true }); }
  };
})();
