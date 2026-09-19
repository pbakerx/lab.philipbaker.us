// MISSILE COMMAND DELUXE · CITY RUN — audio.js
//
// SAMPLED effects, generated with ElevenLabs' sound-generation model (Sep 19 2026; prompts and the
// generator live in CLAUDE.md) and shipped as small MP3s in sfx/. They are fetched at boot, decoded
// on the first gesture, then TRIMMED (leading silence off) and LEVEL-MATCHED (a tick and a collapse
// arrive 20 dB apart) once, at load — so the files can be re-rolled without touching this code.
// Every shot in the world is placed: panned by where it is on screen, quieter and duller with range.
// The old square-wave synth survives only as the fallback for a file that failed to load.
//
// THE iPHONE FIX is unchanged (see /missile-command's entry, "Sound on iPhone"): a page that only
// uses Web Audio gets iOS's AMBIENT session, which Silent Mode mutes while audio.state still reads
// "running". One looping, silent, UNMUTED <audio> element, played inside the same tap that unlocks
// the context, moves the page to the PLAYBACK session. That session is not mixable — it pauses the
// player's own music — so only a tap that ASKS for the game's sound may take it (`ask`), and pause,
// a hidden page and SOUND OFF hand it back. ?ios=1 exercises the path on a desktop browser.
const IOS = new URLSearchParams(location.search).has('ios') || /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const BASE = '/missile-command-deluxe/sfx/';
// name: [mix level, pitch jitter, most at once]
const SOUNDS = { launch: [.5, .08, 5], blast: [.8, .1, 5], impact: [.95, .08, 4], collapse: [1, .04, 2], planekill: [.9, .06, 3], flyby: [.7, .06, 2],
  pickup: [.55, .03, 3], jam: [.6, 0, 1], restore: [.5, 0, 1], dry: [.4, 0, 2], warn: [.42, 0, 1], level: [.7, 0, 1], saved: [.75, 0, 1], over: [.8, 0, 1], ui: [.34, .04, 3], bonus: [.6, 0, 1], engine: [.2, 0, 1] };
const raw = {}, bank = {}, playing = {};
let audio = null, master = null, noise = null, keep = null, voices = 0, soundOn = true, isPaused = () => false, decoding = false, hum = null;

export function init(opts) { soundOn = opts.sound; isPaused = opts.isPaused;
  for (const name of Object.keys(SOUNDS)) fetch(BASE + name + '.mp3').then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) { raw[name] = b; if (audio) decode(); } }).catch(() => {}); }
export const state = () => (audio ? audio.state : 'none');
export const loaded = () => Object.keys(bank);

function decode() {
  if (!audio || decoding) return; decoding = true;
  Promise.all(Object.keys(raw).filter(n => !bank[n]).map(name => audio.decodeAudioData(raw[name].slice(0)).then(buf => { bank[name] = prepare(name, buf); delete raw[name]; }).catch(() => { delete raw[name]; })))
    .then(() => { decoding = false; if (Object.keys(raw).some(n => !bank[n])) decode(); });
}
function prepare(name, buf) {
  const d = buf.getChannelData(0), n = d.length; let peak = 1e-4, sum = 0; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
  let start = 0; while (start < n && Math.abs(d[start]) < peak * .03) start++;                                     // leading silence off: a sound that starts late feels like lag
  const rms = Math.sqrt(sum / n) || 1e-4, norm = Math.min(.9 / peak, .16 / rms);                                   // level-match on loudness, but never past the peak
  if (name === 'engine') for (let ch = 0; ch < buf.numberOfChannels; ch++) { const c = buf.getChannelData(ch), x = Math.floor(buf.sampleRate * .4);   // fold the tail into the head: a loop with no seam, whatever the model gave us
    for (let i = 0; i < x; i++) { const t = i / x; c[i] = c[i] * Math.sin(t * Math.PI / 2) + c[n - x + i] * Math.cos(t * Math.PI / 2); } }
  return { buf, norm, offset: name === 'engine' ? 0 : Math.max(0, start / buf.sampleRate - .004), loopEnd: name === 'engine' ? (n - Math.floor(buf.sampleRate * .4)) / buf.sampleRate : 0 };
}

