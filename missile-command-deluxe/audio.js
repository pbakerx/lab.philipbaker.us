// MISSILE COMMAND DELUXE · CITY RUN — audio.js
//
// The original's synth, carried over: LFSR noise and square waves, no recorded assets. So is its
// iPhone fix, unchanged in substance (see /missile-command's CLAUDE.md entry, "Sound on iPhone"):
// a page that only uses Web Audio gets iOS's AMBIENT session, which Silent Mode mutes while
// audio.state still reads "running". One looping, silent, UNMUTED <audio> element, played inside
// the same tap that unlocks the context, moves the page to the PLAYBACK session. That session is
// not mixable — it pauses the player's own music — so only a tap that ASKS for the game's sound
// may take it (`ask`), and pause, a hidden page and SOUND OFF hand it back. ?ios=1 exercises the
// path on a desktop browser.
const IOS = new URLSearchParams(location.search).has('ios') || /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
let audio = null, master = null, noise = null, keep = null, voices = 0, soundOn = true, isPaused = () => false;

export function init(opts) { soundOn = opts.sound; isPaused = opts.isPaused; }
export const state = () => (audio ? audio.state : 'none');

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
      audio = new AC(); master = audio.createGain(); master.gain.value = soundOn ? .32 : 0;
      const limiter = audio.createDynamicsCompressor(); limiter.threshold.value = -16; limiter.ratio.value = 8; master.connect(limiter); limiter.connect(audio.destination);
      noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
      const d = noise.getChannelData(0); let lfsr = 0x1ffff, v = 0;
      for (let i = 0; i < d.length; i++) { if (i % 4 === 0) { lfsr = (lfsr >> 1) | (((lfsr ^ (lfsr >> 3)) & 1) << 16); v = (lfsr & 1) ? 1 : -1; } d[i] = v; } }
    // play() before resume(), both synchronous inside the tap. Without `ask`, only follow a context that is already running.
    if (ask || audio.state === 'running') keepAlive(true);
    if (audio.state !== 'running') audio.resume().then(() => keepAlive(true)).catch(() => {});
  } catch (e) { audio = null; }
}
export function hush() { keepAlive(false); if (audio?.state === 'running') audio.suspend().catch(() => {}); }
export function setSound(on) { soundOn = on; if (master) master.gain.setTargetAtTime(on ? .32 : 0, audio.currentTime, .02); keepAlive(on); }

// kind → what to play. Tones sweep f0→f1; noises sweep a low-pass from lp0→lp1.
const TONE = { shot: [920, 110, .16, .14], dry: [170, 85, .10, .14], bonus: [440, 1760, .48, .14], lock: [1500, 1500, .035, .05], warn: [620, 620, .09, .10] };
const NOISE = { blast: [.8, 2800, 65, .43, .38], impact: [.43, 950, 65, .85, .40], collapse: [.26, 700, 40, 2.1, .42], jam: [1.6, 5200, 900, .5, .22] };
const SEQ = { pickup: [[660, 0], [990, .07], [1320, .14]], level: [[392, 0], [523, .12], [659, .24], [784, .36]], rebuilt: [[330, 0], [494, .1], [659, .2]], over: [[392, 0], [330, .18], [262, .36], [196, .54]] };

export function voice(kind) {
  if (!soundOn || !audio || audio.state !== 'running') return;
  if (SEQ[kind]) { for (const [f, at] of SEQ[kind]) tone(f, f * (kind === 'over' ? .97 : 1.02), .16, .11, at); return; }
  if (TONE[kind]) { const [f0, f1, dur, gain] = TONE[kind]; tone(f0, f1, dur, gain, 0); return; }
  if (NOISE[kind]) { const [rate, lp0, lp1, dur, gain] = NOISE[kind]; hiss(rate, lp0, lp1, dur, gain); }
}
function envelope(g, t, dur, gain) { g.gain.setValueAtTime(.001, t); g.gain.linearRampToValueAtTime(gain, t + .006); g.gain.exponentialRampToValueAtTime(.001, t + dur); }
function done(src, ...nodes) { voices++; src.onended = () => { voices--; src.disconnect(); nodes.forEach(n => n.disconnect()); }; }
function tone(f0, f1, dur, gain, at) {
  if (voices > 20) return; const t = audio.currentTime + at, g = audio.createGain(), o = audio.createOscillator(); o.type = 'square'; g.connect(master); o.connect(g);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); envelope(g, t, dur, gain); done(o, g); o.start(t); o.stop(t + dur + .01);
}
function hiss(rate, lp0, lp1, dur, gain) {
  if (voices > 20) return; const t = audio.currentTime, g = audio.createGain(), s = audio.createBufferSource(), f = audio.createBiquadFilter(); s.buffer = noise; s.loop = true; s.playbackRate.value = rate;
  f.type = 'lowpass'; f.frequency.setValueAtTime(lp0, t); f.frequency.exponentialRampToValueAtTime(lp1, t + dur); s.connect(f); f.connect(g); g.connect(master);
  envelope(g, t, dur, gain); done(s, g, f); s.start(t, Math.random()); s.stop(t + dur + .01);
}
