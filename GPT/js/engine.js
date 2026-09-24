// Pocket GPT engine — a real (tiny) decoder-only transformer with hand-written
// backprop. Everything is a 2-D Float32Array matrix; ops record themselves on a
// tape while REC is on, and backward() replays the tape in reverse.
'use strict';
(function () {
  let REC = false;
  let TAPE = [];

  class T {
    constructor(r, c, d) { this.r = r; this.c = c; this.d = d || new Float32Array(r * c); this.g = null; this.back = null; }
  }
  const gr = t => t.g || (t.g = new Float32Array(t.d.length));
  function out(r, c) { const t = new T(r, c); if (REC) TAPE.push(t); return t; }

  // ---------- ops ----------
  function matmul(A, B) { // [n,k] x [k,m]
    const n = A.r, k = A.c, m = B.c, a = A.d, b = B.d, o = out(n, m), od = o.d;
    for (let i = 0; i < n; i++) {
      const oo = i * m;
      for (let p = 0; p < k; p++) {
        const av = a[i * k + p]; if (av === 0) continue;
        const bo = p * m;
        for (let j = 0; j < m; j++) od[oo + j] += av * b[bo + j];
      }
    }
    if (REC) o.back = () => {
      const g = o.g, ga = gr(A), gb = gr(B);
      for (let i = 0; i < n; i++) {
        const go = i * m;
        for (let p = 0; p < k; p++) {
          const bo = p * m, av = a[i * k + p];
          let s = 0;
          for (let j = 0; j < m; j++) { s += g[go + j] * b[bo + j]; gb[bo + j] += av * g[go + j]; }
          ga[i * k + p] += s;
        }
      }
    };
    return o;
  }

  function matmulT(A, B) { // [n,k] x [m,k]^T -> [n,m]
    const n = A.r, k = A.c, m = B.r, a = A.d, b = B.d, o = out(n, m), od = o.d;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      let s = 0; const ao = i * k, bo = j * k;
      for (let p = 0; p < k; p++) s += a[ao + p] * b[bo + p];
      od[i * m + j] = s;
    }
    if (REC) o.back = () => {
      const g = o.g, ga = gr(A), gb = gr(B);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const gv = g[i * m + j]; if (gv === 0) continue;
        const ao = i * k, bo = j * k;
        for (let p = 0; p < k; p++) { ga[ao + p] += gv * b[bo + p]; gb[bo + p] += gv * a[ao + p]; }
      }
    };
    return o;
  }

  function add(X, Y) {
    const o = out(X.r, X.c), x = X.d, y = Y.d, od = o.d;
    for (let i = 0; i < od.length; i++) od[i] = x[i] + y[i];
    if (REC) o.back = () => { const g = o.g, gx = gr(X), gy = gr(Y); for (let i = 0; i < g.length; i++) { gx[i] += g[i]; gy[i] += g[i]; } };
    return o;
  }

  function addBias(X, b) { // b is [1,c]
    const n = X.r, c = X.c, o = out(n, c), x = X.d, bd = b.d, od = o.d;
    for (let i = 0; i < n; i++) for (let j = 0; j < c; j++) od[i * c + j] = x[i * c + j] + bd[j];
    if (REC) o.back = () => {
      const g = o.g, gx = gr(X), gb = gr(b);
      for (let i = 0; i < n; i++) for (let j = 0; j < c; j++) { const v = g[i * c + j]; gx[i * c + j] += v; gb[j] += v; }
    };
    return o;
  }

  function embed(W, idx) {
    const c = W.c, o = out(idx.length, c), w = W.d, od = o.d;
    for (let i = 0; i < idx.length; i++) od.set(w.subarray(idx[i] * c, idx[i] * c + c), i * c);
    if (REC) o.back = () => {
      const g = o.g, gw = gr(W);
      for (let i = 0; i < idx.length; i++) { const wo = idx[i] * c; for (let j = 0; j < c; j++) gw[wo + j] += g[i * c + j]; }
    };
    return o;
  }

  function layernorm(X, gm, bt) {
    const n = X.r, c = X.c, o = out(n, c), x = X.d, od = o.d, xh = new Float32Array(n * c), rs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let mu = 0; for (let j = 0; j < c; j++) mu += x[i * c + j]; mu /= c;
      let v = 0; for (let j = 0; j < c; j++) { const d = x[i * c + j] - mu; v += d * d; } v /= c;
      const r = 1 / Math.sqrt(v + 1e-5); rs[i] = r;
      for (let j = 0; j < c; j++) { const h = (x[i * c + j] - mu) * r; xh[i * c + j] = h; od[i * c + j] = h * gm.d[j] + bt.d[j]; }
    }
    if (REC) o.back = () => {
      const g = o.g, gx = gr(X), gg = gr(gm), gb = gr(bt), dx = new Float32Array(c);
      for (let i = 0; i < n; i++) {
        let m1 = 0, m2 = 0;
        for (let j = 0; j < c; j++) {
          const gv = g[i * c + j], h = xh[i * c + j];
          gg[j] += gv * h; gb[j] += gv;
          const d = gv * gm.d[j]; dx[j] = d; m1 += d; m2 += d * h;
        }
        m1 /= c; m2 /= c;
        for (let j = 0; j < c; j++) gx[i * c + j] += rs[i] * (dx[j] - m1 - xh[i * c + j] * m2);
      }
    };
    return o;
  }

  const S2P = Math.sqrt(2 / Math.PI);
  function gelu(X) {
    const o = out(X.r, X.c), x = X.d, od = o.d;
    for (let i = 0; i < x.length; i++) { const v = x[i]; od[i] = 0.5 * v * (1 + Math.tanh(S2P * (v + 0.044715 * v * v * v))); }
    if (REC) o.back = () => {
      const g = o.g, gx = gr(X);
      for (let i = 0; i < x.length; i++) {
        const v = x[i], t = Math.tanh(S2P * (v + 0.044715 * v * v * v));
        gx[i] += g[i] * (0.5 * (1 + t) + 0.5 * v * (1 - t * t) * S2P * (1 + 3 * 0.044715 * v * v));
      }
    };
    return o;
  }

  function cols(X, start, w) {
    const n = X.r, c = X.c, o = out(n, w), x = X.d, od = o.d;
    for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) od[i * w + j] = x[i * c + start + j];
    if (REC) o.back = () => { const g = o.g, gx = gr(X); for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) gx[i * c + start + j] += g[i * w + j]; };
    return o;
  }

  function concat(list) {
    const n = list[0].r, w = list[0].c, c = w * list.length, o = out(n, c), od = o.d;
    list.forEach((X, h) => { for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) od[i * c + h * w + j] = X.d[i * w + j]; });
    if (REC) o.back = () => {
      const g = o.g;
      list.forEach((X, h) => { const gx = gr(X); for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) gx[i * w + j] += g[i * c + h * w + j]; });
    };
    return o;
  }

  // Causal softmax over attention scores: position i may only look at j <= i.
  function causalSoftmax(S, scale) {
    const n = S.r, m = S.c, o = out(n, m), s = S.d, p = o.d;
    for (let i = 0; i < n; i++) {
      let mx = -Infinity; for (let j = 0; j <= i; j++) mx = Math.max(mx, s[i * m + j] * scale);
      let z = 0; for (let j = 0; j <= i; j++) { const e = Math.exp(s[i * m + j] * scale - mx); p[i * m + j] = e; z += e; }
      for (let j = 0; j <= i; j++) p[i * m + j] /= z;
    }
    if (REC) o.back = () => {
      const g = o.g, gs = gr(S);
      for (let i = 0; i < n; i++) {
        let dot = 0; for (let j = 0; j <= i; j++) dot += g[i * m + j] * p[i * m + j];
        for (let j = 0; j <= i; j++) gs[i * m + j] += scale * p[i * m + j] * (g[i * m + j] - dot);
      }
    };
    return o;
  }

  function crossEntropy(L, tg) {
    const n = L.r, V = L.c, l = L.d, P = new Float32Array(n * V), o = out(1, 1), pred = new Array(n);
    let loss = 0, correct = 0;
    for (let i = 0; i < n; i++) {
      let mx = -Infinity; for (let j = 0; j < V; j++) mx = Math.max(mx, l[i * V + j]);
      let z = 0; for (let j = 0; j < V; j++) { const e = Math.exp(l[i * V + j] - mx); P[i * V + j] = e; z += e; }
      let best = 0;
      for (let j = 0; j < V; j++) { P[i * V + j] /= z; if (P[i * V + j] > P[i * V + best]) best = j; }
      loss -= Math.log(P[i * V + tg[i]] + 1e-9);
      pred[i] = best; if (best === tg[i]) correct++;
    }
    o.d[0] = loss / n; o.correct = correct; o.pred = pred;
    if (REC) o.back = () => {
      const s = o.g[0] / n, gl = gr(L);
      for (let i = 0; i < n; i++) for (let j = 0; j < V; j++) gl[i * V + j] += s * (P[i * V + j] - (j === tg[i] ? 1 : 0));
    };
    return o;
  }

  function backward(loss, seed) {
    loss.g = new Float32Array([seed]);
    for (let i = TAPE.length - 1; i >= 0; i--) { const t = TAPE[i]; if (t.back && t.g) t.back(); }
    TAPE = [];
  }

  // ---------- helpers ----------
  let seed = 1234567;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const randn = () => { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

  // ---------- model ----------
  class GPT {
    constructor(cfg) {
      this.cfg = cfg;
      const { V, d, n, L, H } = cfg;
      this.params = [];
      const P = (name, group, r, c, init) => {
        const t = new T(r, c); t.name = name; t.group = group; t.vec = r === 1;
        for (let i = 0; i < t.d.length; i++) t.d[i] = typeof init === 'number' ? init * randn() : init();
        t.m = new Float32Array(t.d.length); t.v = new Float32Array(t.d.length);
        this.params.push(t); return t;
      };
      const one = () => 1, zero = () => 0, res = 1 / Math.sqrt(2 * L);
      this.wte = P('token embeddings', 'Embeddings', V, d, 0.3);
      this.wpe = P('position embeddings', 'Embeddings', n, d, 0.1);
      this.blocks = [];
      for (let l = 0; l < L; l++) {
        const tag = `block ${l + 1}`;
        this.blocks.push({
          ln1g: P(`${tag} · norm 1 gain`, tag, 1, d, one), ln1b: P(`${tag} · norm 1 bias`, tag, 1, d, zero),
          wqkv: P(`${tag} · attention Q/K/V`, tag, d, 3 * d, 1 / Math.sqrt(d)), bqkv: P(`${tag} · Q/K/V bias`, tag, 1, 3 * d, zero),
          wo: P(`${tag} · attention output`, tag, d, d, res / Math.sqrt(d)), bo: P(`${tag} · output bias`, tag, 1, d, zero),
          ln2g: P(`${tag} · norm 2 gain`, tag, 1, d, one), ln2b: P(`${tag} · norm 2 bias`, tag, 1, d, zero),
          w1: P(`${tag} · MLP expand`, tag, d, 4 * d, 1 / Math.sqrt(d)), b1: P(`${tag} · MLP expand bias`, tag, 1, 4 * d, zero),
          w2: P(`${tag} · MLP squeeze`, tag, 4 * d, d, res / Math.sqrt(4 * d)), b2: P(`${tag} · MLP squeeze bias`, tag, 1, d, zero),
        });
      }
      this.lnfg = P('final norm gain', 'Output', 1, d, one);
      this.lnfb = P('final norm bias', 'Output', 1, d, zero);
      this.wlm = P('next-char head', 'Output', d, V, 1 / Math.sqrt(d));
      this.blm = P('next-char bias', 'Output', 1, V, zero);
      this.off = Array.from({ length: L }, () => new Array(H).fill(false));
      this.t = 0;
      this.size = this.params.reduce((s, p) => s + p.d.length, 0);
    }

    forward(idx, tg) {
      const { d, H } = this.cfg, hd = d / H, n = idx.length;
      const pos = Array.from({ length: n }, (_, i) => i);
      let x = add(embed(this.wte, idx), embed(this.wpe, pos));
      const attn = [];
      for (let l = 0; l < this.blocks.length; l++) {
        const B = this.blocks[l];
        const qkv = addBias(matmul(layernorm(x, B.ln1g, B.ln1b), B.wqkv), B.bqkv);
        const heads = [], att = [];
        for (let h = 0; h < H; h++) {
          if (this.off[l][h]) { heads.push(new T(n, hd)); att.push(null); continue; }
          const q = cols(qkv, h * hd, hd), k = cols(qkv, d + h * hd, hd), v = cols(qkv, 2 * d + h * hd, hd);
          const Pm = causalSoftmax(matmulT(q, k), 1 / Math.sqrt(hd));
          att.push(Pm); heads.push(matmul(Pm, v));
        }
        attn.push(att);
        x = add(x, addBias(matmul(concat(heads), B.wo), B.bo));
        const h1 = gelu(addBias(matmul(layernorm(x, B.ln2g, B.ln2b), B.w1), B.b1));
        x = add(x, addBias(matmul(h1, B.w2), B.b2));
      }
      const logits = addBias(matmul(layernorm(x, this.lnfg, this.lnfb), this.wlm), this.blm);
      return { logits, attn, loss: tg ? crossEntropy(logits, tg) : null };
    }

    windows(data, B, fixedSeed) {
      const n = Math.min(this.cfg.n, data.length - 1), out = [];
      let s = fixedSeed;
      const r = fixedSeed == null ? rand : () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let b = 0; b < B; b++) {
        const st = Math.floor(r() * (data.length - n));
        out.push([Array.from(data.subarray(st, st + n)), Array.from(data.subarray(st + 1, st + n + 1))]);
      }
      return out;
    }

    // forward + backward over a batch; leaves gradients on params
    grad(batch) {
      for (const p of this.params) (p.g ? p.g.fill(0) : gr(p));
      let tot = 0, correct = 0, total = 0;
      REC = true;
      try {
        for (const [idx, tg] of batch) {
          const r = this.forward(idx, tg);
          tot += r.loss.d[0]; correct += r.loss.correct; total += tg.length;
          if (!total || total === tg.length) this.lastSample = { idx, tg, pred: r.loss.pred };
          backward(r.loss, 1 / batch.length);
        }
      } finally { REC = false; TAPE = []; }
      this.lastAcc = correct / total; this.lastGuesses = total;
      let gn = 0; for (const p of this.params) for (let i = 0; i < p.g.length; i++) gn += p.g[i] * p.g[i];
      this.gnorm = Math.sqrt(gn);
      return tot / batch.length;
    }

    update(lr, opt) {
      const clip = this.gnorm > 1 ? 1 / this.gnorm : 1;
      this.t++;
      const b1 = 0.9, b2 = 0.99, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
      for (const p of this.params) {
        const d = p.d, g = p.g, m = p.m, v = p.v;
        if (opt === 'sgd') { for (let i = 0; i < d.length; i++) d[i] -= lr * g[i] * clip; continue; }
        if (opt === 'momentum') { for (let i = 0; i < d.length; i++) { m[i] = 0.9 * m[i] + g[i] * clip; d[i] -= lr * m[i]; } continue; }
        for (let i = 0; i < d.length; i++) {
          const gi = g[i] * clip;
          m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
          d[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      }
    }

    resetOptimizer() { this.t = 0; for (const p of this.params) { p.m.fill(0); p.v.fill(0); } }

    loss(batch) {
      let tot = 0; for (const [idx, tg] of batch) tot += this.forward(idx, tg).loss.d[0];
      return tot / batch.length;
    }

    // next-char distribution (and attention maps) for a context of token ids
    predict(ctx, temp = 1) {
      const idx = ctx.slice(-this.cfg.n);
      const r = this.forward(idx.length ? idx : [0]);
      const V = this.cfg.V, row = r.logits.d.subarray((r.logits.r - 1) * V, r.logits.r * V);
      const p = new Float32Array(V); let mx = -Infinity;
      for (let j = 0; j < V; j++) mx = Math.max(mx, row[j] / temp);
      let z = 0; for (let j = 0; j < V; j++) { p[j] = Math.exp(row[j] / temp - mx); z += p[j]; }
      for (let j = 0; j < V; j++) p[j] /= z;
      return { probs: p, attn: r.attn, used: idx };
    }

    sample(probs) { let r = rand(), j = 0; for (; j < probs.length - 1; j++) { r -= probs[j]; if (r <= 0) break; } return j; }

    flat() { const f = new Float32Array(this.size); let o = 0; for (const p of this.params) { f.set(p.d, o); o += p.d.length; } return f; }
    setFlat(f) { let o = 0; for (const p of this.params) { p.d.set(f.subarray(o, o + p.d.length)); o += p.d.length; } }
    flatGrad() { const f = new Float32Array(this.size); let o = 0; for (const p of this.params) { if (p.g) f.set(p.g, o); o += p.d.length; } return f; }

    // A random direction shaped like the weights ("filter-normalised", Li et al. 2018):
    // each matrix's direction is rescaled to that matrix's own size; vectors are left alone.
    direction() {
      const f = new Float32Array(this.size); let o = 0;
      for (const p of this.params) {
        if (!p.vec) {
          let pn = 0, rn = 0;
          for (let i = 0; i < p.d.length; i++) { const r = randn(); f[o + i] = r; rn += r * r; pn += p.d[i] * p.d[i]; }
          const s = Math.sqrt(pn / (rn || 1));
          for (let i = 0; i < p.d.length; i++) f[o + i] *= s;
        }
        o += p.d.length;
      }
      return f;
    }

    // 2-D PCA of the token embeddings, via power iteration
    embedPCA() {
      const { V, d } = this.cfg, w = this.wte.d, mu = new Float32Array(d);
      for (let i = 0; i < V; i++) for (let j = 0; j < d; j++) mu[j] += w[i * d + j] / V;
      const X = new Float32Array(V * d);
      for (let i = 0; i < V; i++) for (let j = 0; j < d; j++) X[i * d + j] = w[i * d + j] - mu[j];
      const C = new Float32Array(d * d);
      for (let i = 0; i < V; i++) for (let a = 0; a < d; a++) { const xa = X[i * d + a]; for (let b = 0; b < d; b++) C[a * d + b] += xa * X[i * d + b]; }
      const comps = [];
      for (let c = 0; c < 2; c++) {
        let v = this['_pc' + c] || Float32Array.from({ length: d }, () => randn());
        for (let it = 0; it < 30; it++) {
          const nv = new Float32Array(d);
          for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += C[a * d + b] * v[b]; nv[a] = s; }
          for (const u of comps) { let dt = 0; for (let a = 0; a < d; a++) dt += nv[a] * u[a]; for (let a = 0; a < d; a++) nv[a] -= dt * u[a]; }
          let nn = 0; for (let a = 0; a < d; a++) nn += nv[a] * nv[a]; nn = Math.sqrt(nn) || 1;
          for (let a = 0; a < d; a++) nv[a] /= nn; v = nv;
        }
        // keep the sign stable from frame to frame so the map doesn't flip
        const prev = this['_pc' + c];
        if (prev) { let dt = 0; for (let a = 0; a < d; a++) dt += prev[a] * v[a]; if (dt < 0) for (let a = 0; a < d; a++) v[a] = -v[a]; }
        this['_pc' + c] = v; comps.push(v);
      }
      return Array.from({ length: V }, (_, i) => comps.map(u => { let s = 0; for (let a = 0; a < d; a++) s += X[i * d + a] * u[a]; return s; }));
    }
  }

  window.TinyGPT = { GPT, randn, reseed: s => { seed = s >>> 0; } };
})();