function silentWav(rate, secs = .5) { // 16-bit stereo zeros at the context's own rate, as a data: URI — nothing to fetch. Half a second: above 0.95 s WebKit offers it to the lock screen
  const ch = 2, len = Math.floor(rate * secs) * ch * 2, b = new ArrayBuffer(44 + len), v = new DataView(b), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len, true);
  const u = new Uint8Array(b); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(t);
}
export function keepAlive(on) {
  if (!IOS || !audio) return;
  try {
    if (!keep) { keep = document.createElement('audio'); keep.setAttribute('x-webkit-airplay', 'deny'); keep.disableRemotePlayback = true; keep.preload = 'auto'; keep.loop = true;
      keep.muted = false; keep.volume = 1; keep.src = silentWav(audio.sampleRate); keep.load(); } // unmuted and at volume: WebKit only counts an element that CAN produce audio. One element for life
    if (on && soundOn && !document.hidden && !isPaused()) { if (keep.paused) keep.play()?.catch(() => {}); } else if (!keep.paused) keep.pause();
  } catch (e) {}
}
export function unlock(ask) {
  try {
    if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      audio = new AC(); master = audio.createGain(); master.gain.value = soundOn ? .9 : 0;
      const limiter = audio.createDynamicsCompressor(); limiter.threshold.value = -14; limiter.knee.value = 10; limiter.ratio.value = 6; limiter.attack.value = .004; limiter.release.value = .22; master.connect(limiter); limiter.connect(audio.destination);
      noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      decode(); }
    // play() before resume(), both synchronous inside the tap. Without `ask`, only follow a context that is already running.
    if (ask || audio.state === 'running') keepAlive(true);
    if (audio.state !== 'running') audio.resume().then(() => keepAlive(true)).catch(() => {});
  } catch (e) { audio = null; }
}
export function hush() { keepAlive(false); engine(0); if (audio?.state === 'running') audio.suspend().catch(() => {}); }
export function setSound(on) { soundOn = on; if (master) master.gain.setTargetAtTime(on ? .9 : 0, audio.currentTime, .02); keepAlive(on); }

// voice('blast', { pan: -1…1, far: 0 near … 1 distant, gain, rate })
export function voice(kind, { pan = 0, far = 0, gain = 1, rate = 1 } = {}) {
  if (!soundOn || !audio || audio.state !== 'running' || !SOUNDS[kind]) return; const [level, jitter, most] = SOUNDS[kind], b = bank[kind];
  if (!b) return fallback(kind); if ((playing[kind] || 0) >= most || voices > 22) return;
  const t = audio.currentTime, s = audio.createBufferSource(), g = audio.createGain(); s.buffer = b.buf; s.playbackRate.value = rate * (1 + (Math.random() - .5) * 2 * jitter);
  g.gain.value = level * b.norm * gain * (1 - .72 * far); let tail = s;
  if (far > .05) { const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 16000 * Math.pow(.06, far); tail.connect(f); tail = f; }   // distance takes the top off
  if (audio.createStereoPanner && pan) { const p = audio.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); tail.connect(p); tail = p; }
  tail.connect(g); g.connect(master); playing[kind] = (playing[kind] || 0) + 1; voices++;
  s.onended = () => { playing[kind]--; voices--; try { g.disconnect(); } catch (e) {} }; s.start(t, b.offset);
}
// The craft's hum: one loop for life, its level and pitch following the flying.
export function engine(level, pitch = 1) {
  if (!audio || !bank.engine) return; const t = audio.currentTime;
  if (!hum) { if (level <= 0) return; const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter(); s.buffer = bank.engine.buf; s.loop = true; s.loopStart = 0; s.loopEnd = bank.engine.loopEnd;
    f.type = 'lowpass'; f.frequency.value = 2600; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start(t); hum = { s, g }; }
  hum.g.gain.setTargetAtTime(level * SOUNDS.engine[0] * bank.engine.norm, t, .25); hum.s.playbackRate.setTargetAtTime(pitch, t, .3);
}

// If a file never arrived, the important events still make a noise.
const TONE = { launch: [920, 110, .16, .12], dry: [170, 85, .1, .12], pickup: [660, 1320, .2, .1], bonus: [440, 1760, .45, .12], warn: [880, 880, .1, .1], restore: [520, 780, .16, .1], ui: [1400, 1400, .03, .04] };
const NOISE = { blast: [.8, 2800, 65, .45, .34], impact: [.43, 950, 65, .85, .38], collapse: [.26, 700, 40, 2.1, .4], planekill: [.6, 1800, 60, 1.2, .38], jam: [1.6, 5200, 900, .5, .2] };
function fallback(kind) {
  const t = audio.currentTime, g = audio.createGain(); g.connect(master); let src, dur, gain;
  if (TONE[kind]) { const [f0, f1, d, a] = TONE[kind]; dur = d; gain = a; src = audio.createOscillator(); src.type = 'triangle'; src.frequency.setValueAtTime(f0, t); src.frequency.exponentialRampToValueAtTime(f1, t + d); src.connect(g); }
  else if (NOISE[kind]) { const [rate, lp0, lp1, d, a] = NOISE[kind]; dur = d; gain = a; src = audio.createBufferSource(); src.buffer = noise; src.loop = true; src.playbackRate.value = rate;
    const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp0, t); f.frequency.exponentialRampToValueAtTime(lp1, t + d); src.connect(f); f.connect(g); } else return;
  g.gain.setValueAtTime(.001, t); g.gain.linearRampToValueAtTime(gain, t + .006); g.gain.exponentialRampToValueAtTime(.001, t + dur); src.onended = () => { try { g.disconnect(); } catch (e) {} }; src.start(t); src.stop(t + dur + .02);
}
