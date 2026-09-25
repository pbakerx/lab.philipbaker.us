// Pocket GPT — the page. Owns the training loop and every visual.
'use strict';
(() => {
  const { GPT } = window.TinyGPT;
  const $ = s => document.querySelector(s);
  const css = getComputedStyle(document.documentElement);
  const C = k => css.getPropertyValue('--' + k).trim();
  const COL = { bg: C('bg'), hair: C('hair'), ink: C('ink'), dim: C('dim'), faint: C('faint'), lime: C('lime'), pink: C('pink'), cyan: C('cyan'), amber: C('amber'), bad: C('bad') };
  const HEADS = [1, 2, 4], WIDTHS = [16, 24, 32, 48];
  const DEFAULT_PROMPT = { rhymes: 'the little ', tomatoes: 'Tomatoes need ', mornings: 'The best part ' };

  const S = {
    preset: 'rhymes', chars: [], stoi: {}, data: null, model: null,
    running: false, step: 0, hist: [], ema: null, best: Infinity, events: [], snaps: [], viewing: -1,
    evalBatch: null, land: null, mapping: null, path: [], here: null, arrow: null, hereLoss: null,
    dragging: false, pending: null, gen: null, frame: 0, xmode: 'grad', sel: { l: 0, h: 0 }, last: null,
    embPos: null, dirty: {},
  };
  const touch = (...k) => k.forEach(x => (S.dirty[x] = true));
  const ALL = ['loss', 'talk', 'emb', 'xray', 'land', 'stats'];

  // ---------- text ----------
  const show = ch => ch === ' ' ? '␣' : ch === '\n' ? '↵' : ch === '\t' ? '⇥' : ch;
  function setText(text) {
    S.corpusText = text;
    S.chars = [...new Set(text)].sort();
    S.stoi = Object.fromEntries(S.chars.map((c, i) => [c, i]));
    S.data = Int32Array.from(text, c => S.stoi[c]);
    $('#corpusInfo').textContent = `${text.length.toLocaleString()} chars · ${S.chars.length} different ones`;
    feedDirty();
  }
  // Typing in the box does nothing until "Learn from this text", so say so, loudly.
  function feedDirty() {
    const dirty = $('#corpus').value !== S.corpusText;
    $('#feedWarn').hidden = !dirty;
    const b = $('#useText'); b.classList.toggle('go', dirty);
    if (dirty && !b.classList.contains('pulse')) { b.classList.add('pulse'); setTimeout(() => b.classList.remove('pulse'), 3200); }
    return dirty;
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
    const m = S.model && S.model.cfg, same = !m || (m.L === k.L && m.H === k.H && m.d === k.d && m.n === k.n);
    $('#buildInfo').textContent = same ? '' : `≈ ${est.toLocaleString()} numbers`;
    const w = $('#buildWarn'); w.hidden = same;
    if (!same) w.textContent = `⚠ Not applied yet. Press Build a new brain: it starts from zero, about ${est.toLocaleString()} random numbers, so you'll train it again.`;
    $('#cBuild').classList.toggle('pending', !same); $('#build').classList.toggle('go', !same);
    if (!same && S.booted) flag('shape');
  }

  function build() {
    const k = knobs();
    S.baseSteps = 0;
    window.TinyGPT.reseed((Math.random() * 2 ** 32) >>> 0);
    const m = new GPT({ V: S.chars.length, d: k.d, n: k.n, L: k.L, H: k.H });
    Object.assign(S, {
      model: m, step: 0, hist: [], ema: null, best: Infinity, events: [], viewing: -1, land: null, mapping: null,
      path: [], here: null, arrow: null, hereLoss: null, gen: null, embPos: null, sel: { l: 0, h: 0 }, last: null, autoMapped: false, emaLog: [],
    });
    S.snaps = [{ step: 0, f: m.flat(), loss: null }];
    S.evalBatch = m.windows(S.data, 6, 4242);
    $('#sParams').textContent = m.size.toLocaleString();
    setRunning(false);
    renderArch(); fillXray(); syncTM(); knobInfo();
    $('#out').innerHTML = '<span class="p">Say something and press Send. It hasn’t learned anything yet, so expect gibberish.</span>';
    $('#live').textContent = 'Nothing yet. Press ▶ Train.'; $('#liveStep').textContent = '';
    $('#rGuess').textContent = ''; $('#rTrue').innerHTML = '<span class="ctx">Press ▶ Train, or Slow-mo to take one step at a time.</span>';
    S.miles = []; S.firstWrite = null; S.lastWrite = null; S.ballEval = null; S.film = [];
    $('#talkNote').hidden = true;
    $('#landSample').textContent = 'Map the terrain, then drag the ball.';
    $('#compare').textContent = ''; $('#sAcc').textContent = '—';
    mood('Brand new: its numbers are random, so it knows nothing yet.');
    filmShot();
    touch(...ALL);
  }

  function headButtons(l) {
    const m = S.model, hs = document.createElement('span'); hs.className = 'heads';
    for (let h = 0; h < m.cfg.H; h++) {
      const x = document.createElement('button');
      x.className = 'hd' + (m.off[l][h] ? ' off' : '') + (S.sel.l === l && S.sel.h === h ? ' sel' : '');
      x.textContent = h + 1; x.title = `Attention head ${h + 1} of block ${l + 1}` + (m.off[l][h] ? ' (switched off)' : '');
      x.onclick = () => { S.sel = { l, h }; $('#compare').textContent = ''; renderArch(); touch('talk'); flag('head'); };
      x.textContent = h + 1;
      hs.appendChild(x);
    }
    return hs;
  }
  function renderArch() {
    const m = S.model, el = $('#arch'), hp = $('#headpick');
    hp.textContent = '';
    m.blocks.forEach((_, l) => {
      const r = document.createElement('div'); r.className = 'hr';
      const t = document.createElement('span'); t.textContent = `L${l + 1}`; t.style.minWidth = '1.6em';
      r.append(t, headButtons(l)); hp.appendChild(r);
    });
    el.textContent = '';
    const io = t => { const d = document.createElement('div'); d.className = 'io'; d.textContent = t; el.appendChild(d); };
    io(`text → ${m.cfg.V} characters → ${m.cfg.d} numbers each`);
    m.blocks.forEach((_, l) => {
      const b = document.createElement('div'); b.className = 'blk';
      const t = document.createElement('span'); t.textContent = `Block ${l + 1}`; b.appendChild(t);
      b.appendChild(headButtons(l));
      const mlp = document.createElement('span'); mlp.className = 'mlp'; mlp.textContent = `MLP ${m.cfg.d}→${4 * m.cfg.d}→${m.cfg.d}`;
      b.appendChild(mlp); el.appendChild(b);
    });
    io(`→ a guess for the next character`);
    $('#snip').textContent = m.off[S.sel.l][S.sel.h] ? '✚ Head back on' : '✂ Head off';
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
    if (S.step % 100 === 0) (S.emaLog = S.emaLog || []).push(S.ema);
    if (FILM_AT.has(S.step)) filmShot();
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
    if (on) clearRetrain();
    S.running = on;
    $('#go').textContent = on ? '❚❚ Pause' : '▶ Train';
    $('#go').classList.toggle('on', on); document.body.classList.toggle('running', on);
  }
  function branch() {
    const snap = S.snaps[S.viewing];
    if (snap.step !== S.step) {
      S.step = snap.step; S.hist.length = snap.step;
      S.snaps = S.snaps.slice(0, S.viewing + 1);
      S.events = S.events.filter(e => e.step <= snap.step);
      S.film = S.film.filter(f => f.step <= snap.step); renderFilm();
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
  function mood(t) { S.moodText = t; renderNarr(); }
  function renderNarr() {
    const m = S.model; let t = S.moodText || '';
    if (S.running && m && m.lastAcc != null)
      t = `Each step it reads ${$('#batch').value} snippets, guesses ${m.lastGuesses} next letters (${Math.round(100 * m.lastAcc)}% right just now), and nudges all ${m.size.toLocaleString()} numbers. ${t}`;
    $('#narr').textContent = t;
  }
  function updateMood() {
    if (S.ema == null) return;
    if (!isFinite(S.ema)) return mood('It exploded. Build a new brain and use a smaller step size.');
    if (S.step > 60 && S.ema > S.best * 1.3) return mood('It fell out of the valley! Step size too big?');
    const L = S.emaLog || [];
    if (S.step > 800 && L.length >= 4 && L[L.length - 4] - L[L.length - 1] < 0.02 * L[L.length - 4])
      return mood('Learning has flattened out: it has picked up about all it can from this text. A good time to save it to your lab.');
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
    x.fillStyle = COL.amber; x.fillText('random guessing', pad.l + 6, Y(lnV) - 5);
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
    // milestone flags: one row each, stacked under the random-guessing line so labels never collide
    (S.miles || []).forEach((ms, k) => {
      if (ms.step > h.length) return;
      const xx = X(Math.max(0, ms.step - 1)), yy = Y(lnV) + 16 + k * 15;
      x.strokeStyle = COL.lime; x.globalAlpha = .5; x.beginPath(); x.moveTo(xx, H - pad.b); x.lineTo(xx, yy - 10); x.stroke(); x.globalAlpha = 1;
      x.font = '600 11px system-ui'; x.textAlign = xx > W - 110 ? 'right' : 'left';
      const lx = xx + (x.textAlign === 'right' ? -4 : 4), tw = x.measureText('⚑ ' + ms.label).width;
      x.fillStyle = 'rgba(12,14,19,.85)'; x.fillRect(x.textAlign === 'right' ? lx - tw - 2 : lx - 2, yy - 10, tw + 4, 14);
      x.fillStyle = COL.lime; x.fillText('⚑ ' + ms.label, lx, yy);
    });
    if (S.viewing >= 0) {
      const st = S.snaps[S.viewing].step, xx = X(Math.max(0, st - 1));
      x.strokeStyle = COL.cyan; x.lineWidth = 2; x.beginPath(); x.moveTo(xx, pad.t); x.lineTo(xx, H - pad.b); x.stroke(); x.lineWidth = 1;
      x.fillStyle = COL.cyan; x.font = '600 12px system-ui'; x.textAlign = xx > W - 150 ? 'right' : 'left';
      x.fillText(`◀ its brain at step ${st}`, xx + (x.textAlign === 'right' ? -6 : 6), H - pad.b - 8);
    }
    x.textAlign = 'left'; x.fillStyle = COL.faint; x.font = '11px ui-monospace,Menlo,monospace';
    x.fillText(`step ${h.length}`, W - pad.r - 70, H - 5);
    S.lossG = { x0: pad.l, x1: W - pad.r, n: h.length };
  }
  function lossStepAt(e) {
    const g = S.lossG; if (!g || g.n < 2) return null;
    const r = $('#loss').getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left - g.x0) / (g.x1 - g.x0)));
    return Math.round(f * (g.n - 1)) + 1;
  }
  $('#loss').addEventListener('pointermove', e => {
    const st = lossStepAt(e); if (st == null) return;
    $('#lossRead').textContent = `step ${st.toLocaleString()} · loss ${S.hist[st - 1].toFixed(2)} · click to rewind here`;
  });
  $('#loss').addEventListener('pointerleave', () => { $('#lossRead').textContent = ''; });
  $('#loss').addEventListener('click', e => { const st = lossStepAt(e); if (st != null) travelToStep(st); });

  // ---------- talk ----------
  function updateTalk() {
    const m = S.model, ctx = context(), temp = +$('#temp').value;
    const r = m.predict(ctx.ids, temp);
    S.last = { ...r, empty: ctx.empty };
    const order = Array.from(r.probs.keys()).sort((a, b) => r.probs[b] - r.probs[a]);
    const pick = j => () => { $('#prompt').value += show(S.chars[j]) === '↵' ? '↵' : S.chars[j]; touch('talk'); flag('bar'); };
    const top = $('#gTop'), rest = $('#gRest'); top.textContent = ''; rest.textContent = '';
    // the top four: letter size follows how sure it is, so a confident guess is visibly big
    order.slice(0, 4).forEach(j => {
      const p = r.probs[j], b = document.createElement('button'); b.className = 'gt'; b.title = `Click to type “${show(S.chars[j])}”`;
      const ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = show(S.chars[j]);
      ch.style.fontSize = (16 + 50 * Math.sqrt(p)).toFixed(0) + 'px';
      const pc = document.createElement('span'); pc.className = 'pc'; pc.textContent = (100 * p).toFixed(p < 0.1 ? 1 : 0) + '%';
      const bar = document.createElement('span'); bar.className = 'bar'; bar.style.width = Math.max(4, 100 * p).toFixed(0) + '%'; bar.style.alignSelf = 'flex-start';
      b.append(ch, pc, bar); b.onclick = pick(j); top.appendChild(b);
    });
    order.slice(4, 16).forEach(j => {
      const b = document.createElement('button'); b.className = 'gr'; b.textContent = show(S.chars[j]);
      const i = document.createElement('i'); i.textContent = (100 * r.probs[j]).toFixed(1) + '%'; b.appendChild(i);
      b.onclick = pick(j); b.title = `Click to type “${show(S.chars[j])}”`; rest.appendChild(b);
    });
    const dt = $('#dTop'), dr = $('#dRest'); dt.textContent = ''; dr.textContent = '';
    order.slice(0, 4).forEach(j => {
      const p = r.probs[j], b = document.createElement('button'); b.className = 'gt'; b.title = `Click to type “${show(S.chars[j])}”`;
      const ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = show(S.chars[j]); ch.style.fontSize = (13 + 32 * Math.sqrt(p)).toFixed(0) + 'px';
      const pc = document.createElement('span'); pc.className = 'pc'; pc.textContent = (100 * p).toFixed(p < 0.1 ? 1 : 0) + '%';
      b.append(ch, pc); b.onclick = pick(j); dt.appendChild(b);
    });
    order.slice(4, 12).forEach(j => {
      const b = document.createElement('button'); b.className = 'gr'; b.textContent = show(S.chars[j]); b.onclick = pick(j);
      const i = document.createElement('i'); i.textContent = (100 * r.probs[j]).toFixed(1) + '%'; b.appendChild(i); dr.appendChild(b);
    });
    if (document.activeElement !== $('#dPrompt')) $('#dPrompt').value = $('#prompt').value;
    const gh = $('#dGhost'); gh.textContent = $('#prompt').value;
    const nx = document.createElement('i'); nx.textContent = show(S.chars[order[0]]); gh.appendChild(nx); gh.scrollLeft = $('#dPrompt').scrollLeft;
    const u = [...ctx.unknown].map(show).join(' ');
    $('#attnRead').textContent = u ? `ignoring unseen: ${u}` : '';
    drawAttn();
  }

  function drawAttn(hover) {
    const cv = $('#attn'), [x, W, H] = fit(cv), m = S.model, l = S.last;
    const { l: L, h: Hh } = S.sel;
    $('#attnWho').textContent = `layer ${L + 1} · head ${Hh + 1}`;
    if (!l) return;
    const P = l.attn[L][Hh], ids = l.used, n = ids.length;
    if (!hover) drawLens(P, ids, n, l.empty);
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
  function drawLens(P, ids, n, empty) {
    const box = $('#lens');
    if (!P) { box.textContent = ''; box.dataset.key = ''; const s = document.createElement('span'); s.className = 'off'; s.textContent = 'this head is switched off: it looks at nothing'; box.appendChild(s); return; }
    const key = ids.join(',');
    if (box.dataset.key !== key) {
      box.textContent = ''; box.dataset.key = key;
      ids.forEach(id => { const s = document.createElement('span'); s.textContent = empty ? '↵' : show(S.chars[id]); s.style.fontSize = '12px'; box.appendChild(s); });
      const q = document.createElement('span'); q.className = 'q'; box.appendChild(q);
    }
    const last = n - 1; let mx = 1e-9;
    for (let j = 0; j <= last; j++) mx = Math.max(mx, P.d[last * n + j]);
    for (let j = 0; j <= last; j++) {
      const raw = P.d[last * n + j], a = Math.sqrt(raw / mx), s = box.children[j];
      s.style.fontSize = (11 + 30 * a).toFixed(1) + 'px'; s.style.opacity = (0.22 + 0.78 * a).toFixed(2);
      s.style.color = a > 0.7 ? 'var(--lime)' : a > 0.4 ? 'var(--cyan)' : 'var(--dim)';
      s.style.textShadow = a > 0.5 ? `0 0 ${Math.round(16 * a)}px rgba(185,255,102,${(0.55 * a).toFixed(2)})` : 'none';
      s.style.transform = `translateZ(${(a * 40).toFixed(0)}px)`;
      s.title = `${(100 * raw).toFixed(0)}% of this head's attention`;
    }
    const pr = S.last.probs; let b = 0; for (let k = 1; k < pr.length; k++) if (pr[k] > pr[b]) b = k;
    box.children[n].textContent = `→ ${show(S.chars[b])}`; box.children[n].title = 'its best guess for the next letter';
  }
  $('#attn').addEventListener('pointermove', e => {
    const g = S.attnGeom; if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    drawAttn({ i: Math.floor((e.clientY - r.top - g.lab) / g.cell), j: Math.floor((e.clientX - r.left - g.lab) / g.cell) });
  });

  const rec0 = () => ({ prompt: S.gen0.prompt, text: S.gen0.text, step: S.viewing >= 0 ? S.snaps[S.viewing].step : S.step });
  function noteAfterWrite(rec) {
    const n = $('#talkNote');
    if (S.mode === 'wizard' && STEPS[S.wiz.i].id === 'meet' && rec.step < 30) {
      n.innerHTML = `<b>Gibberish, and that's exactly right.</b> Its numbers are random, so it has no idea which letters go together. Look at its guesses: no letter stands out, and each of its ${S.chars.length} characters is about equally likely. Training is what changes that. Press <b>Next</b>.`;
      n.hidden = false;
    }
  }
  function genWork() {
    const g = S.gen, m = S.model, temp = +$('#temp').value; S.gen0 = g;
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
    if (g.left <= 0) {
      S.gen = null; $('#gen').textContent = 'Send ›'; flag('wrote'); noteAfterWrite(rec0());
      const rec = rec0();
      if (rec.step < 30 && !S.firstWrite) S.firstWrite = rec;
      if (rec.step >= 200) { S.lastWrite = rec; flag('wroteTrained'); }
      const t = +$('#temp').value; if (t < 0.4) flag('lowT'); if (t > 1.3) flag('highT');
      if (S.mode === 'wizard' && STEPS[S.wiz.i].id === 'again') renderBA();
    }
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
      S.landDue = performance.now(); S.land.baseLoss = S.hereLoss;
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
    if (L.baseLoss && S.hereLoss >= 1.5 * L.baseLoss) flag('climbed');
    if (!S.landDue) S.landDue = performance.now() + 150;
    touch('land', 'talk', 'emb', 'xray');
  }

  function landGeom() { const cv = $('#land'), r = cv.getBoundingClientRect(); return { W: r.width, H: r.height, r }; }
  function toPx(p, W, H) { const s = S.land.span; return [(p.a / s + 1) / 2 * W, (1 - p.b / s) / 2 * H]; }
  function fromPx(px, py, W, H) { const s = S.land.span; return { a: (px / W * 2 - 1) * s, b: (1 - py / H * 2) * s }; }

  function drawLand() {
    const [x, W, H] = fit($('#land')), L = S.land;
    if (!L || !L.img) {
      x.fillStyle = COL.dim; x.font = '14px system-ui'; x.textAlign = 'center';
      x.fillText(S.mapping ? 'Surveying the hills…' : 'Maps itself after a little training', W / 2, H / 2 - 10);
      x.fillStyle = COL.faint; x.font = '12.5px system-ui';
      x.fillText(S.mapping ? `${Math.round(100 * S.mapping.i / (L.res * L.res))}% · every pixel is a brain, tested` : 'or press MAP now', W / 2, H / 2 + 12);
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
    refreshLandSample();
    if (S.hereLoss != null) toast(`Moved by hand. Loss is now ${S.hereLoss.toFixed(3)}.`);
    S.running = was; touch('loss');
  };
  landCv.addEventListener('pointerup', endDrag); landCv.addEventListener('pointercancel', endDrag);

  // ---------- embeddings ----------
  S.embHover = -1;
  function embNeighbors(i, k = 3) {
    const { V, d } = S.model.cfg, w = S.model.wte.d, out = [];
    let na = 0; for (let t = 0; t < d; t++) na += w[i * d + t] ** 2;
    for (let j = 0; j < V; j++) {
      if (j === i) continue;
      let dot = 0, nb = 0; for (let t = 0; t < d; t++) { const b = w[j * d + t]; dot += w[i * d + t] * b; nb += b * b; }
      out.push([dot / Math.sqrt(na * nb + 1e-12), j]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, k);
  }
  $('#emb').addEventListener('pointermove', e => {
    if (!S.embScr) return;
    const r = e.currentTarget.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 18 * 18; S.embScr.forEach(([px, py], i) => { const dd = (px - mx) ** 2 + (py - my) ** 2; if (dd < bd) { bd = dd; best = i; } });
    if (best !== S.embHover) { S.embHover = best; if (best < 0) $('#embRead').textContent = 'Hover a letter to see which letters it thinks are most alike.'; touch('emb'); }
  });
  $('#emb').addEventListener('pointerleave', () => { S.embHover = -1; $('#embRead').textContent = 'Hover a letter to see which letters it thinks are most alike.'; touch('emb'); });
  $('#emb').addEventListener('click', () => { if (S.embHover >= 0) { const ch = S.chars[S.embHover]; $('#prompt').value += ch === '\n' ? '↵' : ch; touch('talk'); } });
  function drawEmb() {
    const [x, W, H] = fit($('#emb')), pts = S.model.embedPCA();
    if (!S.embPos || S.embPos.length !== pts.length) S.embPos = pts.map(p => p.slice());
    else S.embPos.forEach((p, i) => { p[0] += (pts[i][0] - p[0]) * 0.35; p[1] += (pts[i][1] - p[1]) * 0.35; });
    let mx = 1e-6; for (const p of S.embPos) mx = Math.max(mx, Math.abs(p[0]), Math.abs(p[1]));
    const sc = Math.min(W, H) / 2 / mx * 0.86;
    x.strokeStyle = COL.hair; x.beginPath(); x.moveTo(W / 2, 8); x.lineTo(W / 2, H - 8); x.moveTo(8, H / 2); x.lineTo(W - 8, H / 2); x.stroke();
    x.font = '600 12px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    S.embScr = S.embPos.map(p => [W / 2 + p[0] * sc, H / 2 - p[1] * sc]);
    const hv = S.embHover >= 0 && S.embHover < S.chars.length ? S.embHover : -1, near = hv >= 0 ? embNeighbors(hv) : [];
    if (hv >= 0) {
      x.strokeStyle = COL.lime; x.lineWidth = 1.5; x.shadowColor = COL.lime; x.shadowBlur = 8;
      near.forEach(([, j]) => { x.beginPath(); x.moveTo(...S.embScr[hv]); x.lineTo(...S.embScr[j]); x.stroke(); });
      x.shadowBlur = 0;
    }
    S.embPos.forEach((p, i) => {
      const ch = S.chars[i], [px, py] = S.embScr[i], lit = i === hv || near.some(n => n[1] === i);
      const col = /[aeiouy]/i.test(ch) ? COL.lime : /[a-z]/i.test(ch) ? COL.cyan : /\s/.test(ch) ? COL.faint : COL.pink;
      x.fillStyle = col; x.globalAlpha = lit ? .45 : hv >= 0 ? .08 : .18; x.beginPath(); x.arc(px, py, i === hv ? 14 : 10, 0, 7); x.fill();
      x.globalAlpha = hv >= 0 && !lit ? .35 : 1; x.fillText(show(ch), px, py + 1); x.globalAlpha = 1;
    });
    if (hv >= 0) $('#embRead').textContent = `“${show(S.chars[hv])}” is most like ${near.map(([, j]) => `“${show(S.chars[j])}”`).join(', ')}. Click to type it.`;
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
  function xinfo(p) {
    const n = p.name, V = S.model.cfg.V, d = S.model.cfg.d;
    if (n === 'token embeddings') return `<b>Token embeddings</b>: one row per character (labeled at left), ${d} numbers each. That row is everything the model "knows" about a character on its own. The Letter map is these rows, squashed flat.`;
    if (n === 'position embeddings') return `<b>Position embeddings</b>: one row per slot in its memory window. Added to each character so it knows <i>where</i> a letter sits in the snippet, not just which letter it is.`;
    if (/Q\/K\/V$/.test(n)) return `<b>Attention's three lenses</b>, stacked. <b>Q</b> (query): what is this letter looking for? <b>K</b> (key): what does each earlier letter offer? When a query matches a key, that square lights up in the Attention map, and <b>V</b> (value) is what gets passed along.`;
    if (/attention output$/.test(n)) return `<b>Attention output</b>: blends what all the heads found back into one list of numbers per letter.`;
    if (/MLP expand$/.test(n)) return `<b>MLP expand</b>: the "thinking" step. Each letter's ${d} numbers fan out to ${4 * d}, pass through a bend, then get squeezed back. Researchers think much of what a model memorizes lives in layers like this.`;
    if (/MLP squeeze$/.test(n)) return `<b>MLP squeeze</b>: folds the ${4 * d}-wide thinking back down to ${d} numbers.`;
    if (n === 'next-char head') return `<b>Next-letter head</b>: the very last step. It turns the final numbers into one score for each of the ${V} characters, and those scores become its next-letter guesses in Talk to it.`;
    return '';
  }
  function drawXray(hover) {
    const cv = $('#xray'), [x, W, H] = fit(cv), m = S.model, p = m.params[+$('#xsel').value];
    if (!p) return;
    $('#xdesc').innerHTML = xinfo(p);
    const src = S.xmode === 'grad' ? p.g : p.d;
    if (!src) { x.fillStyle = COL.dim; x.font = '13px system-ui'; x.fillText('No nudges yet: take a training step first.', 12, 24); S.xg = null; return; }
    const tr = p.r > p.c, cw = tr ? p.r : p.c, ch = tr ? p.c : p.r;
    const charRows = (p === m.wte && !tr) || (p === m.wlm && tr), qkv = /Q\/K\/V$/.test(p.name);
    const gl = charRows && (H - (qkv ? 16 : 0)) / ch >= 8 ? 18 : 0, gt = qkv ? 18 : 0;
    let mx = 1e-9; for (const v of src) mx = Math.max(mx, Math.abs(v));
    if (qkv) return drawQKV(x, W, H, p, src, mx, hover);
    const off = document.createElement('canvas'); off.width = cw; off.height = ch;
    const ox = off.getContext('2d'), im = ox.createImageData(cw, ch), P = hex(COL.pink), N = hex(COL.cyan), B = hex(COL.bg);
    for (let i = 0; i < p.r; i++) for (let j = 0; j < p.c; j++) {
      const v = src[i * p.c + j] / mx, t = Math.pow(Math.abs(v), 0.7), c = v >= 0 ? P : N;
      const k = tr ? (j * cw + i) : (i * cw + j);
      im.data.set([B[0] + (c[0] - B[0]) * t, B[1] + (c[1] - B[1]) * t, B[2] + (c[2] - B[2]) * t, 255], k * 4);
    }
    ox.putImageData(im, 0, 0);
    x.imageSmoothingEnabled = false; x.drawImage(off, gl, gt, W - gl, H - gt);
    x.font = '10px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (gl) { x.fillStyle = COL.dim; for (let k = 0; k < ch; k++) x.fillText(show(S.chars[k]), gl / 2, gt + (k + .5) * (H - gt) / ch); }
    if (qkv) {
      x.font = '600 11px system-ui'; x.strokeStyle = COL.ink; x.lineWidth = 1.5;
      ['Q · query', 'K · key', 'V · value'].forEach((t, k) => {
        x.fillStyle = [COL.lime, COL.amber, COL.cyan][k]; x.fillText(t, gl + (W - gl) * (k + .5) / 3, 9);
        if (k) { const xx = gl + (W - gl) * k / 3; x.beginPath(); x.moveTo(xx, gt); x.lineTo(xx, H); x.stroke(); }
      });
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    S.xg = { p, tr, cw, ch, gl, gt, W, H };
    if (hover) {
      const g = S.xg, col = Math.floor((hover.x - g.gl) / ((g.W - g.gl) / g.cw)), row = Math.floor((hover.y - g.gt) / ((g.H - g.gt) / g.ch));
      if (col >= 0 && row >= 0 && col < g.cw && row < g.ch) {
        const i = g.tr ? col : row, j = g.tr ? row : col, v = src[i * p.c + j];
        const who = charRows ? ` (“${show(S.chars[g.tr ? j : i])}”)` : '';
        $('#xread').textContent = `row ${i + 1}${who}, column ${j + 1}: ${v >= 0 ? '+' : ''}${v.toFixed(4)}`;
      }
    }
  }
  // Q, K and V stacked: three d×d blocks, one lens each.
  function drawQKV(x, W, H, p, src, mx, hover) {
    const d = p.r, gap = 4, lw = 62, bh = (H - 2 * gap) / 3, P = hex(COL.pink), N = hex(COL.cyan), B = hex(COL.bg);
    const names = [['Q', 'query', COL.lime], ['K', 'key', COL.amber], ['V', 'value', COL.cyan]];
    for (let k = 0; k < 3; k++) {
      const off = document.createElement('canvas'); off.width = d; off.height = d;
      const ox = off.getContext('2d'), im = ox.createImageData(d, d);
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
        const v = src[i * p.c + k * d + j] / mx, t = Math.pow(Math.abs(v), 0.7), c = v >= 0 ? P : N;
        im.data.set([B[0] + (c[0] - B[0]) * t, B[1] + (c[1] - B[1]) * t, B[2] + (c[2] - B[2]) * t, 255], (i * d + j) * 4);
      }
      ox.putImageData(im, 0, 0);
      const y = k * (bh + gap);
      x.imageSmoothingEnabled = false; x.drawImage(off, lw, y, W - lw, bh);
      x.fillStyle = names[k][2]; x.font = '700 15px ui-monospace,Menlo,monospace'; x.textBaseline = 'middle'; x.fillText(names[k][0], 6, y + bh / 2 - 7);
      x.font = '10px ui-monospace,Menlo,monospace'; x.fillStyle = COL.dim; x.fillText(names[k][1], 6, y + bh / 2 + 9);
    }
    x.textBaseline = 'alphabetic';
    S.xg = null;
    if (hover && hover.x > lw) {
      const k = Math.min(2, Math.floor(hover.y / (bh + gap))), col = Math.floor((hover.x - lw) / ((W - lw) / d)), row = Math.floor((hover.y - k * (bh + gap)) / (bh / d));
      if (row >= 0 && row < d && col >= 0 && col < d) { const v = src[row * p.c + k * d + col]; $('#xread').textContent = `${names[k][1]} · row ${row + 1}, col ${col + 1}: ${v >= 0 ? '+' : ''}${v.toFixed(4)}`; }
    }
  }
  $('#xray').addEventListener('pointermove', e => { const r = e.currentTarget.getBoundingClientRect(); drawXray({ x: e.clientX - r.left, y: e.clientY - r.top }); });
  $('#xray').addEventListener('pointerleave', () => { $('#xread').textContent = ''; });

  // ---------- misc ui ----------
  let toastT;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
  function stats() {
    $('#sStep').textContent = S.step.toLocaleString();
    $('#sLoss').textContent = S.ema == null ? '—' : S.ema.toFixed(3);
    if (S.model.lastAcc != null) $('#sAcc').textContent = Math.round(100 * S.model.lastAcc) + '%';
  }

  // ---------- live feedback ----------
  function sampleText(n, temp) {
    const m = S.model, ctx = context().ids.slice(); let out = '';
    for (let i = 0; i < n; i++) { const j = m.sample(m.predict(ctx, temp).probs); ctx.push(j); out += S.chars[j]; }
    return out;
  }
  const typing = new WeakMap();
  function typeOut(el, parts) {
    const tok = {}; typing.set(el, tok); el.textContent = '';
    const runs = parts.filter(p => p.text).map(p => { const sp = document.createElement('span'); if (p.cls) sp.className = p.cls; if (p.title) sp.title = p.title; el.appendChild(sp); return [sp, p.text]; });
    const cur = document.createElement('span'); cur.className = 'cursor'; el.appendChild(cur);
    const total = runs.reduce((a, r) => a + r[1].length, 0), per = Math.max(2, Math.ceil(total / 36));
    let ri = 0, ci = 0;
    const tick = () => {
      if (typing.get(el) !== tok) return;
      for (let k = 0; k < per && ri < runs.length; k++) { const [sp, t] = runs[ri]; sp.textContent = t.slice(0, ++ci); if (ci >= t.length) { ri++; ci = 0; } }
      if (ri < runs.length) setTimeout(tick, 16); else cur.remove();
    };
    tick();
  }
  function withPrompt(el, text, prompt = $('#prompt').value.replace(/↵/g, '\n')) {
    if (el.classList.contains('readout')) return typeOut(el, [{ cls: 'pr', title: 'what you typed', text: prompt }, { text }]);
    el.textContent = '';
    if (prompt) { const p = document.createElement('span'); p.className = 'pr'; p.title = 'what you typed'; p.textContent = prompt; el.appendChild(p); }
    el.append(text);
  }
  function refreshLive() {
    S.liveAt = performance.now();
    if ($('#cDash').classList.contains('on') || S.mode === 'free') withPrompt($('#attnLive'), sampleText(48, 0.6));
    withPrompt($('#live'), sampleText(90, +$('#temp').value));
    $('#liveStep').textContent = S.viewing >= 0 ? `· at step ${S.snaps[S.viewing].step.toLocaleString()} (rewound)` : S.step ? `· now, after ${S.step.toLocaleString()} steps` : '· before any training';
  }
  // Filmstrip: one sample saved at each milestone step, so "getting closer" is visible at a glance.
  const FILM_AT = new Set([50, 100, 200, 400, 800, 1600, 3200, 6400, 12800]);
  function filmShot() {
    S.film.push({ step: S.step, loss: S.step ? S.ema : Math.log(S.chars.length), text: sampleText(48, 0.5).replace(/\n/g, ' ↵ ') });
    renderFilm();
  }
  function renderFilm() {
    const ol = $('#film'); ol.textContent = '';
    if (!S.film.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Samples appear here as it trains: step 0, 50, 100, 200, 400…'; ol.appendChild(li); return; }
    for (const f of S.film) {
      const li = document.createElement('li'); li.title = `Go back to its brain at step ${f.step}`;
      const a = document.createElement('span'); a.className = 'st'; a.textContent = 'step ' + f.step.toLocaleString();
      const b = document.createElement('span'); b.className = 'ls'; b.textContent = f.loss.toFixed(2);
      const c = document.createElement('span'); c.className = 'tx'; c.textContent = f.text;
      li.append(a, b, c); li.onclick = () => travelToStep(f.step); ol.appendChild(li);
    }
  }
  // The snapshot: a longer sample every 20 seconds, typed out large, so there is time to read it.
  function takeSnapshot() {
    S.snapAt = performance.now();
    withPrompt($('#snap'), sampleText(200, +$('#temp').value));
    const at = S.viewing >= 0 ? S.snaps[S.viewing].step : S.step;
    $('#snapCap').textContent = `step ${at.toLocaleString()} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
  $('#snapNow').onclick = takeSnapshot;
  function refreshLandSample() {
    S.landAt = performance.now(); S.landDue = 0;
    withPrompt($('#landSample'), sampleText(60, 0.7));
  }
  function drawReading() {
    const s = S.model.lastSample; if (!s) return;
    const g = $('#rGuess'), t = $('#rTrue'); g.textContent = ''; t.textContent = '';
    const vis = c => c === '\n' ? '↵' : c === ' ' ? '·' : c;
    const cell = (el, ch, cls, title) => { const sp = document.createElement('span'); sp.textContent = ch; if (cls) sp.className = cls; if (title) sp.title = title; el.appendChild(sp); };
    cell(g, ' ', ''); cell(t, vis(S.chars[s.idx[0]]), 'first', 'the letter it started from');
    s.tg.forEach((tt, i) => {
      const ok = s.pred[i] === tt, gc = S.chars[s.pred[i]], tc = S.chars[tt];
      const title = ok ? `guessed “${show(tc)}”: right` : `guessed “${show(gc)}”, but it was “${show(tc)}”`;
      cell(g, vis(gc), ok ? 'ok' : 'no', title); cell(t, vis(tc), ok ? 'ok' : 'no', title);
    });
  }
  $('#slowmo').onclick = () => $('#step1').click();

  // ---------- the steps ----------
  // Each step opens on a centered intro screen (one idea, one button), then walks through its
  // sub-steps (6a, 6b ...) one instruction at a time, highlighting the control to use.
  const lnV = () => Math.log(S.chars.length);
  S.flags = {};
  const flag = k => { S.flags[k] = true; };
  const F = k => !!S.flags[k];
  const STEPS = [
    { id: 'welcome', welcome: true, title: 'Pocket <span>GPT</span>', go: 'Let’s build one ›', subs: [],
      lead: `A real GPT, the same design as the chatbots you know, shrunk small enough to watch every part of it think. Feed it a text, meet it while it still knows nothing, then train it at a live console and watch it learn. It all runs right here in your browser.` },
    { id: 'feed', rail: 'Feed it', title: 'Feed it', noIntro: true, cards: ['cFeed'], bare: ['cFeed'], subs: [], info: 'feed',
      guide: `Pick what it will learn from. Everything it will ever know comes from this one text.` },
    { id: 'meet', rail: 'Meet it', title: 'Meet it', noIntro: true, cards: ['cTalk'],
      enter: () => { $('#talkNote').hidden = true; },
      guide: () => `Start a chat and watch your Pocket GPT respond in real time. It hasn't learned a thing yet: its <b>${S.model.size.toLocaleString()} numbers</b> are still random.`,
      doneGuide: () => S.step === 0 && !S.baseSteps
        ? `That's a model with no training: <b>${S.model.size.toLocaleString()} numbers of pure static</b>. <b>Notice its next-letter guesses:</b> no letter stands out, and its top pick is usually wrong. Every GPT, even the giant ones, starts exactly here.`
        : `This brain has already trained for <b>${((S.baseSteps || 0) + S.step).toLocaleString()} steps</b>, so it's no longer static. <b>Look at its next-letter guesses:</b> one letter now stands out.`,
      subs: [{ s: 'Write', t: '', how: '', test: () => F('wrote') }] },
    { id: 'train', rail: 'Train it', title: 'Train it', go: '▶ Start training', goAct: () => setRunning(true), cards: ['cDash'], dash: true,
      lead: `Now it learns from the text you fed it. Over and over, it reads a snippet, covers up the next letter, guesses it, then peeks: right or wrong? Every wrong guess nudges its numbers a little. Do that thousands of times a second, and static turns into your text's voice.`,
      enter: () => { S.snapAt = performance.now() - 18500; },
      subs: [
        { s: 'Beat random', t: '', how: '', test: () => S.ema != null && S.ema < 0.9 * lnV(), mile: 'beat random' },
        { s: '6 in 10 right', t: '', how: '', test: () => S.model.lastAcc >= 0.6, mile: '60% right' }] },
    { id: 'lab', rail: 'Your lab', title: 'Your lab', noIntro: true, cards: ['cFinale', 'cTalk', 'cDash', 'cBrains'], layout: 'lab', subs: [],
      guide: `Keep training, keep chatting, save the brains you like, or start again with a new text.`,
      enter: () => { renderHub(); S.snapAt = S.snapAt || performance.now() - 18500; } },
  ];
  const LAST = STEPS.length - 1;
  S.wiz = { i: 0, sub: -1, met: {} };
  const subMet = (st, k) => !!S.wiz.met[st.id + ':' + k];
  const stepDone = st => st.subs.every((_, k) => subMet(st, k));
  const firstUnmet = st => { const k = st.subs.findIndex((_, j) => !subMet(st, j)); return k < 0 ? st.subs.length : k; };

  function renderRail() {
    const rail = $('#rail'); rail.textContent = '';
    STEPS.forEach((st, i) => {
      if (st.welcome) return;
      const li = document.createElement('li');
      if (i === S.wiz.i) li.className = 'now'; else if (st.subs.length && stepDone(st)) li.className = 'done';
      const b = document.createElement('button'), sp = document.createElement('span'); sp.textContent = st.rail;
      b.title = st.title; b.appendChild(sp); b.onclick = () => showStep(i); li.appendChild(b); rail.appendChild(li);
    });
  }
  function renderIntro() {
    const st = STEPS[S.wiz.i];
    $('#iKick').textContent = S.wiz.i === LAST ? 'Tour complete' : '';
    $('#iTitle').innerHTML = st.title;
    $('#iLead').innerHTML = typeof st.lead === 'function' ? st.lead() : st.lead;
    $('#iGo').textContent = st.go;
    $('#iBack').hidden = !!st.welcome;
  }
  function renderWork() {
    const st = STEPS[S.wiz.i], n = S.wiz.i;
    $('#wKick').textContent = ''; $('#subs').hidden = true;
    const t = $('#wTitle'); t.textContent = st.title;
    if (st.info) { const b = document.createElement('button'); b.className = 'info'; b.dataset.info = st.info; b.title = 'How the real ones work'; b.textContent = 'i'; bindInfo(b); t.appendChild(b); }
    const g = st.doneGuide && st.subs.length && stepDone(st) ? st.doneGuide : st.guide;
    $('#wLead').innerHTML = typeof g === 'function' ? g() : (g || '');
    const nx = $('#wNext');
    nx.hidden = n === LAST; $('#wBack').disabled = false;
    nx.textContent = n < LAST ? STEPS[n + 1].title + ' ›' : ''; nx.classList.add('ready');
    $('#wHint').textContent = '';
  }
  function applyFocus() { /* objectives no longer glow controls */ }
  function setSub(k) { S.wiz.sub = k; renderWork(); applyFocus(true); }
  function checkGoals() {
    if (S.mode !== 'wizard' || document.body.classList.contains('at-intro')) return;
    const st = STEPS[S.wiz.i]; let changed = false;
    st.subs.forEach((sb, k) => {
      if (subMet(st, k) || !sb.test()) return;
      S.wiz.met[st.id + ':' + k] = true; changed = true;
      if (sb.mile) { S.miles.push({ step: S.step, label: sb.mile }); touch('loss'); }
    });
    if (changed) { renderRail(); renderWork(); }
  }
  function showStep(i, opts = {}) {
    S.wiz.i = Math.max(0, Math.min(LAST, i));
    const st = STEPS[S.wiz.i], intro = !!st.welcome || (opts.intro !== false && !st.noIntro);
    S.wiz.sub = intro ? -1 : firstUnmet(st);
    document.body.classList.toggle('at-intro', intro);
    document.body.classList.toggle('at-welcome', intro && !!st.welcome);
    const cards = st.cards || [];
    document.querySelectorAll('main .card').forEach(c => { c.classList.toggle('on', cards.includes(c.id)); c.classList.toggle('bare', (st.bare || []).includes(c.id)); });
    ['two', 'lab', 'talklast'].forEach(c => $('main').classList.toggle(c, st.layout === c));
    document.body.classList.toggle('dashstep', !intro && !!st.dash);
    closeSheets();
    if (!intro && st.enter) st.enter();
    renderRail(); if (intro) renderIntro(); else renderWork();
    save(); touch(...ALL);
    window.scrollTo({ top: 0, behavior: intro ? 'auto' : 'smooth' });
  }
  function renderBA() {
    if (!$('#baThen')) return;
    if (!S.firstWrite) {
      const now = S.model.flat(); S.model.setFlat(S.snaps[0].f);
      S.firstWrite = { prompt: $('#prompt').value.replace(/↵/g, '\n'), text: sampleText(140, 0.8), step: 0 };
      S.model.setFlat(now);
    }
    withPrompt($('#baThen'), S.firstWrite.text, S.firstWrite.prompt);
    if (S.lastWrite) {
      withPrompt($('#baNow'), S.lastWrite.text, S.lastWrite.prompt);
      $('#baNowLbl').textContent = `After ${S.lastWrite.step.toLocaleString()} steps of training`;
    }
  }
  // The dock says when the brain needs training again, and the Train button pulses until it gets it.
  function needRetrain(msg) {
    const r = $('#retrain'); r.textContent = '↑ ' + msg; r.hidden = false;
    const g = $('#go'); g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse');
  }
  function clearRetrain() { $('#retrain').hidden = true; }
  function afterUserBuild() {
    mood('New brain: it knows nothing again.');
    needRetrain('New brain: it knows nothing yet. Press ▶ Train to teach it.');
  }

  // Remembered per browser: which mode, which step. The model itself is not saved.
  const UI_KEY = 'pocketgpt-ui-v2';
  function save() { try { localStorage.setItem(UI_KEY, JSON.stringify({ mode: S.mode, i: S.wiz.i })); } catch (e) { /* storage blocked */ } }
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } }
  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('wizard', m === 'wizard'); document.body.classList.toggle('free', m === 'free');
    if (m === 'free') {
      document.body.classList.remove('at-intro', 'at-welcome', 'trains');
      document.querySelectorAll('main .card').forEach(c => { c.classList.add('on'); c.classList.remove('bare'); });
      document.querySelectorAll('.focus').forEach(e => e.classList.remove('focus'));
      $('main').classList.remove('two', 'lab', 'talklast'); document.body.classList.remove('dashstep');
      save(); touch(...ALL);
    } else showStep(S.wiz.i);
  }
  $('#iGo').onclick = () => {
    const st = STEPS[S.wiz.i];
    if (st.welcome) return showStep(1);
    showStep(S.wiz.i, { intro: false }); if (st.goAct) st.goAct();
  };
  $('#iBack').onclick = () => { const p = S.wiz.i - 1; showStep(p, { intro: !!STEPS[p].welcome }); };
  $('#wBack').onclick = () => showStep(S.wiz.i);
  $('#wNext').onclick = () => {
    if (STEPS[S.wiz.i].id === 'feed') { if (feedDirty()) $('#useText').click(); flag('fed'); checkGoals(); }
    showStep(S.wiz.i + 1);
  };
  $('#corpus').addEventListener('input', feedDirty);

  const INFO = {
    feed: () => `A model can only echo what it was fed, which is why what goes into training is the biggest decision there is. Feed it nursery rhymes and it dreams in rhymes. The big labs spend enormous effort choosing and cleaning their text for exactly this reason. <b>New text means a fresh brain</b>, because its alphabet changes.`,
    snap: () => `This is what a chatbot does when it answers you: one letter (for the big ones, one word-piece) at a time, each picked from its guesses, until it decides to stop. A snapshot every 20 seconds gives you time to read a longer stretch. <b>Creativity</b> (the pros say <i>temperature</i>) sets how far down its list of guesses it's allowed to pick: low is safe and repetitive, high is surprising, then weird.`,
    live: () => `A fresh short sample every couple of seconds, straight from the brain as it is right now, so you can watch it change while it trains. Your own words are highlighted; everything after them is its guesswork.`,
    train: () => `This is how every chatbot was made: guess the next piece of text, measure how wrong, nudge the numbers. The only difference is scale. They read a large slice of the internet and nudge hundreds of billions of numbers on thousands of chips for months; you're nudging ${S.model.size.toLocaleString()}. <b>Reading the graph:</b> lower is better, and the dashed line is what random guessing scores. Drag ⏳ or click the graph to rewind its brain to any step.`,
    read: () => `Every wrong guess is what it learns from. The top row is its guess for each next letter, made <i>before</i> it sees the letter; the bottom row is what was really there. <b>Slow-mo</b> takes exactly one step, so you can watch a single nudge.`,
    next: () => `Every word a chatbot has ever written came out of guesses exactly like these: score every possible next piece, pick one, repeat. The big ones score word-pieces instead of letters. The bigger the letter, the surer it is. Click one to type it, or edit the text it continues from.`,
    attn: () => `<b>The lens</b> is your text, each letter sized by how hard the <i>last</i> letter looks at it while guessing what comes next (→). <b>The squares</b> show the same for every letter: each row is a letter looking back along its own row. Each head learned its own way of looking. <b>✂ Head off</b> is brain surgery: researchers switch parts off one at a time (<i>ablation</i>) to see what breaks. In bigger models, researchers at Anthropic found <b>induction heads</b>, which spot an earlier copy of a word and look at what came right after it, and in 2022 showed they're a big part of how large models learn from examples in your prompt.`,
    land: () => `Its whole brain is one point in a space with ${S.model.size.toLocaleString()} directions. This is a flat slice through two random directions, colored by how wrong each nearby brain would be: dark is good. The glowing ball is your model; the arrow points downhill, the <i>gradient</i>. <b>Drag the ball</b> to change its brain for real and watch its writing fall apart. Training usually slips away sideways, through directions this slice can't show; tick <b>Stick to map</b> to hold it here and watch it roll home. The method comes from a 2018 paper on why some networks train easily and others don't.`,
    emb: () => `Each character is a list of numbers: its coordinates in a space with many directions. This squashes that space flat. Nobody tells it what a vowel is, yet letters it treats alike drift together as it trains. <b>Hover a letter</b> to see its closest neighbours in the full space. Big models do this with words: in a famous 2013 result, "king" minus "man" plus "woman" landed next to "queen."`,
    xray: () => `The raw numbers it is made of: pink positive, blue negative, dark near zero. <b>Nudges</b> shows which way the latest step pushed each one. Pick <b>attention Q/K/V</b> to see its three lenses: each letter's <b>query</b> (what am I looking for?) is matched against every earlier letter's <b>key</b> (what do I offer?). Query × key gives a match score, the scores become the attention squares, and each letter's <b>value</b> is what gets passed along, in proportion. So the query is matched against the key, not the value. <b>Scramble</b> a part and train to watch it heal: breaking parts on purpose is a basic tool of <i>interpretability</i>, the science of reading these numbers.`,
  };
  const closePops = () => { document.querySelectorAll('.pop').forEach(p => p.remove()); document.querySelectorAll('.info.open').forEach(b => b.classList.remove('open')); };
  function bindInfo(b) {
    b.onclick = e => {
      e.stopPropagation();
      const was = b.classList.contains('open'); closePops(); if (window.Holo) Holo.close(); if (was) return;
      if (window.Holo) { Holo.open({ anchor: b, title: 'How the real ones work', html: INFO[b.dataset.info](), wide: true }); b.classList.add('open'); return; }
      const w = b.closest('.w') || b.closest('.card') || b.parentElement;
      const p = document.createElement('div'), k = document.createElement('div'), body = document.createElement('div');
      p.className = 'pop'; k.className = 'pk'; k.textContent = 'How the real ones work';
      body.innerHTML = INFO[b.dataset.info](); p.append(k, body); p.onclick = ev => ev.stopPropagation();
      w.appendChild(p); b.classList.add('open');
    };
  }
  document.querySelectorAll('.info[data-info]').forEach(bindInfo);
  document.addEventListener('click', closePops);
  if (window.Holo) document.querySelectorAll('[data-tip]').forEach(b => Holo.tip(b, b.dataset.tip));
  function openSheet(id) { closeSheets(); $('#' + id).classList.add('open'); $('#scrim').hidden = false; }
  function closeSheets() { document.querySelectorAll('.sheet.open').forEach(x => x.classList.remove('open')); $('#scrim').hidden = true; }
  document.querySelectorAll('[data-sheet]').forEach(b => b.onclick = e => { e.stopPropagation(); openSheet(b.dataset.sheet); });
  document.querySelectorAll('.sheet [data-close]').forEach(b => b.onclick = closeSheets);
  $('#scrim').onclick = closeSheets;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheets(); closePops(); } });
  $('#build').addEventListener('click', closeSheets);
  $('#dPrompt').addEventListener('input', e => { $('#prompt').value = e.target.value; touch('talk'); });
  $('#dPrompt').addEventListener('scroll', e => { $('#dGhost').scrollLeft = e.target.scrollLeft; });
  const HUB = { feed: 'Change what it reads', meet: 'A brand-new brain', train: 'The training console' };
  function renderHub() {
    const hub = $('#hub'); hub.textContent = '';
    STEPS.forEach((st, i) => {
      if (st.welcome || i === LAST) return;
      const b = document.createElement('button'), t = document.createElement('b'), d = document.createElement('span');
      t.textContent = st.title; d.textContent = HUB[st.id] || ''; b.append(t, d); b.onclick = () => showStep(i); hub.appendChild(b);
    });
  }
  // ---------- saved brains ----------
  // A brain is its numbers plus the alphabet they line up with, its shape, and (so it can keep
  // learning) the text it read. Saved in this browser, or downloaded as a file to share.
  const BRAIN_KEY = 'pocketgpt-brains-v1', BRAIN_MAX = 8;
  const toB64 = f => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
  const slug = t => (t || 'brain').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brain';
  function brainName() {
    const c = window.CORPORA.find(c => c.id === S.preset), steps = (S.baseSteps || 0) + S.step;
    return ($('#brainName').value.trim() || `${c ? c.label : 'Your text'} · ${steps.toLocaleString()} steps`).slice(0, 40);
  }
  function packBrain() {
    const c = S.model.cfg;
    return { app: 'pocket-gpt', v: 1, name: brainName(), saved: new Date().toISOString(), steps: (S.baseSteps || 0) + S.step,
      cfg: { d: c.d, n: c.n, L: c.L, H: c.H }, chars: S.chars.slice(), text: S.corpusText.length <= 300000 ? S.corpusText : S.corpusText.slice(0, 300000),
      weights: toB64(S.model.flat()) };
  }
  function listBrains() { try { const l = JSON.parse(localStorage.getItem(BRAIN_KEY)); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function storeBrains(l) { try { localStorage.setItem(BRAIN_KEY, JSON.stringify(l)); return true; } catch (e) { return false; } }
  function loadBrain(pk) {
    if (!pk || pk.app !== 'pocket-gpt' || !Array.isArray(pk.chars) || !pk.cfg || typeof pk.weights !== 'string') throw new Error('That isn’t a Pocket GPT brain file.');
    const { d, n, L, H } = pk.cfg;
    if (!WIDTHS.includes(d) || !HEADS.includes(H) || !(L >= 1 && L <= 4) || !(n >= 8 && n <= 48) || !pk.chars.length || pk.chars.length > 400 || !pk.chars.every(c => typeof c === 'string'))
      throw new Error('This brain has a shape this page can’t build.');
    let w; try { w = fromB64(pk.weights); } catch (e) { throw new Error('This brain file is damaged.'); }
    const V = pk.chars.length;
    if (w.length !== estParams({ L, d, n }, V) || !w.every(Number.isFinite)) throw new Error('This brain file is damaged.');
    // its alphabet is the saved one, so every number still lines up with the right character
    const text = typeof pk.text === 'string' && pk.text.length >= 20 ? pk.text : pk.chars.join('').repeat(4);
    setRunning(false);
    S.chars = pk.chars.slice(); S.stoi = Object.fromEntries(S.chars.map((c, i) => [c, i]));
    S.corpusText = text; S.data = Int32Array.from([...text].filter(c => c in S.stoi), c => S.stoi[c]);
    $('#corpus').value = text; $('#corpusInfo').textContent = `${text.length.toLocaleString()} chars · ${V} different ones`; feedDirty();
    $('#kL').value = L; $('#kH').value = HEADS.indexOf(H); $('#kD').value = WIDTHS.indexOf(d); $('#kN').value = n;
    document.querySelectorAll('#presets .chip').forEach(c => c.classList.remove('sel'));
    build();
    S.model.setFlat(w); S.snaps[0].f = S.model.flat(); S.baseSteps = +pk.steps || 0;
    S.film = []; filmShot();
    const nm = String(pk.name || 'a saved brain').slice(0, 40);
    $('#blurb').textContent = `Loaded “${nm}”.`; $('#talkNote').hidden = true; clearRetrain();
    mood(`Loaded “${nm}”, trained for ${S.baseSteps.toLocaleString()} steps before it was saved.`);
    refreshLive(); touch(...ALL);
    return nm;
  }
  function renderBrains() {
    const ul = $('#brains'), l = listBrains(); ul.textContent = '';
    if (!l.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No saved brains yet. Train one, name it, and press Save this brain.'; ul.appendChild(li); return; }
    l.forEach((pk, i) => {
      const li = document.createElement('li'), b = document.createElement('b'), m = document.createElement('span');
      b.textContent = String(pk.name).slice(0, 40); m.className = 'meta';
      m.textContent = `${(+pk.steps || 0).toLocaleString()} steps · ${pk.chars.length} characters · ${pk.cfg.L} layers · saved ${new Date(pk.saved).toLocaleDateString()}`;
      const ld = document.createElement('button'); ld.className = 'btn small go'; ld.textContent = 'Load';
      ld.onclick = () => { try { toast(`Loaded “${loadBrain(pk)}”. Press ▶ Train to keep teaching it.`); } catch (e) { toast(e.message); } };
      const dl = document.createElement('button'); dl.className = 'btn small'; dl.textContent = '⬇'; dl.title = 'Download as a file'; dl.onclick = () => downloadBrain(pk);
      const rm = document.createElement('button'); rm.className = 'btn small'; rm.textContent = '✕'; rm.title = 'Remove from this browser';
      rm.onclick = () => { const k = listBrains(); k.splice(i, 1); storeBrains(k); renderBrains(); };
      li.append(b, m, ld, dl, rm); ul.appendChild(li);
    });
  }
  function downloadBrain(pk) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(pk)], { type: 'application/json' }));
    a.href = url; a.download = `${slug(pk.name)}.pocketgpt.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function saveBrainNow() {
    if (S.step === 0 && !S.baseSteps) { toast('Train it first. There’s nothing learned to save yet.'); return null; }
    const pk = packBrain(), l = listBrains().filter(x => x.name !== pk.name);
    l.unshift(pk); while (l.length > BRAIN_MAX) l.pop();
    if (!storeBrains(l)) { toast('This browser’s storage is full. Use Download as a file instead.'); return null; }
    renderBrains(); return pk;
  }
  $('#saveBrain').onclick = () => { const pk = saveBrainNow(); if (pk) toast(`Saved “${pk.name}” in this browser.`); };
  $('#saveLab').onclick = () => { const pk = saveBrainNow(); if (!pk) return; toast(`Saved “${pk.name}”. It’s in your lab.`); showStep(LAST); };
  $('#dlBrain').onclick = () => { if (S.step === 0 && !S.baseSteps) return toast('Train it first. There’s nothing learned to save yet.'); downloadBrain(packBrain()); };
  $('#brainFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 5e6) return toast('That file is too big to be a Pocket GPT brain.');
    const rd = new FileReader();
    rd.onload = () => { try { toast(`Loaded “${loadBrain(JSON.parse(String(rd.result)))}”. Press ▶ Train to keep teaching it.`); } catch (err) { toast(err instanceof SyntaxError ? 'That isn’t a Pocket GPT brain file.' : err.message); } };
    rd.readAsText(f);
  });
  renderBrains();

  function restartTour() {
    S.wiz.met = {}; S.flags = {}; S.stick = false; $('#stick').checked = false;
    loadPreset('rhymes'); clearRetrain(); if (S.mode !== 'wizard') setMode('wizard'); showStep(0);
  }
  $('#restart').onclick = () => {
    if (S.step > 0 && !confirm('Start over? You’ll get a fresh, untrained brain. (Save this one first if you want to keep it.)')) return;
    restartTour();
  };

  const OPT = {
    adam: '<b>Adam</b> isn’t a person. It’s short for <i>adaptive moment estimation</i>, a recipe from 2014 that, in one form or another, trains most big AI today. It gives every number its own step size: bigger for numbers that keep getting pushed the same way, smaller for jittery ones.',
    momentum: '<b>Momentum</b> treats the numbers like a heavy ball: it builds up speed going downhill and can coast over small bumps. Try it in Push the ball.',
    sgd: '<b>Plain SGD</b> (stochastic gradient descent) is the simplest rule there is: step straight downhill, by the step size, every time. Slow and honest. It usually needs a bigger step size.',
  };
  const optMeta = () => { $('#optMeta').innerHTML = OPT[$('#opt').value]; };
  $('#opt').addEventListener('change', optMeta); optMeta();

  function loadPreset(id) {
    const p = window.CORPORA.find(c => c.id === id); S.preset = id;
    document.querySelectorAll('#presets .chip').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
    $('#blurb').textContent = p.blurb; $('#corpus').value = p.text; $('#prompt').value = DEFAULT_PROMPT[id];
    setText(p.text); build();
  }

  // ---------- wiring ----------
  window.CORPORA.forEach(c => {
    const b = document.createElement('span'); b.className = 'chip'; b.dataset.id = c.id; b.textContent = c.label;
    b.onclick = () => { loadPreset(c.id); flag('fed'); afterUserBuild(); }; $('#presets').appendChild(b);
  });
  $('#useText').onclick = () => {
    const t = $('#corpus').value;
    if (t.length < 60) return toast('Give it at least a few lines of text.');
    document.querySelectorAll('#presets .chip').forEach(c => c.classList.remove('sel'));
    S.preset = 'custom'; $('#blurb').textContent = 'Your own text.'; $('#prompt').value = (t.trim().match(/^\S{1,10}/) || [''])[0];
    setText(t); build(); flag('fed'); afterUserBuild(); toast('New brain built for your text.');
  };
  ['#kL', '#kH', '#kD', '#kN'].forEach(s => $(s).addEventListener('input', knobInfo));
  $('#build').onclick = () => { build(); flag('built'); afterUserBuild(); toast('New brain built. It knows nothing yet.'); };
  $('#go').onclick = () => setRunning(!S.running);
  $('#step1').onclick = () => {
    setRunning(false); if (S.viewing >= 0) branch();
    doStep(); updateMood(); drawReading(); refreshLive(); touch(...ALL);
    const m = S.model;
    toast(`One step: read ${$('#batch').value} snippets, got ${Math.round(100 * m.lastAcc)}% of ${m.lastGuesses} guesses right, nudged all ${m.size.toLocaleString()} numbers.`);
  };
  const lrLabel = () => { $('#vLr').textContent = lr() < 0.001 ? lr().toExponential(0) : lr().toFixed(lr() < 0.01 ? 4 : 3); };
  $('#lr').addEventListener('input', lrLabel); lrLabel();
  const howChanged = () => { flag('tuned'); if (!S.running) needRetrain('You changed how it learns. Press TRAIN to see what that does.'); };
  ['#lr', '#batch'].forEach(id => $(id).addEventListener('change', howChanged)); $('#opt').addEventListener('change', howChanged);
  [['#batch', v => v], ['#speed', v => v + '/f'], ['#temp', v => v.toFixed(2)], ['#zoom', v => '±' + v.toFixed(2)], ['#kickAmt', v => v.toFixed(2)]]
    .forEach(([id, f]) => { const el = $(id), v = $({ '#batch': '#vBatch', '#speed': '#vSpeed', '#temp': '#vTemp', '#zoom': '#vZoom', '#kickAmt': '#vKick' }[id]); const u = () => (v.textContent = f(+el.value)); el.addEventListener('input', u); u(); });
  $('#temp').addEventListener('input', () => { touch('talk'); $('#dTemp').value = $('#temp').value; $('#vdTemp').textContent = (+$('#temp').value).toFixed(2); });
  $('#dTemp').addEventListener('input', e => { $('#temp').value = e.target.value; $('#temp').dispatchEvent(new Event('input')); });
  $('#dTemp').addEventListener('change', () => { refreshLive(); takeSnapshot(); });
  $('#prompt').addEventListener('input', () => touch('talk'));
  $('#gen').onclick = () => {
    if (S.gen) { S.gen.left = 0; return; }
    const ctx = context();
    S.gen = { ctx: ctx.ids.slice(), prompt: $('#prompt').value.replace(/↵/g, '\n'), text: '', left: 280 };
    $('#gen').textContent = 'Stop ■';
  };
  function topGuess() {
    const r = S.model.predict(context().ids, 1), p = r.probs; let j = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[j]) j = k;
    return { ch: show(S.chars[j]), p: p[j] };
  }
  $('#snip').onclick = () => {
    const { l, h } = S.sel, m = S.model;
    const g0 = topGuess(), l0 = m.loss(S.evalBatch), w0 = sampleText(44, 0.3);
    m.off[l][h] = !m.off[l][h];
    const g1 = topGuess(), l1 = m.loss(S.evalBatch), d = l1 - l0, w1 = sampleText(44, 0.3);
    S.events.push({ step: S.step, type: 'snip' });
    const el = $('#compare'); el.textContent = '';
    const b = t => { const x = document.createElement('b'); x.textContent = t; return x; };
    const verdict = !m.off[l][h] ? 'Head back on.'
      : S.step < 100 ? 'It has barely trained yet, so there is not much to break. Train first, then try again.'
      : d > 0.05 ? 'Worse without it: this head was doing real work.'
      : d > 0.01 ? 'A little worse: it helped, but others cover for it.'
      : 'Barely changed: this head was not pulling much weight.';
    el.append('Top guess ', b(`“${g0.ch}” ${(100 * g0.p).toFixed(0)}%`), ' → ', b(`“${g1.ch}” ${(100 * g1.p).toFixed(0)}%`),
      ' · wrongness (loss) ', b(l0.toFixed(2)), ' → ', b(l1.toFixed(2)), '. ', verdict);
    const ww = (lbl, t) => { const d = document.createElement('div'); d.className = 'cw'; const s = document.createElement('span'); s.textContent = lbl; d.append(s, t.replace(/\n/g, ' ↵ ')); return d; };
    el.append(ww(m.off[l][h] ? 'Writing with it:' : 'Writing without it:', w0), ww(m.off[l][h] ? 'Without it:' : 'With it back:', w1));
    refreshLive();
    renderArch(); touch('talk', 'loss'); flag('snip');
  };
  // Load the saved brain nearest to a step. Saving "now" first means the latest point is always reachable.
  function travelToStep(step) {
    if (S.viewing < 0) { setRunning(false); if (S.snaps[S.snaps.length - 1].step !== S.step) snapshot(); }
    let i = 0; S.snaps.forEach((sn, k) => { if (Math.abs(sn.step - step) <= Math.abs(S.snaps[i].step - step)) i = k; });
    S.model.setFlat(S.snaps[i].f); S.model.resetOptimizer();
    const now = i === S.snaps.length - 1 && S.snaps[i].step === S.step;
    S.viewing = now ? -1 : i; $('#tm').value = i; if (!now) flag('rewound');
    $('#vTm').textContent = now ? 'now' : `step ${S.snaps[i].step}`;
    if (S.land) trackPath(false);
    refreshLive(); if (S.land && S.land.img) refreshLandSample();
    mood(now ? 'Back to its latest brain.' : `Rewound to its brain at step ${S.snaps[i].step.toLocaleString()}. Press Send to hear it then, or ▶ Train to carry on from here.`);
    touch('talk', 'emb', 'xray', 'land', 'loss');
  }
  $('#tm').addEventListener('input', e => { const sn = S.snaps[+e.target.value]; if (sn) travelToStep(sn.step); });
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
    toast(`💥 Loss ${before.toFixed(2)} → ${after.toFixed(2)}. Train to see if it recovers.`); needRetrain('Knocked off course. Press ▶ Train to see if it recovers.');
    refreshLive(); if (S.land && S.land.img) refreshLandSample();
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
    S.model.resetOptimizer(); S.events.push({ step: S.step, type: 'scramble' }); flag('scrambled'); S.scrambleAt = S.step;
    toast(`Scrambled ${p.name}. Train to heal it.`); refreshLive(); needRetrain('Part of its brain is scrambled. Press ▶ Train to heal it.'); touch(...ALL);
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
      if (S.frame % 6 === 0) drawReading();
      if (S.frame % 10 === 0) renderNarr();
      if (performance.now() - (S.liveAt || 0) > 1800) refreshLive();
      else if (S.land && S.land.img && performance.now() - (S.landAt || 0) > 1600) refreshLandSample();
      if (S.land && S.land.img && S.stick && S.frame % 30 === 0) S.ballEval = S.model.loss(S.evalBatch);
      if (!S.land && !S.mapping && !S.autoMapped && S.step >= 300 && $('#cDash').classList.contains('on')) { S.autoMapped = true; startMap(); }
    }
    if (S.frame % 10 === 0) checkGoals();
    if ($('#cDash').classList.contains('on') && !document.body.classList.contains('at-intro')) {
      const el = performance.now() - (S.snapAt || 0);
      if (el >= 20000) takeSnapshot(); else $('#snapBar').style.width = (el / 200).toFixed(1) + '%';
    }
    if (!S.running && S.narrWasRunning) renderNarr();
    S.narrWasRunning = S.running;
    if (S.landDue && performance.now() > S.landDue && !S.mapping) refreshLandSample();
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

  loadPreset('rhymes');
  S.booted = true;
  { const ui = loadUI(); S.wiz.i = Math.max(0, Math.min(LAST, ui.i | 0)); setMode('wizard'); }
  requestAnimationFrame(loop);
})();
