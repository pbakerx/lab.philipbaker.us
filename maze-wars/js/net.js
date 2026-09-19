/* AppleTalk, 2026. The original had no server: every Mac on the wire broadcast what it was
   doing and believed what it heard. This is the same shape over a public MQTT broker —
   publish/subscribe on one topic tree per "zone" — spoken by a small MQTT 3.1.1 client written
   here so the page needs no library. Everything that arrives is UNTRUSTED: game.js range-checks
   every field, text is reduced to glyphs we can draw, and nothing received is ever HTML. */
window.MW = window.MW || {};
(function () {
  const BROKERS = [
    { name: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'hivemq', url: 'wss://broker.hivemq.com:8884/mqtt' }
  ];
  const ROOT = 'pbmazewars/1/';
  // A private line's name is whatever the player typed — often, it turns out, a real phone number — and a
  // topic on a public broker is readable by anyone. So only a scramble of it goes on the wire.
  const scramble = (s) => { let a = 0xdeadbeef ^ s.length, b = 0x41c6ce57 ^ s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (b >>> 0).toString(36) + (a >>> 0).toString(36); };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const str = (s) => { const b = enc.encode(s); const o = new Uint8Array(b.length + 2); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
  const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const packet = (type, body) => { const len = []; let n = body.length; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0); return cat(new Uint8Array([type]), new Uint8Array(len), body); };

  const net = MW.net = {
    id: (() => { let s = ''; const a = new Uint8Array(6); (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); for (const v of a) s += (v % 36).toString(36); return s; })(),
    zone: 'lobby', tz: 'lobby', status: 'off', broker: '', want: false, ws: null, tries: 0, bi: 0, buf: new Uint8Array(0), lastRx: 0, pingT: 0, retryT: 0,
    onState: null, onEvent: null, onStatus: null,
    setStatus(s) { if (net.status !== s) { net.status = s; if (net.onStatus) net.onStatus(s); } },
    cleanZone(z) { z = String(z || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); return z || 'lobby'; },
    connect(zone) { net.zone = net.cleanZone(zone); net.tz = net.zone === 'lobby' ? 'lobby' : 'p' + scramble('maze wars+ line ' + net.zone); net.want = true; net.tries = 0; net.bi = 0; net.open(); },
    disconnect() { net.want = false; clearTimeout(net.retryT); clearInterval(net.pingT); if (net.ws) { try { net.event({ t: 'bye' }); net.ws.send(new Uint8Array([0xE0, 0])); net.ws.close(); } catch (e) { } net.ws = null; } net.setStatus('off'); },
    open() {
      clearTimeout(net.retryT); clearInterval(net.pingT); if (net.ws) { try { net.ws.onclose = null; net.ws.close(); } catch (e) { } net.ws = null; }
      if (!net.want) return; const b = BROKERS[net.bi % BROKERS.length]; net.setStatus('connecting'); net.buf = new Uint8Array(0);
      let ws; try { ws = new WebSocket(b.url, 'mqtt'); } catch (e) { return net.fail(); } net.ws = ws; ws.binaryType = 'arraybuffer';
      const guard = setTimeout(() => { if (net.ws === ws && net.status !== 'on') net.fail(); }, 7000);
      ws.onopen = () => { const will = JSON.stringify({ t: 'bye', id: net.id });
        ws.send(packet(0x10, cat(str('MQTT'), new Uint8Array([4, 0x06, 0, 30]), str('pbmw-' + net.id + '-' + Date.now().toString(36)), str(ROOT + net.tz + '/e'), str(will)))); };
      ws.onmessage = (ev) => { if (net.ws !== ws) return; net.lastRx = performance.now(); net.buf = cat(net.buf, new Uint8Array(ev.data)); net.parse(ws, b, guard); };
      ws.onerror = () => { }; ws.onclose = () => { clearTimeout(guard); if (net.ws === ws) { net.ws = null; net.fail(); } };
    },
    fail() { clearInterval(net.pingT); if (!net.want) return; net.tries++; net.bi++; net.setStatus(net.tries > 1 ? 'error' : 'connecting'); net.retryT = setTimeout(net.open, Math.min(15000, 800 * net.tries)); },
    parse(ws, b, guard) {
      for (;;) { const buf = net.buf; if (buf.length < 2) return; let mul = 1, len = 0, i = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; if (i > 5) { net.buf = new Uint8Array(0); return; } } while (d & 128);
        if (buf.length < i + len) return; const type = buf[0] >> 4, body = buf.subarray(i, i + len); net.buf = buf.slice(i + len);
        if (type === 2) { if (body[1] !== 0) { ws.close(); return; } clearTimeout(guard);
          ws.send(packet(0x82, cat(new Uint8Array([0, 1]), str(ROOT + net.tz + '/#'), new Uint8Array([0]))));
          net.broker = b.name; net.tries = 0; net.setStatus('on'); clearInterval(net.pingT);
          net.pingT = setInterval(() => { if (net.ws !== ws) return; if (performance.now() - net.lastRx > 50000) { try { ws.close(); } catch (e) { } return; } try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) { } }, 20000); }
        else if (type === 3) { if (body.length < 2) continue; const tl = (body[0] << 8) | body[1]; if (body.length < 2 + tl || len > 2048) continue;
          const topic = dec.decode(body.subarray(2, 2 + tl)); const qos = (buf[0] >> 1) & 3; const off = 2 + tl + (qos ? 2 : 0); let msg; try { msg = JSON.parse(dec.decode(body.subarray(off))); } catch (e) { continue; }
          if (!msg || typeof msg !== 'object') continue; const rest = topic.slice((ROOT + net.tz + '/').length);
          if (rest.startsWith('s/')) { const id = rest.slice(2); if (id !== net.id && /^[a-z0-9]{4,12}$/.test(id) && net.onState) net.onState(id, msg); }
          else if (rest === 'e') { if (msg.id !== net.id && typeof msg.id === 'string' && /^[a-z0-9]{4,12}$/.test(msg.id) && net.onEvent) net.onEvent(msg); } }
      }
    },
    pub(topic, obj) { const ws = net.ws; if (!ws || net.status !== 'on' || ws.readyState !== 1) return false; try { ws.send(packet(0x30, cat(str(ROOT + net.tz + '/' + topic), enc.encode(JSON.stringify(obj))))); return true; } catch (e) { return false; } },
    state(obj) { return net.pub('s/' + net.id, obj); },
    event(obj) { obj.id = net.id; return net.pub('e', obj); }
  };
  addEventListener('pagehide', () => { if (net.status === 'on') net.event({ t: 'bye' }); });
})();
