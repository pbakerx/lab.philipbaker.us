/* Jones PR show: the engine. Content lives in slides.js; nothing here names a slide. */
(function () {
  'use strict';
  var SHOW = window.SHOW, stage = document.getElementById('stage');
  var slides = SHOW.slides.filter(function (s) { return !s.skip; });
  var qs = new URLSearchParams(location.search);
  var MEDIA = 'media/';

  /* ---------- flatten: every slide is a list of screens (title first, then each phase) ---------- */
  slides.forEach(function (s, i) {
    s.n = i + 1;
    s.screens = [];
    var steps = s.steps || [];
    /* a tree slide is ONE screen: the title, which shrinks as its lines draw */
    if (steps[0] && steps[0].type === 'tree') s.screens.push({ type: 'tree', view: steps[0], open: false });
    else if (!s.noTitle || !steps.length) s.screens.push({ type: s.type || 'title' });
    steps.forEach(function (st) {
      if (st.type === 'showcase') st.items.forEach(function (it, k) { s.screens.push({ type: 'showcase', view: st, k: k, name: it.name }); });
      else if (st.type === 'tree') s.screens.push({ type: 'tree', view: st, open: true, name: st.label });
      else s.screens.push({ type: st.type, view: st, name: st.label });
    });
  });

  var si = 0, ki = 0;

  var autoTimer = null;
  function clearAuto() { if (autoTimer != null) { clearTimeout(autoTimer); autoTimer = null; } }

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function metaRow(s) {
    var m = el('div', 'meta fade');
    var a = el('span'); var b = el('b', null, pad(s.n)); a.appendChild(b); a.appendChild(document.createTextNode('  /  ' + pad(slides.length)));
    m.appendChild(a); m.appendChild(el('span', null, SHOW.name + '  —  ' + SHOW.date));
    return m;
  }
  function head(s, label) {
    var h = el('div', 'head rise'); h.appendChild(el('h2', null, s.title));
    if (label && label !== s.title) h.appendChild(el('div', 'k', label));
    return h;
  }
  function facts(v) {
    if (!v || !v.facts || !v.facts.length) return null;
    var u = el('ul', 'v-facts fade');
    v.facts.forEach(function (line, i) {
      var li = el('li', null, line);
      li.style.setProperty('--i', i);
      u.appendChild(li);
    });
    if (v.tech) {
      var t = el('li', 'tech', v.tech);
      t.style.setProperty('--i', v.facts.length);
      u.appendChild(t);
    }
    return u;
  }

  /* A media slot: shows the file if it is in media/, a quiet placeholder if not. */
  function slot(item, opt) {
    var box = el('div', 'slot'), kind = item.kind || 'image';
    var ph = el('div', 'ph');
    ph.appendChild(el('div', 'g', kind === 'video' ? '▶' : kind === 'audio' ? '♪' : '□'));
    ph.appendChild(el('b', null, item.label || item.name || 'Placeholder'));
    if (item.file) ph.appendChild(el('span', null, 'DropFolder / ' + item.file));
    box.appendChild(ph);
    if (!item.file && !item.src) return box;
    var url = item.src || MEDIA + item.file, m;
    function fill() { box.textContent = ''; box.appendChild(m); if (kind !== 'audio') box.classList.add('filled'); }
    if (kind === 'image') { m = new Image(); m.alt = item.label || ''; m.onload = fill; m.src = url; }
    else {
      m = document.createElement(kind === 'audio' ? 'audio' : 'video');
      m.controls = true; m.preload = 'metadata'; m.playsInline = true;
      opt = opt || {};
      if (kind === 'video' && (item.muted || item.autoplay || opt.muted || opt.autoplay)) {
        m.muted = true; m.defaultMuted = true; m.setAttribute('muted', '');
        m.playsInline = true; m.setAttribute('playsinline', ''); m.setAttribute('webkit-playsinline', '');
        m.autoplay = true; m.loop = true; m.controls = false; m.preload = 'auto';
        m.onloadedmetadata = function () { fill(); var p = m.play(); if (p && p.catch) p.catch(function () {}); };
      } else {
        m.onloadedmetadata = fill;
      }
      m.src = url;
      if (kind === 'audio') { m.onloadedmetadata = function () { box.textContent = ''; var w = el('div', 'ph'); w.appendChild(el('b', null, item.label || '')); w.appendChild(m); m.style.marginTop = '28px'; box.appendChild(w); }; }
    }
    return box;
  }

  /* ---------- the views ---------- */
  var VIEWS = {

    title: function (root, s) {
      root.appendChild(metaRow(s));
      var t = el('div', 't');
      var h = el('h1', 'rise' + (s.title.length > 17 ? ' long' : ''), s.title); t.appendChild(h);
      if (s.sub) { var p = el('p', 'sub rise', s.sub); p.style.setProperty('--i', 3); t.appendChild(p); }
      root.appendChild(t);
    },

    years: function (root, s) {
      root.appendChild(metaRow(s));
      var row = el('div', 'row'), a = el('div', 'y rise', String(s.from)), tr = el('div', 'track'), b = el('div', 'y b', String(s.from));
      tr.appendChild(el('i')); row.appendChild(a); row.appendChild(tr); row.appendChild(b); root.appendChild(row);
      var ticks = el('div', 'ticks'), n = s.to - s.from;
      for (var i = 0; i <= n; i++) { var t = el('i'); t.style.setProperty('--i', i * (40 / Math.max(n, 1))); ticks.appendChild(t); }
      root.appendChild(ticks);
      if (s.sub) { var c = el('p', 'sub cap rise', s.sub); c.style.setProperty('--i', 6); root.appendChild(c); }
      var t0 = null, D = 2600;
      function frame(now) {
        if (!root.isConnected) return;
        if (t0 == null) t0 = now + 500;
        var p = Math.min(1, Math.max(0, (now - t0) / D)), e = 1 - Math.pow(1 - p, 3);
        b.textContent = String(Math.round(s.from + n * e));
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      setTimeout(function () { b.textContent = String(s.to); }, D + 900);   /* a hidden tab runs no frames */
    },

    tree: function (root, s, v) {
      root.appendChild(metaRow(s));
      var tt = el('div', 'tt'); var th = el('h2', null, s.title); if (s.titleSize) th.style.fontSize = s.titleSize + 'px'; tt.appendChild(th); if (s.sub) tt.appendChild(el('p', 'tsub', s.sub)); root.appendChild(tt);
      var svg = svgEl('svg'); svg.setAttribute('viewBox', '0 0 1920 1080'); root.appendChild(svg);
      var items = v.items.map(function (it) { return typeof it === 'string' ? { name: it } : it; });
      var n = items.length, two = items.some(function (it) { return it.line || (it.items && it.items.length); });
      var nameH = 44;
      var heights = items.map(function (it) {
        var kids = (it.items && it.items.length) || 0;
        return kids ? nameH + 8 + kids * (it.bigSubs ? 34 : 26) : (it.line ? 68 : 48);
      });
      var pad = 22, span = heights.reduce(function (a, h) { return a + h; }, 0) + pad * Math.max(n - 1, 0);
      var yCursor = 540 - span / 2, ys = [];
      items.forEach(function (it, i) {
        var kids = (it.items && it.items.length) || 0;
        ys.push(yCursor + (kids ? nameH / 2 : heights[i] / 2));
        yCursor += heights[i] + pad;
      });
      var x0 = v.x0 || 800, x1 = v.x1 || 1130;
      var trunk = svgEl('path'); trunk.setAttribute('d', 'M' + (x0 - 40) + ' 540 H' + x0); trunk.setAttribute('pathLength', 1); svg.appendChild(trunk);
      items.forEach(function (it, i) {
        var y = ys[i], p = svgEl('path');
        p.setAttribute('d', 'M' + x0 + ' 540 C' + (x0 + (x1 - x0) * .46) + ' 540 ' + (x1 - (x1 - x0) * .56) + ' ' + y + ' ' + x1 + ' ' + y);
        p.setAttribute('pathLength', 1); p.style.setProperty('--i', i);
        if (v.grow) p.style.strokeWidth = (1.2 + 2.6 * i / Math.max(n - 1, 1)).toFixed(2);
        svg.appendChild(p);
        var d = el('div', 'dot' + (it.hot ? ' hot' : '')); d.style.left = x1 + 'px'; d.style.top = y + 'px'; d.style.setProperty('--i', i); root.appendChild(d);
        var l = el('div', 'leaf' + (two ? ' two' : '') + (it.hot ? ' hot' : '') + (it.items && it.items.length ? ' kids' : '') + (it.bold ? ' bold' : ''));
        l.style.left = (x1 + 26) + 'px'; l.style.top = y + 'px'; l.style.setProperty('--i', i);
        if (it.k) l.appendChild(el('b', null, it.k));
        l.appendChild(el('span', null, it.name));
        if (it.line) l.appendChild(el('small', null, it.line));
        if (it.items && it.items.length) {
          var ul = el('ul', 'subs' + (it.bigSubs ? ' big' : ''));
          it.items.forEach(function (k) { ul.appendChild(el('li', null, typeof k === 'string' ? k : k.name)); });
          l.appendChild(ul);
        }
        root.appendChild(l);
      });
      if (v.key) { var k = el('div', 'tkey', v.key); root.appendChild(k); }
    },

    ads: function (root, s, v) {
      root.appendChild(metaRow(s)); root.appendChild(head(s, v.label));
      var f = facts(v); if (f) root.appendChild(f);
      var wrap = el('div', 'adrow');
      function unit(it, i) {
        var z = it.z || 1, u = el('div', 'ad fade'); u.style.setProperty('--i', i * 2 + 2);
        var b = el('div', 'adbox'); b.style.width = it.w * z + 'px'; b.style.height = it.h * z + 'px';
        var f = el('iframe'); f.width = it.w; f.height = it.h; f.scrolling = 'no'; f.style.transform = 'scale(' + z + ')'; f.src = it.src;
        b.appendChild(f); u.appendChild(b); if (it.label) u.appendChild(el('span', null, it.label));
        return u;
      }
      var i = 0;
      v.items.forEach(function (it) {
        if (it.stack) { var c = el('div', 'adcol'); it.stack.forEach(function (x) { c.appendChild(unit(x, i++)); }); wrap.appendChild(c); }
        else wrap.appendChild(unit(it, i++));
      });
      root.appendChild(wrap);
    },

    media: function (root, s, v) {
      root.appendChild(metaRow(s)); root.appendChild(head(s, v.label));
      var f = facts(v); if (f) root.appendChild(f);
      var g = el('div', 'slots');
      v.items.forEach(function (it, i) { var b = slot(it, v); b.classList.add('rise'); b.style.setProperty('--i', i + 2); g.appendChild(b); });
      if (v.items.length === 1) { g.style.left = '330px'; g.style.right = '330px'; }
      if (v.grid) {
        var cols = v.grid, rows = Math.ceil(v.items.length / cols);
        g.style.right = 'auto';
        if (v.square) {
          g.classList.add('square');
          var gap = 36, side = Math.round(Math.min((1640 - gap * (cols - 1)) / cols, (690 - gap * (rows - 1)) / rows));
          g.style.width = (side * cols + gap * (cols - 1)) + 'px';
          Array.prototype.forEach.call(g.children, function (b) { b.style.width = side + 'px'; b.style.flex = '0 0 ' + side + 'px'; });
        } else {
          g.classList.add('tight');
          g.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
          var rh = Math.min(1640 / cols * 9 / 16, 690 / rows);
          g.style.width = Math.round(rh * 16 / 9 * cols) + 'px';
        }
      }
      root.appendChild(g);
    },

    showcase: function (root, s, v, scr) {
      root.appendChild(metaRow(s));
      var h = head(s); h.classList.remove('rise'); root.appendChild(h);
      var names = el('div', 'names');
      v.items.forEach(function (it, k) {
        var b = el('button', k === scr.k ? 'on' : '', it.name);
        b.onclick = function (e) { e.stopPropagation(); go(si, s.screens.indexOf(s.screens.filter(function (x) { return x.view === v && x.k === k; })[0])); };
        names.appendChild(b);
      });
      root.appendChild(names);
      var it = v.items[scr.k], win = el('div', 'win fade');
      if (it.src) {
        var f = el('iframe'); f.loading = 'eager'; f.allow = 'autoplay; fullscreen; microphone';
        var mount = function () { f.src = it.src; win.appendChild(f); win.classList.add('filled'); };
        /* a page of our own that is not there yet shows the placeholder, not an error page */
        if (/^https?:/.test(it.src)) mount();
        else fetch(it.src, { method: 'HEAD' }).then(function (r) { if (r.ok) mount(); else win.appendChild(slot({ label: it.name, kind: 'image' })); }, mount);
        win.addEventListener('mouseleave', function () { f.blur(); window.focus(); });
      } else win.appendChild(slot(it));
      root.appendChild(win);
      var note = el('div', 'note fade'); note.style.setProperty('--i', 3);
      if (it.note) note.appendChild(el('div', null, it.note));
      if (it.src) { var a = el('a', null, 'Open full size'); a.href = it.src; a.target = '_blank'; a.rel = 'noopener'; var w = el('div'); w.style.marginTop = '18px'; w.appendChild(a); note.appendChild(w); }
      root.appendChild(note);
    },

    icons: function (root, s, v) {
      root.appendChild(metaRow(s)); root.appendChild(head(s, v.label));
      var g = el('div', 'tiles');
      v.items.forEach(function (it, i) {
        var t = el('div', 'tile rise'); t.style.setProperty('--i', i * .6 + 2);
        var ic = el('div', 'ic', it.mark || it.name.slice(0, 2));
        if (it.icon) { var im = new Image(); im.onload = function () { ic.textContent = ''; ic.appendChild(im); }; im.src = MEDIA + it.icon; }
        var tx = el('div'); tx.appendChild(el('b', null, it.name)); if (it.line) tx.appendChild(el('span', null, it.line));
        t.appendChild(ic); t.appendChild(tx); g.appendChild(t);
      });
      root.appendChild(g);
    },

    list: function (root, s, v) {
      root.appendChild(metaRow(s));
      if (!v.big) root.appendChild(head(s, v.label));
      var ol = el('ol', v.big ? 'big' : null);
      v.items.forEach(function (it, i) {
        var li = el('li', 'rise'); li.style.setProperty('--i', i * .7 + 2);
        if (!v.big) li.appendChild(el('i', null, pad(i + 1)));
        var d = el('div', null, it.name);
        if (it.line) d.appendChild(el('span', null, it.line));
        if (it.items && it.items.length) {
          var kids = el('ul', 'kids');
          it.items.forEach(function (k) {
            kids.appendChild(el('li', null, typeof k === 'string' ? k : k.name));
          });
          d.appendChild(kids);
        }
        li.appendChild(d); ol.appendChild(li);
      });
      root.appendChild(ol);
    },

    chaos: function (root, s, v) {
      root.classList.add('v-diagram');
      root.appendChild(metaRow(s)); root.appendChild(head(s, v.label));
      var spots = [[430, 420], [1320, 360], [840, 520], [1560, 610], [300, 700], [1080, 760], [620, 860], [1480, 880], [1700, 400], [980, 330], [240, 900], [1240, 560]];
      v.items.forEach(function (name, i) {
        var p = spots[i % spots.length], c = el('div', 'chip fade', name);
        c.style.left = p[0] + 'px'; c.style.top = p[1] + 'px';
        c.style.setProperty('--r', ((i * 37) % 23 - 11) + 'deg'); c.style.setProperty('--i', i);
        root.appendChild(c);
      });
    },

    teams: function (root, s, v) {
      root.classList.add('v-diagram');
      root.appendChild(metaRow(s));
      var svg = svgEl('svg'); svg.setAttribute('viewBox', '0 0 1920 1080'); root.appendChild(svg);
      var lead = el('div', 'node pill rise', v.lead.name); if (v.lead.line) lead.appendChild(el('small', null, v.lead.line));
      lead.style.left = '960px'; lead.style.top = '205px'; root.appendChild(lead);
      var n = v.teams.length, span = 1640 / n;
      v.teams.forEach(function (t, i) {
        var x = 140 + span * (i + .5);
        var p = svgEl('path'); p.setAttribute('d', 'M960 252 C960 320 ' + x + ' 290 ' + x + ' 356'); p.setAttribute('pathLength', 1); p.style.setProperty('--i', i); svg.appendChild(p);
        var box = el('div', 'team rise'); box.style.left = x + 'px'; box.style.width = (span - 34) + 'px'; box.style.setProperty('--i', i + 3);
        box.appendChild(el('h3', null, t.name));
        t.rows.forEach(function (r) {
          var row = el('div', 'r'); row.appendChild(el('b', null, r[0]));
          var tools = el('div', 'tools');
          [].concat(r[1]).forEach(function (name) {
            var chip = el('span', 'tool'), ic = el('i', null, name.charAt(0));
            var im = new Image(); im.alt = ''; im.onload = function () { ic.textContent = ''; ic.classList.add('img'); ic.appendChild(im); };
            im.src = MEDIA + 'icons/' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg';
            chip.appendChild(ic); chip.appendChild(document.createTextNode(name)); tools.appendChild(chip);
          });
          row.appendChild(tools); box.appendChild(row);
        });
        root.appendChild(box);
      });
    },

    org: function (root, s, v) {
      root.classList.add('v-diagram');
      root.appendChild(metaRow(s));
      var svg = svgEl('svg'); svg.setAttribute('viewBox', '0 0 1920 1080'); root.appendChild(svg);
      var k = 0;
      function line(d) { var p = svgEl('path'); p.setAttribute('d', d); p.setAttribute('pathLength', 1); p.style.setProperty('--i', k++); svg.appendChild(p); }
      function node(cls, o, x, y, i) { var e = el('div', 'node ' + cls + ' rise', o.name); if (o.line) e.appendChild(el('small', null, o.line)); e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.setProperty('--i', i); root.appendChild(e); }
      function row(arr, y, cls, from, i0) {
        var n = arr.length, span = 1500 / n;
        if (from == null) line('M' + (210 + span * .5) + ' ' + (y - 70) + ' H' + (210 + span * (n - .5)));
        arr.forEach(function (o, i) { var x = 210 + span * (i + .5); line(from == null ? 'M' + x + ' ' + (y - 70) + ' V' + (y - 44) : 'M960 ' + from + ' C960 ' + (from + 70) + ' ' + x + ' ' + (y - 110) + ' ' + x + ' ' + (y - 44)); node(cls, o, x, y, i0 + i * .6); });
      }
      node('pill', v.top, 960, 215, 0);
      line('M960 262 V352');
      node('pill', v.chief, 960, 400, 2);
      row(v.staff, 620, 'box', 447, 4);
      line('M960 664 V780'); row(v.models, 850, 'plain', null, 8);
      var a = el('div', 'rowlabel fade', 'Agents'); a.style.top = '620px'; root.appendChild(a);
      var b = el('div', 'rowlabel fade', 'Models'); b.style.top = '850px'; root.appendChild(b);
      if (v.foot) { var f = el('div', 'node plain fade', v.foot); f.style.left = '960px'; f.style.top = '930px'; f.style.fontSize = '30px'; f.style.setProperty('--i', 14); root.appendChild(f); }
      if (v.categories && v.categories.length) {
        var cats = el('div', 'org-cats fade');
        v.categories.forEach(function (name, i) {
          var c = el('span', null, name); c.style.setProperty('--i', i); cats.appendChild(c);
        });
        root.appendChild(cats);
      }
    }
  };

  /* ---------- show one screen ---------- */
  var current = null;
  function render() {
    var s = slides[si], scr = s.screens[ki];
    var key = scr.type === 'tree' ? s.id + ':tree' : null;
    if (key && current && current.__key === key) current.classList.toggle('open', !!scr.open);   /* same screen, next phase */
    else {
      var root = el('section', 'screen in v-' + scr.type); root.__key = key;
      (VIEWS[scr.type] || VIEWS.title)(root, s, scr.view, scr);
      if (scr.open) root.classList.add('open');
      var old = current; current = root;
      stage.appendChild(root);
      requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('in'); }); });
      setTimeout(function () { root.classList.remove('in'); }, 80);
      if (old) { old.classList.add('out'); setTimeout(function () { old.remove(); }, 500); }
    }
    document.getElementById('count').textContent = pad(s.n) + ' / ' + pad(slides.length) + '   ' + s.title + (s.screens.length > 1 ? '   · ' + (ki + 1) + ' of ' + s.screens.length : '');
    var total = 0, at = 0; slides.forEach(function (x, i) { if (i < si) at += x.screens.length; total += x.screens.length; });
    document.querySelector('#bar i').style.width = (100 * (at + ki + 1) / total) + '%';
    var h = '#' + s.id + (ki ? '.' + (ki + 1) : ''); if (location.hash !== h) history.replaceState(null, '', h);
    document.title = pad(s.n) + ' ' + s.title + ' — ' + SHOW.name;
    announce();
    /* Per-screen or first-screen auto-advance. Only moves within this slide.
       go() clears the timer first, so a manual next during the wait does not double-advance. */
    var ms = scr.autoAdvance || (ki === 0 ? s.autoAdvance : 0);
    if (ms && ki < s.screens.length - 1) {
      var holdSi = si, holdKi = ki;
      autoTimer = setTimeout(function () {
        autoTimer = null;
        if (si === holdSi && ki === holdKi) next();
      }, ms);
    }
  }
  function go(a, b) {
    clearAuto();
    a = Math.max(0, Math.min(slides.length - 1, a)); b = Math.max(0, Math.min(slides[a].screens.length - 1, b || 0));
    if (a === si && b === ki && current) return; si = a; ki = b; render();
  }
  function next() { if (ki < slides[si].screens.length - 1) go(si, ki + 1); else if (si < slides.length - 1) go(si + 1, 0); }
  function prev() { if (ki > 0) go(si, ki - 1); else if (si > 0) go(si - 1, slides[si - 1].screens.length - 1); }

  /* "go to custom", "go to 12", "go to lady on main" */
  function norm(t) { return String(t).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function find(q) {
    q = String(q == null ? '' : q).trim();
    var m = /^#?(\d+)(?:[.\s:]+(\d+))?$/.exec(q);
    if (m) { var n = +m[1]; if (n >= 1 && n <= slides.length) return [n - 1, m[2] ? +m[2] - 1 : 0]; }
    var want = norm(q), best = null, score = 0;
    if (!want) return null;
    slides.forEach(function (s, a) {
      var names = [[s.id, 0], [s.title, 0]]; (s.aliases || []).forEach(function (x) { names.push([x, 0]); });
      s.screens.forEach(function (c, b) { if (c.name) names.push([c.name, b]); });
      names.forEach(function (p) {
        var t = norm(p[0]), sc = t === want ? 4 : t.indexOf(want) === 0 ? 3 : (' ' + t + ' ').indexOf(' ' + want + ' ') >= 0 ? 2 : (t.indexOf(want) >= 0 || want.indexOf(t) >= 0) ? 1 : 0;
        if (p[1]) sc -= .5;
        if (sc > score) { score = sc; best = [a, p[1]]; }
      });
    });
    return best;
  }
  function command(c, arg) {
    c = String(c || '').toLowerCase();
    if (c === 'next' || c === 'forward' || c === 'advance') next();
    else if (c === 'prev' || c === 'back' || c === 'previous') prev();
    else if (c === 'first' || c === 'reset' || c === 'start') go(0, 0);
    else if (c === 'last' || c === 'end') go(slides.length - 1, 0);
    else if (c === 'goto' || c === 'go') { var f = find(arg); if (!f) return false; go(f[0], f[1]); }
    else return false;
    return true;
  }

  /* ---------- fit the 1920x1080 canvas to the window ---------- */
  function fit() {
    var k = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + k + ') translate(-50%,-50%)';
  }
  addEventListener('resize', fit); fit();

  /* ---------- keys, mouse, buttons ---------- */
  var typed = '', typedAt = 0;
  addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    var k = e.key, grid = !document.getElementById('grid').hidden;
    if (k === 'Escape') { if (grid) toggleGrid(false); return; }
    if (k === 'g' || k === 'G' || k === 'o' || k === 'O') { toggleGrid(); return; }
    if (grid) return;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0, 0);
    else if (k === 'End') go(slides.length - 1, 0);
    else if (k === 'f' || k === 'F') full();
    else if (/^\d$/.test(k)) { var now = Date.now(); typed = (now - typedAt < 1500 ? typed : '') + k; typedAt = now; }
    else if (k === 'Enter' && typed && Date.now() - typedAt < 3000) { command('goto', typed); typed = ''; }
  });
  stage.addEventListener('click', function (e) {
    if (e.target.closest('a,button,video,audio,iframe,.win,.adbox,input')) return;
    next();
  });
  stage.addEventListener('contextmenu', function (e) { if (e.target.closest('video,audio,.win,a')) return; e.preventDefault(); prev(); });
  function full() {
    var d = document, r = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
  }
  function btn(id, fn) { var b = document.getElementById(id); b.onclick = function () { fn(); b.blur(); }; }
  btn('bPrev', prev); btn('bNext', next); btn('bFull', full); btn('bGrid', function () { toggleGrid(); });

  var idle;
  function wake() { document.body.classList.add('awake'); clearTimeout(idle); idle = setTimeout(function () { document.body.classList.remove('awake'); }, 2600); }
  addEventListener('mousemove', wake); addEventListener('touchstart', wake, { passive: true }); wake();

  /* touch: swipe */
  var tx = null;
  addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', function (e) { if (tx == null) return; var dx = e.changedTouches[0].clientX - tx; tx = null; if (dx > 60) prev(); else if (dx < -60) next(); }, { passive: true });

  /* ---------- overview ---------- */
  function toggleGrid(on) {
    var g = document.getElementById('grid'); if (on == null) on = g.hidden; g.hidden = !on;
    if (!on) return;
    g.textContent = '';
    slides.forEach(function (s, i) {
      var b = el('button', i === si ? 'on' : ''); b.appendChild(el('i', null, pad(s.n)));
      var w = el('div'); w.appendChild(el('b', null, s.title));
      if (s.screens.length > 1) w.appendChild(el('small', null, s.screens.slice(1).map(function (c) { return c.name || c.type; }).join('  ·  ')));
      b.appendChild(w); b.onclick = function () { toggleGrid(false); go(i, 0); }; g.appendChild(b);
    });
  }

  /* ---------- the remote agent's line (MQTT over a web socket; see README) ---------- */
  var R = SHOW.remote || {}, BASE = 'pbshow/' + (R.room || 'x') + '/', me = Math.random().toString(36).slice(2, 10);
  var BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  var ws = null, wsUp = false, tries = 0, buf = new Uint8Array(0), enc = new TextEncoder(), dec = new TextDecoder();
  var dot = document.getElementById('remote');
  function str(s) { var b = enc.encode(s); return [b.length >> 8, b.length & 255].concat(Array.from(b)); }
  function packet(type, body) { var n = body.length, len = []; do { var d = n % 128; n = Math.floor(n / 128); len.push(n ? d | 128 : d); } while (n); return new Uint8Array([type].concat(len, body)); }
  function publish(topic, obj, retain) { if (!wsUp) return; ws.send(packet(0x30 | (retain ? 1 : 0), str(BASE + topic).concat(Array.from(enc.encode(JSON.stringify(obj)))))); }
  function outline() { return slides.map(function (s) { return { n: s.n, id: s.id, title: s.title, phases: s.screens.map(function (c, i) { return c.name || (i ? c.type : 'title'); }) }; }); }
  function state() { var s = slides[si]; return { n: s.n, id: s.id, title: s.title, phase: ki + 1, phases: s.screens.length, phaseName: s.screens[ki].name || (ki ? s.screens[ki].type : 'title'), of: slides.length, t: Date.now(), by: me }; }
  function announce() { publish('state', state(), true); }
  var seen = {};
  function onMessage(topic, text) {
    if (topic !== BASE + 'cmd') return;
    var m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object' || seen[m.id] || Math.abs(Date.now() - (+m.t || 0)) > 20000) return;
    seen[m.id] = 1;
    dot.classList.add('heard'); setTimeout(function () { dot.classList.remove('heard'); }, 900);
    var ok = command(m.c, m.a);
    if (!ok || m.c === 'state') publish('state', Object.assign(state(), { miss: ok ? undefined : String(m.a == null ? m.c : m.a) }), true);
  }
  function feed(chunk) {
    var a = new Uint8Array(buf.length + chunk.length); a.set(buf); a.set(chunk, buf.length); buf = a;
    for (;;) {
      if (buf.length < 2) return;
      var i = 1, len = 0, mul = 1, d;
      do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (buf.length < i + len) return;
      var type = buf[0] >> 4, body = buf.subarray(i, i + len); buf = buf.slice(i + len);
      if (type === 2) {                       /* CONNACK */
        wsUp = true; tries = 0; dot.classList.add('on');
        ws.send(packet(0x82, [0, 1].concat(str(BASE + 'cmd'), [0])));
        publish('outline', outline(), true); announce();
      } else if (type === 3) {                /* PUBLISH, qos 0 */
        var tl = (body[0] << 8) | body[1];
        onMessage(dec.decode(body.subarray(2, 2 + tl)), dec.decode(body.subarray(2 + tl)));
      }
    }
  }
  function connect() {
    if (R.on === false || qs.get('remote') === '0') { dot.hidden = true; return; }
    var url = BROKERS[Math.floor(tries / 2) % BROKERS.length], sock;
    try { sock = new WebSocket(url, 'mqtt'); } catch (e) { return retry(); }
    ws = sock; sock.binaryType = 'arraybuffer'; buf = new Uint8Array(0);
    sock.onopen = function () { sock.send(packet(0x10, str('MQTT').concat([4, 2, 0, 50], str('pbshow-' + me)))); };
    sock.onmessage = function (e) { if (sock === ws) feed(new Uint8Array(e.data)); };
    sock.onclose = sock.onerror = function () { if (sock !== ws) return; ws = null; wsUp = false; dot.classList.remove('on'); retry(); };
  }
  function retry() { tries++; setTimeout(connect, Math.min(8000, 800 * tries)); }
  setInterval(function () { if (wsUp) ws.send(new Uint8Array([0xC0, 0])); }, 25000);

  /* for tests and for the curious: window.show.next(), .goto('custom') ... */
  window.show = { next: next, prev: prev, go: go, goto: function (q) { return command('goto', q); }, command: command, state: state, outline: outline, find: find };

  /* ---------- start ---------- */
  function start() {
    var h = decodeURIComponent(location.hash.slice(1)), m = /^(.*?)(?:\.(\d+))?$/.exec(h), at = m && m[1] ? find(m[1]) : null;
    go(at ? at[0] : 0, at && m[2] ? +m[2] - 1 : 0);
    connect();
  }
  addEventListener('hashchange', function () { var h = decodeURIComponent(location.hash.slice(1)), m = /^(.*?)(?:\.(\d+))?$/.exec(h), at = m && m[1] ? find(m[1]) : null; if (at) go(at[0], m[2] ? +m[2] - 1 : 0); });
  if (document.fonts && document.fonts.ready) { var done = false, kick = function () { if (!done) { done = true; start(); } }; document.fonts.ready.then(kick); setTimeout(kick, 1500); } else start();
})();
