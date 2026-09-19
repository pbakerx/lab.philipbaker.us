/* Sound, synthesised: square-wave chirps and filtered noise, which is about what a compact
   Mac's one-voice speaker could manage. Nothing plays until a key or click unlocks it. */
window.MW = window.MW || {};
(function () {
  let ac = null, master = null, noiseBuf = null, keep = null;
  const A = MW.audio = {
    on: true,
    unlock() {
      if (!A.on) return;
      if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; ac = new C(); master = ac.createGain(); master.gain.value = 0.22; master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      if (ac.state === 'suspended') ac.resume();
      // iPhone: a page that only uses Web Audio is silenced by the ring switch; one looping, silent,
      // UNMUTED media element moves it to the playback session (same trick as /missile-command)
      if (!keep && /iP(hone|ad|od)/.test(navigator.userAgent)) { keep = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='); keep.loop = true; keep.play().catch(() => { }); }
    },
    set(on) { A.on = on; if (!on && ac) ac.suspend(); if (!on && keep) { keep.pause(); keep = null; } if (on) A.unlock(); },
    tone(freq, to, dur, type, vol, when) { if (!ac || !A.on) return; const t = ac.currentTime + (when || 0), o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'square'; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol || 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02); },
    noise(dur, f0, f1, vol, when) { if (!ac || !A.on) return; const t = ac.currentTime + (when || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol || 0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02); },
    // vol scales with distance so a far-off fight sounds far off
    shot(v) { v = v === undefined ? 1 : v; A.tone(1400, 180, 0.22, 'square', 0.35 * v); A.noise(0.12, 5000, 600, 0.4 * v); },
    boom(v) { v = v === undefined ? 1 : v; A.noise(0.7, 2400, 60, 1.0 * v); A.tone(120, 30, 0.5, 'sawtooth', 0.5 * v); },
    thud(v) { A.noise(0.18, 900, 80, 0.6 * (v === undefined ? 1 : v)); },
    step() { A.noise(0.03, 1800, 400, 0.12); },
    bump() { A.tone(90, 60, 0.08, 'square', 0.3); },
    tele() { for (let i = 0; i < 8; i++) A.tone(300 + i * 140, 600 + i * 160, 0.07, 'square', 0.25, i * 0.05); },
    lift() { A.tone(880, 0, 0.5, 'sine', 0.5); A.tone(660, 0, 0.7, 'sine', 0.5, 0.35); },
    die() { for (let i = 0; i < 6; i++) A.tone(520 - i * 70, 0, 0.12, 'square', 0.4, i * 0.1); },
    mail() { A.tone(1046, 0, 0.09, 'square', 0.3); A.tone(1318, 0, 0.14, 'square', 0.3, 0.1); },
    score() { A.tone(660, 0, 0.08, 'square', 0.3); A.tone(880, 0, 0.08, 'square', 0.3, 0.09); A.tone(1320, 0, 0.16, 'square', 0.3, 0.18); },
    beep() { A.tone(1000, 0, 0.12, 'square', 0.3); }
  };
})();
