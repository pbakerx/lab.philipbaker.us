// Remote control for the Jones PR show (lab.philipbaker.us/jones).
//
// Self-contained on purpose: no dependencies, no storage, no environment needed.
// The deck in the browser listens on a message line (MQTT, a public broker); this
// function is the door an agent knocks on. It passes the command along, waits a
// moment for the deck to answer, and returns where the show now is.
//
//   GET  /api/jonesshow                        where the show is, and the slide list
//   GET  /api/jonesshow?cmd=next               next | prev | first | last
//   GET  /api/jonesshow?cmd=goto&to=custom     a slide number, id, title, or a name on a slide
//   POST /api/jonesshow  {"cmd":"goto","to":"12"}
//   POST /api/jonesshow?mcp                    the same five actions as MCP tools (JSON-RPC)
//
// If JONES_SHOW_KEY is set in the Vercel project, commands need ?key= or an
// x-show-key header. Reading the state never does.
import tls from 'node:tls';

const ROOM = 'jones-pr-7f3k9q2x';           // must match  remote.room  in jones/slides.js
const BASE = `pbshow/${ROOM}/`;
const BROKERS = ['broker.emqx.io', 'broker.hivemq.com'];
const CMDS = { next: 'next', forward: 'next', advance: 'next', prev: 'prev', back: 'prev', previous: 'prev',
  first: 'first', reset: 'first', start: 'first', last: 'last', end: 'last', goto: 'goto', go: 'goto', state: 'state', slides: 'state' };

const str = (s) => { const b = Buffer.from(String(s)); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
function packet(type, body) {
  let n = body.length; const len = [];
  do { const d = n % 128; n = Math.floor(n / 128); len.push(n ? d | 128 : d); } while (n);
  return Buffer.concat([Buffer.from([type, ...len]), body]);
}

// One short visit to the broker: read what the deck last said, optionally send a command, wait for its answer.
function visit(host, cmd, waitMs) {
  return new Promise((resolve, reject) => {
    const out = { state: null, outline: null, answered: false };
    const sentAt = Date.now();
    let buf = Buffer.alloc(0), sent = false, done = false, quiet;
    const sock = tls.connect({ host, port: 8883, servername: host });
    const finish = (err) => { if (done) return; done = true; clearTimeout(hard); clearTimeout(quiet); try { sock.end(packet(0xE0, Buffer.alloc(0))); } catch {} err ? reject(err) : resolve(out); };
    const hard = setTimeout(() => finish(out.state || !cmd ? null : null), waitMs + 2500);
    sock.setTimeout(4000, () => finish(new Error('broker timeout')));
    sock.on('error', finish);
    sock.on('secureConnect', () => sock.write(packet(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 2, 0, 30]), str('pbshow-api-' + Math.random().toString(36).slice(2, 10))]))));
    const send = () => {
      if (sent) return; sent = true;
      if (!cmd) return finish();
      sock.write(packet(0x30, Buffer.concat([str(BASE + 'cmd'), Buffer.from(JSON.stringify(cmd))])));
      quiet = setTimeout(finish, waitMs);
    };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        let i = 1, len = 0, mul = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, body = buf.subarray(i, i + len); buf = buf.subarray(i + len);
        if (type === 2) {
          sock.write(packet(0x82, Buffer.concat([Buffer.from([0, 1]), str(BASE + 'state'), Buffer.from([0]), str(BASE + 'outline'), Buffer.from([0])])));
        } else if (type === 9) {
          setTimeout(send, 350);             // retained messages arrive right behind the SUBACK
        } else if (type === 3) {
          const tl = (body[0] << 8) | body[1], topic = body.subarray(2, 2 + tl).toString();
          let msg; try { msg = JSON.parse(body.subarray(2 + tl).toString()); } catch { continue; }
          if (topic === BASE + 'outline') out.outline = msg;
          if (topic === BASE + 'state') {
            out.state = msg;
            if (sent && cmd && +msg.t >= sentAt - 50) { out.answered = true; finish(); }
          }
        }
      }
    });
  });
}

