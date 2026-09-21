/* AppleTalk, 2026. The original had no server: every Mac on the wire broadcast what it was
   doing and believed what it heard. This is the same shape over a public MQTT broker —
   publish/subscribe on one topic tree per "zone" — spoken by a small MQTT 3.1.1 client written
   here so the page needs no library. Everything that arrives is UNTRUSTED: game.js range-checks
   every field, text is reduced to glyphs we can draw, and nothing received is ever HTML. */
window.MW = window.MW || {};
(function () {
  // The FIRST broker is home: it is where everybody meets. The others exist only for while home is not answering, because a
  // player on a different broker is in a different, empty world — and "nobody is here" looks exactly like a quiet evening.
  // (Sep 20 2026: a window left in the background lost its line, was reconnected to the second broker — the old rule was
  // simply "try the next one" — and sat there alone, connected and cheerful, while a visitor came and went on the first.)
  const BROKERS = [
    { name: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'hivemq', url: 'wss://broker.hivemq.com:8884/mqtt' }
  ];
  const ROOT = 'pbmazewars/1/';
  const HOME_TRIES = 3;          // goes at home before a backup is tried at all
  const HOME_EVERY = 45000;      // on a backup: how often home is quietly asked whether it is back
  const PING_EVERY = 20000;
  const NOW = -1e12;              // "do it at the next tick": performance.now() counts from page load, so 0 is NOT long ago on a young page
  const KEEPALIVE = 120;         // seconds. The broker hangs up after 1.5x this without a packet; a hidden tab's timers can fall to one a MINUTE
  // A private line's name is whatever the player typed — often, it turns out, a real phone number — and a
  // topic on a public broker is readable by anyone. So only a scramble of it goes on the wire.
  const scramble = (s) => { let a = 0xdeadbeef ^ s.length, b = 0x41c6ce57 ^ s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (b >>> 0).toString(36) + (a >>> 0).toString(36); };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const str = (s) => { const b = enc.encode(s); const o = new Uint8Array(b.length + 2); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
  const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const packet = (type, body) => { const len = []; let n = body.length; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0); return cat(new Uint8Array([type]), new Uint8Array(len), body); };
  // CONNECT: clean session, and (for the real line, not the probe) a last will — the broker says "bye" for us if we vanish
  const hello = (cid, will) => packet(0x10, cat(str('MQTT'), new Uint8Array([4, will ? 0x06 : 0x02, KEEPALIVE >> 8, KEEPALIVE & 255]), str(cid), will ? cat(str(will[0]), str(will[1])) : new Uint8Array(0)));
  const quiet = (ws) => { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch (e) { } };

  const net = MW.net = {
    id: (() => { let s = ''; const a = new Uint8Array(6); (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); for (const v of a) s += (v % 36).toString(36); return s; })(),
    zone: 'lobby', tz: 'lobby', status: 'off', broker: '', backup: false, want: false, ws: null, pr: null, tries: 0, fails: 0, bi: 0, alt: 1, buf: new Uint8Array(0), lastRx: 0, pingAt: 0, pinged: false, probeAt: 0, retryT: 0,
    onState: null, onEvent: null, onStatus: null,
    setStatus(s) { if (net.status !== s) { net.status = s; if (net.onStatus) net.onStatus(s); } },
    cleanZone(z) { z = String(z || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); return z || 'lobby'; },
    connect(zone) { net.zone = net.cleanZone(zone); net.tz = net.zone === 'lobby' ? 'lobby' : 'p' + scramble('maze wars+ line ' + net.zone); net.want = true; net.tries = 0; net.fails = 0; net.bi = 0; net.open(); },
    disconnect() { net.want = false; clearTimeout(net.retryT); net.dropProbe(); if (net.ws) { try { net.event({ t: 'bye' }); net.ws.send(new Uint8Array([0xE0, 0])); net.ws.close(); } catch (e) { } net.ws = null; } net.setStatus('off'); },
    open() {
      clearTimeout(net.retryT); net.dropProbe(); if (net.ws) { quiet(net.ws); net.ws = null; }
      if (!net.want) return; const bi = net.bi % BROKERS.length, b = BROKERS[bi]; net.setStatus('connecting'); net.buf = new Uint8Array(0);
      let ws; try { ws = new WebSocket(b.url, 'mqtt'); } catch (e) { return net.fail(); } net.ws = ws; ws.binaryType = 'arraybuffer';
      const guard = setTimeout(() => { if (net.ws === ws && net.status !== 'on') { quiet(ws); net.ws = null; net.fail(); } }, 7000);   // hang up on it: left alive it can answer late, and the retry would then tear down a good line
      ws.onopen = () => { ws.send(hello('pbmw-' + net.id + '-' + Date.now().toString(36), [ROOT + net.tz + '/e', JSON.stringify({ t: 'bye', id: net.id })])); };
      ws.onmessage = (ev) => { if (net.ws !== ws) return; net.lastRx = performance.now(); net.buf = cat(net.buf, new Uint8Array(ev.data)); net.parse(ws, bi, guard); };
      ws.onerror = () => { }; ws.onclose = () => { clearTimeout(guard); if (net.ws === ws) { net.ws = null; net.fail(); } };
    },
    // Home is asked HOME_TRIES times before anywhere else is tried, and a backup that fails sends us straight back to asking home.
    fail() { if (!net.want) return; net.tries++; net.fails++;
      if (net.bi !== 0) { net.bi = 0; net.fails = 0; }
      else if (net.fails >= HOME_TRIES && BROKERS.length > 1) { net.bi = net.alt; net.alt = net.alt % (BROKERS.length - 1) + 1; net.fails = 0; }
      net.setStatus(net.tries > 1 ? 'error' : 'connecting'); net.retryT = setTimeout(net.open, Math.min(15000, 800 * net.tries)); },
    parse(ws, bi, guard) {
      for (;;) { const buf = net.buf; if (buf.length < 2) return; let mul = 1, len = 0, i = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; if (i > 5) { net.buf = new Uint8Array(0); return; } } while (d & 128);
        if (buf.length < i + len) return; const type = buf[0] >> 4, body = buf.subarray(i, i + len); net.buf = buf.slice(i + len);
        if (type === 2) { if (body[1] !== 0) { ws.close(); return; } clearTimeout(guard);
          ws.send(packet(0x82, cat(new Uint8Array([0, 1]), str(ROOT + net.tz + '/#'), new Uint8Array([0]))));
          net.broker = BROKERS[bi].name; net.backup = bi !== 0; net.tries = 0; net.fails = 0; net.pingAt = net.probeAt = performance.now(); net.pinged = false; net.setStatus('on'); }
        else if (type === 3) { if (body.length < 2) continue; const tl = (body[0] << 8) | body[1]; if (body.length < 2 + tl || len > 2048) continue;
          const topic = dec.decode(body.subarray(2, 2 + tl)); const qos = (buf[0] >> 1) & 3; const off = 2 + tl + (qos ? 2 : 0); let msg; try { msg = JSON.parse(dec.decode(body.subarray(off))); } catch (e) { continue; }
          if (!msg || typeof msg !== 'object') continue; const rest = topic.slice((ROOT + net.tz + '/').length);
          if (rest.startsWith('s/')) { const id = rest.slice(2); if (id !== net.id && /^[a-z0-9]{4,12}$/.test(id) && net.onState) net.onState(id, msg); }
          else if (rest === 'e') { if (msg.id === net.id || typeof msg.id !== 'string' || !/^[a-z0-9]{4,12}$/.test(msg.id)) continue;
            if (msg.t === 'home') { if (net.backup) net.probeAt = NOW; continue; }          // somebody here just found home answering: go and look now
            if (net.onEvent) net.onEvent(msg); } }
      }
    },
    // Called every frame by the game (and by a slow timer of our own). Two jobs, both written to survive a clock that ticks once
    // a minute: PING — and the line is dead only if NOTHING has arrived since the last ping was SENT, however long ago that was
    // (the old test, "nothing for 50 s", hung up on a perfectly good line as soon as a hidden tab's timers slowed past it);
    // and, on a backup, ask home whether it is back.
    tick() { const ws = net.ws; if (!ws || net.status !== 'on') return; const t = performance.now();
      if (t - net.pingAt >= PING_EVERY) {
        if (net.pinged && net.lastRx < net.pingAt) { quiet(ws); net.ws = null; net.fail(); return; }
        net.pingAt = t; net.pinged = true; try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) { } }
      if (net.backup && !net.pr && t - net.probeAt >= HOME_EVERY) { net.probeAt = t; net.probe(); } },
    // A second, throwaway connection to home while the backup line stays up. If home answers, say so to whoever else is stranded
    // here (they go and look at once, instead of at their own next probe), then move.
    probe() { if (net.pr || !net.want) return; let ws; try { ws = new WebSocket(BROKERS[0].url, 'mqtt'); } catch (e) { return; } net.pr = ws; ws.binaryType = 'arraybuffer';
      const over = (home) => { clearTimeout(g); if (net.pr !== ws) return; net.pr = null; if (home) { try { ws.send(new Uint8Array([0xE0, 0])); } catch (e) { } } quiet(ws);
        if (home && net.want && net.backup && net.status === 'on') { net.event({ t: 'home' }); net.bi = 0; net.fails = 0; net.tries = 0; net.open(); } };
      const g = setTimeout(() => over(false), 7000);
      ws.onopen = () => { try { ws.send(hello('pbmw-' + net.id + '-p' + Date.now().toString(36), null)); } catch (e) { over(false); } };
      ws.onmessage = (ev) => { const d = new Uint8Array(ev.data); over(d.length >= 4 && (d[0] >> 4) === 2 && d[3] === 0); };
      ws.onerror = () => { }; ws.onclose = () => over(false); },
    dropProbe() { const ws = net.pr; if (ws) { net.pr = null; quiet(ws); } },
    pub(topic, obj) { const ws = net.ws; if (!ws || net.status !== 'on' || ws.readyState !== 1) return false; try { ws.send(packet(0x30, cat(str(ROOT + net.tz + '/' + topic), enc.encode(JSON.stringify(obj))))); return true; } catch (e) { return false; } },
    state(obj) { return net.pub('s/' + net.id, obj); },
    event(obj) { obj.id = net.id; return net.pub('e', obj); }
  };
  setInterval(() => net.tick(), 5000);
  addEventListener('pagehide', () => { if (net.status === 'on') net.event({ t: 'bye' }); });
})();
