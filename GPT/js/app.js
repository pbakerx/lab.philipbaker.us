// Pocket GPT — the page. Owns the training loop and every visual.
'use strict';
(() => {
  const { GPT } = window.TinyGPT;
  const $ = s => document.querySelector(s);
  const css = getComputedStyle(document.documentElement);
  const C = k => css.getPropertyValue('--' + k).trim();
  const COL = { bg: C('bg'), hair: C('hair'), ink: C('ink'), dim: C('dim'), faint: C('faint'), lime: C('lime'), pink: C('pink'), cyan: C('cyan'), amber: C('amber'), bad: C('bad') };
  const HEADS = [1, 2, 4], WIDTHS = [16, 24, 32, 48];
  const DEFAULT_PROMPT = { dinos: 'tyr', rhymes: 'the little ', fortunes: 'you will ', copycat: 'grok>gr' };

  const S = {
    preset: 'dinos', chars: [], stoi: {}, data: null, model: null,
    running: false, step: 0, hist: [], ema: null, best: Infinity, events: [], snaps: [], viewing: -1,
    evalBatch: null, land: null, mapping: null, path: [], here: null, arrow: null, hereLoss: null,
    dragging: false, pending: null, gen: null, frame: 0, xmode: 'val', sel: { l: 0, h: 0 }, last: null,
    embPos: null, dirty: {},
  };
  const touch = (...k) => k.forEach(x => (S.dirty[x] = true));
  const ALL = ['loss', 'talk', 'emb', 'xray', 'land', 'stats'];

  // ---------- text ----------
  const show = ch => ch === ' ' ? '␣' : ch === '\n' ? '↵' : ch === '\t' ? '⇥' : ch;
  function setText(text) {
    S.chars = [...new Set(text)].sort();
    S.stoi = Object.fromEntries(S.chars.map((c, i) => [c, i]));
    S.data = Int32Array.from(text, c => S.stoi[c]);
    $('#corpusInfo').textContent = `${text.length.toLocaleString()} chars · ${S.chars.length} different ones`;
  }
  // "↵" in the prompt box stands for a newline, since a text input can't hold one
  function encode(str) {
    const out = [], unknown = new Set();
    for (const ch of str.replace(/↵/g, '\n').replace(/␣/g, ' ')) (ch in S.stoi ? out.push(S.stoi[ch]) : unknown.add(ch));
    return { ids: out, unknown };
  }
  function context() {
    const { ids, unknown } = encode($('#prompt').value);
    const start = '\n' in S.stoi ? S.stoi['\n'] : 0;
    return { ids: ids.length ? ids : [start], unknown, empty: !ids.length };
  }

  // ---------- build ----------
  function knobs() {
    const L = +$('#kL').value, H = HEADS[+$('#kH').value], d = WIDTHS[+$('#kD').value], n = +$('#kN').value;
    $('#vL').textContent = L; $('#vH').textContent = H; $('#vD').textContent = d; $('#vN').textContent = n + ' ch';
    return { L, H, d, n };
  }
  const estParams = ({ L, d, n }, V) => V * d + n * d + L * (12 * d * d + 13 * d) + 2 * d + d * V + V;
  function knobInfo() {
    const k = knobs(), est = estParams(k, S.chars.length);
    const m = S.model && S.model.cfg, same = m && m.L === k.L && m.H === k.H && m.d === k.d && m.n === k.n;
    $('#buildInfo').textContent = same ? '' : `≈ ${est.toLocaleString()} params — press Build`;
  }

  function build() {
    const k = knobs();
    window.TinyGPT.reseed((Math.random() * 2 ** 32) >>> 0);
    const m = new GPT({ V: S.chars.length, d: k.d, n: k.n, L: k.L, H: k.H });
    Object.assign(S, {
      model: m, step: 0, hist: [], ema: null, best: Infinity, events: [], viewing: -1, land: null, mapping: null,
      path: [], here: null, arrow: null, hereLoss: null, gen: null, embPos: null, sel: { l: 0, h: 0 }, last: null,
    });
    S.snaps = [{ step: 0, f: m.flat(), loss: null }];
    S.evalBatch = m.windows(S.data, 6, 4242);
    $('#sParams').textContent = m.size.toLocaleString();
    setRunning(false);
    renderArch(); fillXray(); syncTM(); knobInfo();
    $('#out').innerHTML = '<span class="p">Press “Write” to let it write something.</span>';
    mood('Freshly built. Knows nothing. Press ▶ Train.');
    touch(...ALL);
  }

  function renderArch() {
    const m = S.model, el = $('#arch');
    el.textContent = '';
    const io = t => { const d = document.createElement('div'); d.className = 'io'; d.textContent = t; el.appendChild(d); };
    io(`text → ${m.cfg.V} characters → ${m.cfg.d} numbers each`);
    m.blocks.forEach((_, l) => {
      const b = document.createElement('div'); b.className = 'blk';
      const t = document.createElement('span'); t.textContent = `Block ${l + 1}`; b.appendChild(t);
      const hs = document.createElement('span'); hs.className = 'heads';
      for (let h = 0; h < m.cfg.H; h++) {
        const x = document.createElement('button');
        x.className = 'hd' + (m.off[l][h] ? ' off' : '') + (S.sel.l === l && S.sel.h === h ? ' sel' : '');
        x.textContent = h + 1; x.title = `Attention head ${h + 1} of block ${l + 1}`;
        x.onclick = () => { S.sel = { l, h }; renderArch(); touch('talk'); };
        hs.appendChild(x);
      }
      b.appendChild(hs);
      const mlp = document.createElement('span'); mlp.className = 'mlp'; mlp.textContent = `MLP ${m.cfg.d}→${4 * m.cfg.d}→${m.cfg.d}`;
      b.appendChild(mlp); el.appendChild(b);
    });
    io(`→ a guess for the next character`);
    $('#snip').textContent = m.off[S.sel.l][S.sel.h] ? '✚ Switch this head back on' : '✂ Switch this head off';
  }

  // ---------- training ----------
  const lr = () => Math.pow(10, +$('#lr').value);
  function doStep() {
    const m = S.model, stick = S.land && S.land.img && S.stick;
    const L = m.grad(m.windows(S.data, +$('#batch').value));
    if (stick) planeStep(); else m.update(lr(), $('#opt').value);
    S.step++; S.hist.push(L);
    S.ema = S.ema == null ? L : 0.96 * S.ema + 0.04 * L;
    if (S.step > 30) S.best = Math.min(S.best, S.ema);
    if (S.step % 25 === 0) snapshot();
    if (S.land && !stick && S.step % 2 === 0) trackPath(true);
  }
  function snapshot() {
    S.snaps.push({ step: S.step, f: S.model.flat(), loss: S.ema });
    if (S.snaps.length > 80) S.snaps = S.snaps.filter((s, i, a) => i % 2 === 0 || i === a.length - 1);
    syncTM();
  }
  function syncTM() {
    const t = $('#tm');
    t.max = S.snaps.length - 1; t.disabled = S.snaps.length < 2;
    if (S.viewing < 0) { t.value = t.max; $('#vTm').textContent = 'now'; }
  }
  function setRunning(on) {
    if (on && S.viewing >= 0) branch();
    S.running = on;
    $('#go').textContent = on ? '❚❚ Pause' : '▶ Train';
    $('#go').classList.toggle('on', on);
  }
  function branch() {
    const snap = S.snaps[S.viewing];
    if (snap.step !== S.step) {
      S.step = snap.step; S.hist.length = snap.step;
      S.snaps = S.snaps.slice(0, S.viewing + 1);
      S.events = S.events.filter(e => e.step <= snap.step);
      S.events.push({ step: snap.step, type: 'branch' });
      S.ema = snap.loss; S.best = Infinity;
      toast(`New timeline, branching from step ${snap.step}.`);
    }
    S.viewing = -1; syncTM();
  }

  const MOODS = [
    [0.93, 'Babbling. Every character is a coin toss.'],
    [0.8, 'Figuring out which characters are common.'],
    [0.62, 'Learning which characters follow which.'],
    [0.45, 'Making word-shaped things.'],
    [0.3, 'Real words! Mostly.'],
    [0, 'Fluent-ish. Possibly just memorizing now.'],
  ];
  function mood(t) { $('#mood').textContent = t; }
  function updateMood() {
    if (S.ema == null) return;
    if (!isFinite(S.ema)) return mood('It exploded. Build a new brain and use a smaller step size.');
    if (S.step > 60 && S.ema > S.best * 1.3) return mood('It fell out of the valley! Step size too big?');
    const r = S.ema / Math.log(S.chars.length);
    mood(MOODS.find(([t]) => r > t)[1]);
  }

  // ---------- canvas helpers ----------
  function fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
    return [x, r.width, r.height];
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, b] = stops[i], u = (t - t0) / (t1 - t0 || 1);
      return a.map((v, k) => Math.round(v + (b[k] - v) * u));
    }
    return stops[stops.length - 1][1];
  }
  const MAGMA = [[0, '#07050f'], [0.2, '#2a0f5e'], [0.4, '#6a1f86'], [0.6, '#c13b75'], [0.8, '#f7865a'], [1, '#fdf2b8']].map(([t, h]) => [t, hex(h)]);
  const ATT = [[0, hex('#0c0e13')], [0.35, hex('#155a7a')], [0.7, hex('#5fd4ff')], [1, hex('#b9ff66')]];

  // ---------- loss chart ----------
  function drawLoss() {
    const [x, W, H] = fit($('#loss'));
    const lnV = Math.log(S.chars.length), h = S.hist;
    const pad = { l: 34, r: 8, t: 10, b: 20 };
    const top = Math.max(lnV * 1.1, ...(h.length ? [Math.min(Math.max(...h.slice(0, 50)), lnV * 2)] : [0]));
    const X = i => pad.l + (W - pad.l - pad.r) * (h.length > 1 ? i / (h.length - 1) : 0);
    const Y = v => pad.t + (H - pad.t - pad.b) * (1 - Math.min(v, top) / top);
    x.font = '11px ui-monospace,Menlo,monospace'; x.fillStyle = COL.faint; x.strokeStyle = COL.hair; x.lineWidth = 1;
    for (let v = 0; v <= top; v += top > 3 ? 1 : 0.5) { x.beginPath(); x.moveTo(pad.l, Y(v)); x.lineTo(W - pad.r, Y(v)); x.stroke(); x.fillText(v.toFixed(1), 4, Y(v) + 4); }
    x.setLineDash([5, 4]); x.strokeStyle = COL.amber; x.beginPath(); x.moveTo(pad.l, Y(lnV)); x.lineTo(W - pad.r, Y(lnV)); x.stroke(); x.setLineDash([]);
    x.fillStyle = COL.amber; x.fillText('random guessing', W - pad.r - 108, Y(lnV) - 5);
    if (!h.length) { x.fillStyle = COL.dim; x.font = '13px system-ui'; x.fillText('Loss will appear here when training starts.', pad.l + 10, H / 2 + 20); return; }
    // raw (bucketed) + smoothed
    const px = W - pad.l - pad.r, bucket = Math.max(1, Math.ceil(h.length / px));
    x.strokeStyle = 'rgba(95,212,255,.35)'; x.beginPath();
    for (let i = 0; i < h.length; i += bucket) { let s = 0, c = 0; for (let j = i; j < Math.min(h.length, i + bucket); j++) { s += h[j]; c++; } i === 0 ? x.moveTo(X(i), Y(s / c)) : x.lineTo(X(i), Y(s / c)); }
    x.stroke();
    x.strokeStyle = COL.lime; x.lineWidth = 2; x.beginPath();
    let e = h[0];
    for (let i = 0; i < h.length; i++) { e = 0.96 * e + 0.04 * h[i]; if (i % bucket === 0 || i === h.length - 1) (i === 0 ? x.moveTo(X(i), Y(e)) : x.lineTo(X(i), Y(e))); }
    x.stroke();
    const mark = { kick: ['💥', COL.pink], teleport: ['✋', COL.cyan], scramble: ['🎲', COL.amber], branch: ['⑂', COL.amber], snip: ['✂', COL.bad] };
    x.font = '12px system-ui'; x.textAlign = 'center';
    for (const ev of S.events) { if (ev.step > h.length) continue; const xx = X(Math.max(0, ev.step - 1)); x.strokeStyle = mark[ev.type][1]; x.globalAlpha = .5; x.beginPath(); x.moveTo(xx, pad.t); x.lineTo(xx, H - pad.b); x.stroke(); x.globalAlpha = 1; x.fillText(mark[ev.type][0], xx, pad.t + 10); }
    x.textAlign = 'left'; x.fillStyle = COL.faint; x.font = '11px ui-monospace,Menlo,monospace';
    x.fillText(`step ${h.length}`, W - pad.r - 70, H - 5);
  }

  // ---------- talk ----------
  function updateTalk() {
    const m = S.model, ctx = context(), temp = +$('#temp').value;
    const r = m.predict(ctx.ids, temp);
    S.last = { ...r, empty: ctx.empty };
    const order = Array.from(r.probs.keys()).sort((a, b) => r.probs[b] - r.probs[a]).slice(0, 8);
    const bars = $('#bars'); bars.textContent = '';
    const topP = r.probs[order[0]];
    for (const j of order) {
      const c = document.createElement('span'); c.className = 'c'; c.textContent = show(S.chars[j]); c.title = 'Pick this one';
      c.onclick = () => { $('#prompt').value += show(S.chars[j]) === '↵' ? '↵' : S.chars[j]; touch('talk'); };
      const bw = document.createElement('span'); bw.className = 'bw'; const b = document.createElement('span'); b.className = 'b';
      b.style.width = (100 * r.probs[j] / topP).toFixed(1) + '%'; bw.appendChild(b);
      const pc = document.createElement('span'); pc.className = 'pc'; pc.textContent = (100 * r.probs[j]).toFixed(1) + '%';
      bars.append(c, bw, pc);
    }
    const u = [...ctx.unknown].map(show).join(' ');
    $('#attnRead').textContent = u ? `ignoring unseen: ${u}` : '';
    drawAttn();
  }

  function drawAttn(hover) {
    const cv = $('#attn'), [x, W, H] = fit(cv), m = S.model, l = S.last;
    const { l: L, h: Hh } = S.sel;
    $('#attnWho').textContent = `Showing block ${L + 1}, head ${Hh + 1}.`;
    if (!l) return;
    const P = l.attn[L][Hh], ids = l.used, n = ids.length;
    const lab = 18, cell = Math.min((W - lab) / n, (H - lab) / n);
    x.font = `${Math.max(9, Math.min(14, cell * 0.7))}px ui-monospace,Menlo,monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (!P) {
      x.fillStyle = COL.bad; x.font = '14px system-ui'; x.fillText('This head is switched off.', W / 2, H / 2); x.textAlign = 'left'; return;
    }
    for (let i = 0; i < n; i++) {
      x.fillStyle = COL.dim;
      x.fillText(l.empty ? '↵' : show(S.chars[ids[i]]), lab / 2, lab + cell * (i + .5));
      x.fillText(l.empty ? '↵' : show(S.chars[ids[i]]), lab + cell * (i + .5), lab / 2);
      for (let j = 0; j < n; j++) {
        if (j > i) { x.fillStyle = '#10131a'; x.fillRect(lab + j * cell, lab + i * cell, cell - 1, cell - 1); continue; }
        const c = ramp(ATT, Math.pow(P.d[i * n + j], 0.6));
        x.fillStyle = `rgb(${c})`; x.fillRect(lab + j * cell, lab + i * cell, cell - 1, cell - 1);
      }
    }
    if (hover && hover.i < n && hover.j <= hover.i) {
      x.strokeStyle = COL.ink; x.lineWidth = 1.5; x.strokeRect(lab + hover.j * cell, lab + hover.i * cell, cell - 1, cell - 1);
      $('#attnRead').textContent = `“${show(S.chars[ids[hover.i]])}” looks at “${show(S.chars[ids[hover.j]])}”: ${(100 * P.d[hover.i * n + hover.j]).toFixed(0)}%`;
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    S.attnGeom = { lab, cell, n };
  }
  $('#attn').addEventListener('pointermove', e => {
    const g = S.attnGeom; if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    drawAttn({ i: Math.floor((e.clientY - r.top - g.lab) / g.cell), j: Math.floor((e.clientX - r.left - g.lab) / g.cell) });
  });

  function genWork() {
    const g = S.gen, m = S.model, temp = +$('#temp').value;
    for (let k = 0; k < 3 && g.left > 0; k++, g.left--) {
      const { probs } = m.predict(g.ctx, temp), j = m.sample(probs);
      g.ctx.push(j); g.text += S.chars[j];
    }
    const out = $('#out'); out.textContent = '';
    const p = document.createElement('span'); p.className = 'p'; p.textContent = g.prompt; out.appendChild(p);
    out.appendChild(document.createTextNode(g.text));
    const cur = document.createElement('span'); cur.className = 'cur'; cur.textContent = ' ';
    if (g.left > 0) out.appendChild(cur);
    out.scrollTop = out.scrollHeight;
    if (g.left <= 0) { S.gen = null; $('#gen').textContent = 'Write ✍︎'; }
  }

  // ---------- landscape ----------
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  function startMap() {
    const m = S.model, span = +$('#zoom').value, res = 25;
    const f0 = m.flat();
    const d1 = m.direction(), d2 = m.direction();
    // make the second direction orthogonal to the first, same length
    const k = dot(d1, d2) / dot(d1, d1); for (let i = 0; i < d2.length; i++) d2[i] -= k * d1[i];
    const s2 = Math.sqrt(dot(d1, d1) / dot(d2, d2)); for (let i = 0; i < d2.length; i++) d2[i] *= s2;
    S.land = { f0, d1, d2, n1: dot(d1, d1), res, span, grid: new Float32Array(res * res), img: null };
    S.mapping = { i: 0, wasRunning: S.running, tmp: new Float32Array(f0.length) };
    setRunning(false);
    S.path = [{ a: 0, b: 0 }];
    $('#mapBtn').disabled = true;
  }
  function mapWork() {
    const L = S.land, mp = S.mapping, m = S.model, t0 = performance.now(), N = L.res * L.res;
    while (mp.i < N && performance.now() - t0 < 28) {
      const gx = mp.i % L.res, gy = Math.floor(mp.i / L.res);
      const a = (gx / (L.res - 1) * 2 - 1) * L.span, b = (1 - gy / (L.res - 1) * 2) * L.span;
      for (let i = 0; i < mp.tmp.length; i++) mp.tmp[i] = L.f0[i] + a * L.d1[i] + b * L.d2[i];
      m.setFlat(mp.tmp);
      L.grid[mp.i] = m.loss(S.evalBatch);
      mp.i++;
    }
    $('#landProg').style.width = (100 * mp.i / N) + '%';
    if (mp.i >= N) {
      m.setFlat(L.f0);
      const g = L.grid, lo = Math.min(...g), hi = Math.min(Math.max(...g), Math.log(S.chars.length) * 1.6);
      L.lo = lo; L.hi = hi;
      const off = document.createElement('canvas'); off.width = off.height = L.res;
      const ox = off.getContext('2d'), im = ox.createImageData(L.res, L.res);
      for (let i = 0; i < g.length; i++) {
        const t = (Math.log(Math.min(g[i], hi)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1);
        const c = ramp(MAGMA, t); im.data.set([c[0], c[1], c[2], 255], i * 4);
      }
      ox.putImageData(im, 0, 0); L.img = off;
      const was = mp.wasRunning; S.mapping = null;
      $('#mapBtn').disabled = false; $('#landProg').style.width = '0';
      trackPath(false); computeArrow();
      if (was) setRunning(true);
      toast('Terrain mapped. Drag the ball somewhere!');
    }
    touch('land');
  }
  function planeCoords() {
    const L = S.land, f = S.model.flat();
    let a = 0, b = 0; for (let i = 0; i < f.length; i++) { const d = f[i] - L.f0[i]; a += d * L.d1[i]; b += d * L.d2[i]; }
    return { a: a / L.n1, b: b / L.n1 };
  }
  function trackPath(push) {
    S.here = planeCoords();
    if (push) { S.path.push(S.here); if (S.path.length > 4000) S.path = S.path.filter((_, i) => i % 2 === 0); }
    if (S.hist.length) S.hereLoss = S.hist[S.hist.length - 1];
    computeArrow(true);
  }
  // downhill direction in the plane = minus the loss gradient projected on the two axes
  function computeArrow(useLast) {
    const L = S.land, m = S.model; if (!L) return;
    if (!useLast || !m.params[0].g) S.hereLoss = m.grad(S.evalBatch);
    const g = m.flatGrad();
    S.arrow = { a: -dot(g, L.d1), b: -dot(g, L.d2) };
  }
  // "Stick to the map": gradient descent restricted to the visible plane. Uses the
  // direction of the projected gradient with a fixed stride, so the ball rolls at a
  // watchable pace and jiggles once it reaches the bottom.
  function planeStep() {
    const L = S.land, m = S.model, g = m.flatGrad();
    const ga = dot(g, L.d1), gb = dot(g, L.d2), n = Math.hypot(ga, gb) || 1;
    const stride = L.span * 0.02 * Math.min(5, Math.max(0.2, lr() / 0.005));
    const here = S.here || planeCoords(), a = here.a - stride * ga / n, b = here.b - stride * gb / n;
    const f = new Float32Array(L.f0.length);
    for (let i = 0; i < f.length; i++) f[i] = L.f0[i] + a * L.d1[i] + b * L.d2[i];
    m.setFlat(f);
    S.here = { a, b }; S.path.push(S.here); S.arrow = { a: -ga, b: -gb };
    if (S.hist.length) S.hereLoss = S.hist[S.hist.length - 1];
  }
  function teleport(a, b) {
    const L = S.land, m = S.model, f = new Float32Array(L.f0.length);
    for (let i = 0; i < f.length; i++) f[i] = L.f0[i] + a * L.d1[i] + b * L.d2[i];
    m.setFlat(f); m.resetOptimizer();
    S.here = { a, b }; S.path.push(S.here);
    computeArrow(false);
    touch('land', 'talk', 'emb', 'xray');
  }

  function landGeom() { const cv = $('#land'), r = cv.getBoundingClientRect(); return { W: r.width, H: r.height, r }; }
  function toPx(p, W, H) { const s = S.land.span; return [(p.a / s + 1) / 2 * W, (1 - p.b / s) / 2 * H]; }
  function fromPx(px, py, W, H) { const s = S.land.span; return { a: (px / W * 2 - 1) * s, b: (1 - py / H * 2) * s }; }

  function drawLand() {
    const [x, W, H] = fit($('#land')), L = S.land;
    if (!L || !L.img) {
      x.fillStyle = COL.dim; x.font = '14px system-ui'; x.textAlign = 'center';
      x.fillText(S.mapping ? 'Surveying the hills…' : 'Press 🗺 Map the terrain to survey', W / 2, H / 2 - 10);
      x.fillStyle = COL.faint; x.font = '12.5px system-ui';
      x.fillText(S.mapping ? `${Math.round(100 * S.mapping.i / (L.res * L.res))}% · each pixel is the model rebuilt and tested` : 'the hills around the model. Takes a few seconds; training pauses.', W / 2, H / 2 + 12);
      x.textAlign = 'left'; return;
    }
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(L.img, 0, 0, W, H);
    // trail
    x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.75)'; x.beginPath();
    S.path.forEach((p, i) => { const [px, py] = toPx(p, W, H); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
    const [sx, sy] = toPx({ a: 0, b: 0 }, W, H);
    x.strokeStyle = COL.ink; x.lineWidth = 1.5; x.beginPath(); x.moveTo(sx - 6, sy - 6); x.lineTo(sx + 6, sy + 6); x.moveTo(sx + 6, sy - 6); x.lineTo(sx - 6, sy + 6); x.stroke();
    if (!S.here) return;
    let [hx, hy] = toPx(S.here, W, H);
    const out = hx < 0 || hy < 0 || hx > W || hy > H;
    hx = Math.max(10, Math.min(W - 10, hx)); hy = Math.max(10, Math.min(H - 10, hy));
    if (S.arrow && !out) {
      const len = Math.hypot(S.arrow.a, S.arrow.b) || 1, ux = S.arrow.a / len, uy = -S.arrow.b / len;
      const Lp = 26 + Math.min(40, 18 * Math.log1p(len)), ex = hx + ux * Lp, ey = hy + uy * Lp;
      x.strokeStyle = COL.lime; x.fillStyle = COL.lime; x.lineWidth = 3; x.beginPath(); x.moveTo(hx, hy); x.lineTo(ex, ey); x.stroke();
      x.beginPath(); x.moveTo(ex + ux * 8, ey + uy * 8); x.lineTo(ex - uy * 6, ey + ux * 6); x.lineTo(ex + uy * 6, ey - ux * 6); x.fill();
    }
    const grd = x.createRadialGradient(hx, hy, 0, hx, hy, 18); grd.addColorStop(0, 'rgba(185,255,102,.9)'); grd.addColorStop(1, 'rgba(185,255,102,0)');
    x.fillStyle = grd; x.beginPath(); x.arc(hx, hy, 18, 0, 7); x.fill();
    x.fillStyle = out ? COL.bad : '#fff'; x.beginPath(); x.arc(hx, hy, 7, 0, 7); x.fill();
    x.strokeStyle = '#111'; x.lineWidth = 1.5; x.stroke();
    if (out) { x.fillStyle = COL.bad; x.font = '13px system-ui'; x.fillText('Wandered off the map — map again', 10, H - 12); }
  }
  function landRead(hover) {
    const L = S.land; let t = '';
    if (S.hereLoss != null) t += `ball loss ${S.hereLoss.toFixed(3)}`;
    if (hover && L && L.img) {
      const gx = Math.round((hover.a / L.span + 1) / 2 * (L.res - 1)), gy = Math.round((1 - hover.b / L.span) / 2 * (L.res - 1));
      if (gx >= 0 && gy >= 0 && gx < L.res && gy < L.res) t += ` · terrain here ${L.grid[gy * L.res + gx].toFixed(3)}`;
    }
    $('#landRead').textContent = t;
  }
  const landCv = $('#land');
  landCv.addEventListener('pointerdown', e => {
    if (!S.land || !S.land.img || S.mapping) return;
    landCv.setPointerCapture(e.pointerId);
    S.dragging = { wasRunning: S.running }; if (S.viewing >= 0) branch(); S.running = false;
    const { W, H, r } = landGeom(); S.pending = fromPx(e.clientX - r.left, e.clientY - r.top, W, H);
  });
  landCv.addEventListener('pointermove', e => {
    if (!S.land || !S.land.img) return;
    const { W, H, r } = landGeom(), p = fromPx(e.clientX - r.left, e.clientY - r.top, W, H);
    if (S.dragging) S.pending = p;
    landRead(p);
  });
  const endDrag = () => {
    if (!S.dragging) return;
    const was = S.dragging.wasRunning; S.dragging = false;
    if (S.pending) { const p = S.pending; S.pending = null; teleport(p.a, p.b); landRead(); }
    S.events.push({ step: S.step, type: 'teleport' });
    if (S.hereLoss != null) toast(`Moved by hand. Loss is now ${S.hereLoss.toFixed(3)}.`);
    S.running = was; touch('loss');
  };
  landCv.addEventListener('pointerup', endDrag); landCv.addEventListener('pointercancel', endDrag);

  // ---------- embeddings ----------
  function drawEmb() {
    const [x, W, H] = fit($('#emb')), pts = S.model.embedPCA();
    if (!S.embPos || S.embPos.length !== pts.length) S.embPos = pts.map(p => p.slice());
    else S.embPos.forEach((p, i) => { p[0] += (pts[i][0] - p[0]) * 0.35; p[1] += (pts[i][1] - p[1]) * 0.35; });
    let mx = 1e-6; for (const p of S.embPos) mx = Math.max(mx, Math.abs(p[0]), Math.abs(p[1]));
    const sc = Math.min(W, H) / 2 / mx * 0.86;
    x.strokeStyle = COL.hair; x.beginPath(); x.moveTo(W / 2, 8); x.lineTo(W / 2, H - 8); x.moveTo(8, H / 2); x.lineTo(W - 8, H / 2); x.stroke();
    x.font = '600 13px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    S.embPos.forEach((p, i) => {
      const ch = S.chars[i], px = W / 2 + p[0] * sc, py = H / 2 - p[1] * sc;
      const col = /[aeiouy]/i.test(ch) ? COL.lime : /[a-z]/i.test(ch) ? COL.cyan : /\s/.test(ch) ? COL.faint : COL.pink;
      x.fillStyle = col; x.globalAlpha = .18; x.beginPath(); x.arc(px, py, 11, 0, 7); x.fill(); x.globalAlpha = 1;
      x.fillText(show(ch), px, py + 1);
    });
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  }

  // ---------- x-ray ----------
  function fillXray() {
    const sel = $('#xsel'), prev = sel.value; sel.textContent = '';
    let grp = null, og = null;
    S.model.params.forEach((p, i) => {
      if (p.vec) return;
      if (p.group !== grp) { grp = p.group; og = document.createElement('optgroup'); og.label = grp; sel.appendChild(og); }
      const o = document.createElement('option'); o.value = i; o.textContent = `${p.name} (${p.r}×${p.c})`; og.appendChild(o);
    });
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    else { const q = [...sel.options].find(o => /Q\/K\/V/.test(o.textContent)); if (q) sel.value = q.value; }
  }
  function drawXray() {
    const cv = $('#xray'), [x, W, H] = fit(cv), p = S.model.params[+$('#xsel').value];
    if (!p) return;
    const src = S.xmode === 'grad' ? p.g : p.d;
    if (!src) { x.fillStyle = COL.dim; x.font = '13px system-ui'; x.fillText('No gradients yet: take a training step.', 12, 24); return; }
    const tr = p.r > p.c, cw = tr ? p.r : p.c, ch = tr ? p.c : p.r;
    let mx = 1e-9; for (const v of src) mx = Math.max(mx, Math.abs(v));
    const off = document.createElement('canvas'); off.width = cw; off.height = ch;
    const ox = off.getContext('2d'), im = ox.createImageData(cw, ch), P = hex(COL.pink), N = hex(COL.cyan), B = hex(COL.bg);
    for (let i = 0; i < p.r; i++) for (let j = 0; j < p.c; j++) {
      const v = src[i * p.c + j] / mx, t = Math.pow(Math.abs(v), 0.7), c = v >= 0 ? P : N;
      const k = tr ? (j * cw + i) : (i * cw + j);
      im.data.set([B[0] + (c[0] - B[0]) * t, B[1] + (c[1] - B[1]) * t, B[2] + (c[2] - B[2]) * t, 255], k * 4);
    }
    ox.putImageData(im, 0, 0);
    x.imageSmoothingEnabled = false; x.drawImage(off, 0, 0, W, H);
  }

  // ---------- misc ui ----------
  let toastT;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
  function stats() {
    $('#sStep').textContent = S.step.toLocaleString();
    $('#sLoss').textContent = S.ema == null ? '—' : S.ema.toFixed(3);
  }

  function loadPreset(id) {
    const p = window.CORPORA.find(c => c.id === id); S.preset = id;
    document.querySelectorAll('#presets .chip').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
    $('#blurb').textContent = p.blurb; $('#corpus').value = p.text; $('#prompt').value = DEFAULT_PROMPT[id];
    setText(p.text); build();
  }

  // ---------- wiring ----------
  window.CORPORA.forEach(c => {
    const b = document.createElement('span'); b.className = 'chip'; b.dataset.id = c.id; b.textContent = c.label;
    b.onclick = () => loadPreset(c.id); $('#presets').appendChild(b);
  });
  $('#useText').onclick = () => {
    const t = $('#corpus').value;
    if (t.length < 60) return toast('Give it at least a few lines of text.');
    document.querySelectorAll('#presets .chip').forEach(c => c.classList.remove('sel'));
    $('#blurb').textContent = 'Your own text.'; $('#prompt').value = '';
    setText(t); build(); toast('New brain built for your text.');
  };
  ['#kL', '#kH', '#kD', '#kN'].forEach(s => $(s).addEventListener('input', knobInfo));
  $('#build').onclick = () => { build(); toast('New brain built. It knows nothing yet.'); };
  $('#go').onclick = () => setRunning(!S.running);
  $('#step1').onclick = () => {
    setRunning(false); if (S.viewing >= 0) branch();
    doStep(); updateMood(); touch(...ALL); toast(`One step downhill. Batch loss ${S.hist[S.hist.length - 1].toFixed(3)}.`);
  };
  const lrLabel = () => { $('#vLr').textContent = lr() < 0.001 ? lr().toExponential(0) : lr().toFixed(lr() < 0.01 ? 4 : 3); };
  $('#lr').addEventListener('input', lrLabel); lrLabel();
  [['#batch', v => v], ['#speed', v => v + '/f'], ['#temp', v => v.toFixed(2)], ['#zoom', v => '±' + v.toFixed(2)], ['#kickAmt', v => v.toFixed(2)]]
    .forEach(([id, f]) => { const el = $(id), v = $({ '#batch': '#vBatch', '#speed': '#vSpeed', '#temp': '#vTemp', '#zoom': '#vZoom', '#kickAmt': '#vKick' }[id]); const u = () => (v.textContent = f(+el.value)); el.addEventListener('input', u); u(); });
  $('#temp').addEventListener('input', () => touch('talk'));
  $('#prompt').addEventListener('input', () => touch('talk'));
  $('#gen').onclick = () => {
    if (S.gen) { S.gen.left = 0; return; }
    const ctx = context();
    S.gen = { ctx: ctx.ids.slice(), prompt: $('#prompt').value.replace(/↵/g, '\n'), text: '', left: 280 };
    $('#gen').textContent = 'Stop ■';
  };
  $('#snip').onclick = () => {
    const { l, h } = S.sel, m = S.model; m.off[l][h] = !m.off[l][h];
    S.events.push({ step: S.step, type: 'snip' });
    renderArch(); touch('talk', 'loss');
    toast(m.off[l][h] ? `Block ${l + 1} head ${h + 1} is off. Did the guesses change?` : `Block ${l + 1} head ${h + 1} is back.`);
  };
  $('#tm').addEventListener('input', e => {
    const i = +e.target.value;
    if (S.viewing < 0) { setRunning(false); if (S.snaps[S.snaps.length - 1].step !== S.step) snapshot(); e.target.value = i; }
    if (i === S.snaps.length - 1 && S.viewing >= 0) { S.model.setFlat(S.snaps[i].f); S.viewing = -1; $('#vTm').textContent = 'now'; }
    else { S.viewing = i; S.model.setFlat(S.snaps[i].f); $('#vTm').textContent = `step ${S.snaps[i].step}`; }
    S.model.resetOptimizer();
    if (S.land) trackPath(false);
    touch('talk', 'emb', 'xray', 'land');
  });
  $('#mapBtn').onclick = () => { if (S.viewing >= 0) branch(); startMap(); };
  $('#stick').addEventListener('change', e => {
    S.stick = e.target.checked;
    if (S.stick && S.land && S.land.img) toast('Training now stays on the map. The ball has to roll.');
    else if (S.stick) toast('Map the terrain first, then the ball rolls on it.');
  });
  $('#zoom').addEventListener('change', () => { if (S.land && !S.mapping) startMap(); });
  $('#kick').onclick = () => {
    if (S.viewing >= 0) branch();
    const m = S.model, amt = +$('#kickAmt').value, before = m.loss(S.evalBatch);
    const dir = m.direction(), f = m.flat(); for (let i = 0; i < f.length; i++) f[i] += amt * dir[i];
    m.setFlat(f); m.resetOptimizer();
    const after = m.loss(S.evalBatch);
    S.events.push({ step: S.step, type: 'kick' });
    if (S.land) { trackPath(true); computeArrow(false); }
    toast(`💥 Loss ${before.toFixed(2)} → ${after.toFixed(2)}. Train to see if it recovers.`);
    touch(...ALL);
  };
  $('#xsel').addEventListener('change', () => touch('xray'));
  document.querySelectorAll('[data-x]').forEach(c => c.onclick = () => {
    S.xmode = c.dataset.x; document.querySelectorAll('[data-x]').forEach(d => d.classList.toggle('sel', d === c)); touch('xray');
  });
  $('#scramble').onclick = () => {
    if (S.viewing >= 0) branch();
    const p = S.model.params[+$('#xsel').value]; let s = 0; for (const v of p.d) s += v * v;
    const sd = Math.sqrt(s / p.d.length) || 0.1; for (let i = 0; i < p.d.length; i++) p.d[i] = sd * window.TinyGPT.randn();
    S.model.resetOptimizer(); S.events.push({ step: S.step, type: 'scramble' });
    toast(`Scrambled ${p.name}. Train to heal it.`); touch(...ALL);
  };
  window.addEventListener('resize', () => touch(...ALL));
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === ' ') { e.preventDefault(); setRunning(!S.running); }
  });

  // ---------- main loop ----------
  function loop() {
    S.frame++;
    if (S.mapping) mapWork();
    else if (S.pending) { const p = S.pending; S.pending = null; teleport(p.a, p.b); landRead(); }
    else if (S.running) {
      const t0 = performance.now(), k = +$('#speed').value;
      for (let i = 0; i < k && performance.now() - t0 < 14; i++) doStep();
      touch('loss', 'stats');
      if (S.frame % 5 === 0) touch('talk');
      if (S.frame % 10 === 0) touch('emb');
      if (S.frame % 4 === 0) touch('xray');
      if (S.land && S.frame % 2 === 0) { touch('land'); landRead(); }
      if (S.frame % 20 === 0) updateMood();
    }
    if (S.gen) genWork();
    const d = S.dirty; S.dirty = {};
    if (d.stats) stats();
    if (d.loss) drawLoss();
    if (d.talk) updateTalk();
    if (d.emb) drawEmb();
    if (d.xray) drawXray();
    if (d.land) drawLand();
    requestAnimationFrame(loop);
  }

  loadPreset('dinos');
  requestAnimationFrame(loop);
})();