async function run(cmd, to) {
  const c = CMDS[String(cmd || 'state').toLowerCase()];
  if (!c) return { ok: false, error: `Unknown command "${cmd}". Use next, prev, goto, first, last or state.` };
  if (c === 'goto' && (to == null || String(to).trim() === '')) return { ok: false, error: 'goto needs "to": a slide number, id, title or name.' };
  const msg = c === 'state' ? null : { c, a: to == null ? undefined : String(to).slice(0, 120), id: Math.random().toString(36).slice(2), t: Date.now() };
  let r, lastErr;
  for (const host of BROKERS) { try { r = await visit(host, msg, 1600); break; } catch (e) { lastErr = e; } }
  if (!r) return { ok: false, error: 'Could not reach the message line: ' + (lastErr && lastErr.message) };
  const res = { ok: true, command: c, now: r.state, slides: r.outline };
  if (msg) {
    res.deckAnswered = r.answered;
    if (!r.answered) { res.ok = c !== 'goto'; res.note = 'No deck answered within 1.6 seconds. Is the show open in a browser? At the first or last slide, next and prev have nothing to do.'; }
    if (r.answered && r.state && r.state.miss) { res.ok = false; res.error = `No slide matches "${r.state.miss}".`; }
  }
  if (r.state) res.say = `Slide ${r.state.n} of ${r.state.of}: ${r.state.title}` + (r.state.phases > 1 ? ` (phase ${r.state.phase} of ${r.state.phases}: ${r.state.phaseName})` : '');
  return res;
}

const TOOLS = [
  { name: 'show_next', description: 'Advance the Jones PR show one step (next phase of this slide, or the next slide).', inputSchema: { type: 'object', properties: {} } },
  { name: 'show_prev', description: 'Go back one step in the Jones PR show.', inputSchema: { type: 'object', properties: {} } },
  { name: 'show_goto', description: 'Jump to a slide by number ("12"), id ("custom-everything"), title ("Voice Agents") or a name on a slide ("Lady on Main"). "12.2" is slide 12, phase 2.', inputSchema: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] } },
  { name: 'show_first', description: 'Return to the first slide.', inputSchema: { type: 'object', properties: {} } },
  { name: 'show_state', description: 'Where the show is now, plus the full slide list with ids, titles and phases.', inputSchema: { type: 'object', properties: {} } },
];

async function mcp(body, allowed) {
  const { id, method, params } = body || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ protocolVersion: (params && params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'jones-show', version: '1.0.0' } });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name, cmd = String(name || '').replace(/^show_/, '');
    if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
    const r = cmd !== 'state' && !allowed ? { ok: false, error: 'This show needs a key.' } : await run(cmd, params.arguments && params.arguments.to);
    return reply({ content: [{ type: 'text', text: JSON.stringify(cmd === 'state' ? r : { ok: r.ok, say: r.say, error: r.error, note: r.note, now: r.now }) }], isError: !r.ok });
  }
  if (id === undefined) return null;         // a notification
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-show-key, authorization, mcp-protocol-version, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const key = process.env.JONES_SHOW_KEY;
  const given = q.key || req.headers['x-show-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const allowed = !key || given === key;

  if ('mcp' in q) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST JSON-RPC here.' });
    const out = await mcp(body, allowed);
    return out ? res.status(200).json(out) : res.status(202).end();
  }
  const cmd = body.cmd || q.cmd || 'state', to = body.to != null ? body.to : q.to;
  const c = CMDS[String(cmd).toLowerCase()];
  if (c && c !== 'state' && !allowed) return res.status(401).json({ ok: false, error: 'This show needs a key (?key= or x-show-key).' });
  const r = await run(cmd, to);
  return res.status(r.ok ? 200 : (r.error && /Unknown|needs|matches/.test(r.error) ? 400 : 200)).json(r);
}
