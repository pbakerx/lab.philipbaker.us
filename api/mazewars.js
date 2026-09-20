// lab.philipbaker.us/api/mazewars — the small server side of /maze-wars
//
// The game itself has no server (players talk over a public MQTT broker). This exists for the
// things that must outlive a browser tab:
//
//   GET  ?op=board                       -> the top ten, public fields only
//   POST {op:"score", pid, name, ...}    -> record / improve a player's best visit. Whoever that
//                                           pushes out of the top ten is emailed, if they asked.
//   POST {op:"card",  pid, ...}          -> the player's card: full name, location, email, and
//                                           two consents (bumped / somebody-is-online)
//   POST {op:"hello", pid, name, ...}    -> "I just came in": always tells the owner; with
//                                           announce:true also tells every player who asked to
//                                           hear — at most once an hour, site-wide
//   POST {op:"forget", pid}              -> delete everything held for that player
//   POST {op:"request", text, ...}       -> the feature-request box
//   GET  ?op=unsub&id=&k=                -> the one-click link in every email: all notices off
//   GET  ?op=requests      (x-admin-key) -> read the box              } only if
//   DELETE ?id=<8 hex>     (x-admin-key) -> take a row off the board   } MAZEWARS_ADMIN_KEY is set
//
// Scores are reported by the browser and cannot be verified — the game is peer-to-peer and
// nobody is in charge. The checks below keep out accidents and lazy scripts, not a determined
// cheat; the admin DELETE is the remedy for that.

import { put, del } from "@vercel/blob";
import { originAllowed, clientIp, rateLimiter } from "../lib/guard.js";
import {
  SCORES, CARDS, BELLS, REQUESTS, BOARD_SIZE, KEEP, BELL_REST_MS, BELL_MAX, GAME, PID_RE, PH_RE, EMAIL_RE,
  seal, playerHash, unsubOk, clean, stamp, stampTime, encodeScore, decodeScore, better, ranked, publicRow,
  cardPath, decodeCard, newestCards, emailOf, listAll, mailReady, sendMail,
} from "../lib/mazewars.js";

const scoreLimited = rateLimiter({ windowMs: 60_000, max: 20 });
const helloLimited = rateLimiter({ windowMs: 600_000, max: 6 });
const requestLimited = rateLimiter({ windowMs: 600_000, max: 4 });
const PUT = { access: "public", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 31536000 };

const admin = (req) => !!process.env.MAZEWARS_ADMIN_KEY && req.headers["x-admin-key"] === process.env.MAZEWARS_ADMIN_KEY;
const display = (e) => e.full || e.name;
const page = (res, code, title, line) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  return res.status(code).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#fff;font:17px/1.5 ui-monospace,Menlo,monospace;text-align:center"><div style="padding:2em;max-width:32em"><h1 style="font-size:1.3em">${title}</h1><p>${line}</p><p><a href="${GAME}" style="color:#fff">Back to the maze</a></p></div>`); };

async function board() {
  const all = (await listAll(SCORES)).map(decodeScore).filter(Boolean);
  return { all, top: ranked(all) };
}
async function cardFor(ph) { return newestCards(await listAll(`${CARDS}${ph}.`)).get(ph) || null; }

export default async function handler(req, res) {
  if (!originAllowed(req)) return res.status(403).json({ error: "Not allowed from this origin." });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: "No Blob store is connected, so the scorekeeper is off." });
  const reading = req.method === "GET" || req.method === "DELETE";
  const op = String((reading ? req.query?.op : req.body?.op) || "");
  const b = req.body || {};

  try {
    // ── the board ────────────────────────────────────────────────────────────────────────
    if (req.method === "GET" && (op === "board" || op === "")) {
      const { top } = await board();
      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=30");
      return res.status(200).json({ top: top.slice(0, BOARD_SIZE).map(publicRow), players: top.length, email: mailReady() });
    }

    // ── one click in an email: every notice off ──────────────────────────────────────────
    if (req.method === "GET" && op === "unsub") {
      const ph = String(req.query?.id || "");
      if (!unsubOk(ph, String(req.query?.k || ""))) return page(res, 400, "That link is not right", "It may have been cut short by your mail program. Open the game, choose High Score Card from the File menu, and untick the boxes there.");
      const old = await listAll(`${CARDS}${ph}.`), card = newestCards(old).get(ph);
      if (card && (card.bump || card.online)) {
        let body = {}; try { body = await (await fetch(card.url)).json(); } catch { /* rewrite it bare */ }
        await put(cardPath(ph, { bump: false, online: false }), JSON.stringify({ ...body, v: 1, bump: false, online: false, when: new Date().toISOString() }), PUT);
        await del(old.map((o) => o.pathname));
      }
      return page(res, 200, "Done", "Maze Wars+ will not email you again. Your high score stays on the board; the High Score Card in the game's File menu has a Remove Me button if you want that gone too.");
    }

    // ── a score ──────────────────────────────────────────────────────────────────────────
    if (req.method === "POST" && op === "score") {
      if (scoreLimited(clientIp(req))) return res.status(429).json({ error: "Too many scores in a minute." });
      if (!PID_RE.test(String(b.pid || ""))) return res.status(400).json({ error: "No player id." });
      const ph = playerHash(b.pid), kills = b.kills | 0, deaths = b.deaths | 0, secs = Number(b.secs) || 0;
      if (kills < 1 || kills > 999 || deaths < 0 || deaths > 999) return res.status(400).json({ error: "That is not a score." });
      if (secs < kills * 3 || secs > 86400) return res.status(400).json({ error: "Nobody shoots that fast." });

      const { all, top: before } = await board();
      const mine = all.filter((e) => e.ph === ph), myBest = ranked(mine)[0];
      const rec = { name: clean(b.name, 15) || "Nobody", full: clean(b.full, 40), loc: clean(b.loc, 40), kills, deaths, when: new Date().toISOString().slice(0, 10), ph, stamp: stamp(), uploadedAt: new Date() };
      const improved = !myBest || better(rec, myBest);
      if (improved) { await put(encodeScore(rec), JSON.stringify({ v: 1, kills, deaths, when: rec.when }), PUT); if (mine.length) await del(mine.map((e) => e.pathname)); }

      const after = ranked(all.filter((e) => e.ph !== ph).concat(improved ? [rec] : mine));
      const rank = after.findIndex((e) => e.ph === ph) + 1;
      let mailed = 0;
      if (improved && rank >= 1 && rank <= BOARD_SIZE && mailReady()) {
        // whoever was in the top ten a moment ago and is not now
        const out = before.slice(0, BOARD_SIZE).filter((e) => e.ph !== ph && !after.slice(0, BOARD_SIZE).some((a) => a.ph === e.ph));
        for (const e of out.slice(0, 3)) {
          try {
            const card = await cardFor(e.ph); if (!card || !card.bump) continue;
            const hit = await emailOf(card); if (!hit) continue;
            const r = await sendMail(hit.to, "You've been bumped off the Maze Wars+ high scores",
              `${display(e)},\n\n${display(rec)} just posted ${rec.kills}-${rec.deaths} and pushed your ${e.kills}-${e.deaths} out of the top ten.\n\nThe maze is open:\n${GAME}`, e.ph);
            if (r.sent) mailed++;
          } catch { /* a lost notice must never fail somebody else's score */ }
        }
      }
      if (after.length > KEEP) { const tail = after.slice(KEEP).filter((e) => e.ph !== ph && e.pathname); if (tail.length) await del(tail.map((e) => e.pathname)); }
      return res.status(improved ? 201 : 200).json({ ok: true, improved, rank, you: ph.slice(0, 8), top: after.slice(0, BOARD_SIZE).map(publicRow), players: after.length, email: mailReady(), mailed });
    }

    // ── the card ─────────────────────────────────────────────────────────────────────────
    if (req.method === "POST" && op === "card") {
      if (scoreLimited(clientIp(req))) return res.status(429).json({ error: "Easy." });
      if (!PID_RE.test(String(b.pid || ""))) return res.status(400).json({ error: "No player id." });
      const ph = playerHash(b.pid), email = clean(b.email, 254);
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address does not look right." });
      const card = { v: 1, name: clean(b.name, 15), full: clean(b.full, 40), loc: clean(b.loc, 40), e: email ? seal(email) : null, bump: !!(email && b.bump), online: !!(email && b.online), when: new Date().toISOString() };
      const old = await listAll(`${CARDS}${ph}.`);
      await put(cardPath(ph, card), JSON.stringify(card), PUT);
      if (old.length) await del(old.map((o) => o.pathname));
      // the board shows the card's name and location: re-issue this player's row if they changed
      const { all } = await board(), mine = ranked(all.filter((e) => e.ph === ph))[0];
      if (mine && (mine.full !== card.full || mine.loc !== card.loc || (card.name && mine.name !== card.name))) {
        await put(encodeScore({ ...mine, name: card.name || mine.name, full: card.full, loc: card.loc, stamp: stamp() }), JSON.stringify({ v: 1, kills: mine.kills, deaths: mine.deaths, when: mine.when }), PUT);
        await del(all.filter((e) => e.ph === ph).map((e) => e.pathname));
      }
      return res.status(200).json({ ok: true, email: mailReady(), bump: card.bump, online: card.online });
    }

    // ── "I just came in" ─────────────────────────────────────────────────────────────────
    if (req.method === "POST" && op === "hello") {
      if (helloLimited(clientIp(req))) return res.status(429).json({ error: "You have said hello a lot lately." });
      if (!PID_RE.test(String(b.pid || ""))) return res.status(400).json({ error: "No player id." });
      const ph = playerHash(b.pid), who = { name: clean(b.name, 15) || "Somebody", full: clean(b.full, 40), loc: clean(b.loc, 40) };
      const label = who.full ? `${who.full} ("${who.name}")` : who.name, where = who.loc ? ` from ${who.loc}` : "";
      const out = { ok: true, email: mailReady(), owner: false, announced: 0, rested: 0 };
      if (!mailReady()) return res.status(200).json(out);

      const myCard = await cardFor(ph), mine = myCard ? await emailOf(myCard) : null;
      if (process.env.MAZEWARS_OWNER_EMAIL) {
        const r = await sendMail(process.env.MAZEWARS_OWNER_EMAIL, `Maze Wars+: ${label} just came in`,
          `${label}${where} has just materialized in the maze.\n\nEmail on their card: ${mine ? mine.to : "none given"}\nAsked us to tell the other players: ${b.announce ? "yes" : "no"}\nWhen: ${new Date().toISOString()}\n\n${GAME}`);
        out.owner = r.sent;
      }
      if (b.announce) {
        const bells = await listAll(BELLS), last = Math.max(0, ...bells.map((x) => stampTime(x.pathname.slice(BELLS.length).split(".")[0])));
        const rest = last + BELL_REST_MS - Date.now();
        if (rest > 0) out.rested = Math.ceil(rest / 60000);        // somebody rang it recently: minutes until it may ring again
        else {
          await put(`${BELLS}${stamp()}.json`, JSON.stringify({ v: 1, by: ph.slice(0, 8), when: new Date().toISOString() }), PUT);
          if (bells.length > 20) await del(bells.slice(0, bells.length - 20).map((x) => x.pathname));
          const audience = [...newestCards(await listAll(CARDS)).values()].filter((c) => c.online && c.ph !== ph).sort((x, y) => y.at - x.at).slice(0, BELL_MAX);
          for (const c of audience) {
            const hit = await emailOf(c); if (!hit) continue;
            const r = await sendMail(hit.to, `${label} is in the Maze Wars+ maze right now`,
              `${label}${where} just came in and asked us to let the other players know.\n\nGo and find them:\n${GAME}`, c.ph);
            if (r.sent) out.announced++;
            await new Promise((done) => setTimeout(done, 600));      // Resend allows two sends a second
          }
        }
      }
      return res.status(200).json(out);
    }

    // ── remove me ────────────────────────────────────────────────────────────────────────
    if (req.method === "POST" && op === "forget") {
      if (scoreLimited(clientIp(req))) return res.status(429).json({ error: "Easy." });
      if (!PID_RE.test(String(b.pid || ""))) return res.status(400).json({ error: "No player id." });
      const ph = playerHash(b.pid), { all } = await board();
      const gone = all.filter((e) => e.ph === ph).map((e) => e.pathname).concat((await listAll(`${CARDS}${ph}.`)).map((o) => o.pathname));
      if (gone.length) await del(gone);
      return res.status(200).json({ ok: true, removed: gone.length });
    }

    // ── the feature-request box ──────────────────────────────────────────────────────────
    if (req.method === "POST" && op === "request") {
      if (requestLimited(clientIp(req))) return res.status(429).json({ error: "That is a lot of ideas. Try again in a few minutes." });
      const text = clean(b.text, 600);
      if (text.length < 4) return res.status(400).json({ error: "Say a little more." });
      const note = { v: 1, text, name: clean(b.name, 40), contact: clean(b.contact, 120), when: new Date().toISOString() };
      await put(`${REQUESTS}${stamp()}.json`, JSON.stringify(note), PUT);
      if (process.env.MAZEWARS_OWNER_EMAIL) await sendMail(process.env.MAZEWARS_OWNER_EMAIL, "Maze Wars+ feature request", `${note.text}\n\nFrom: ${note.name || "somebody"}${note.contact ? "  <" + note.contact + ">" : ""}\n${note.when}`);
      return res.status(201).json({ ok: true });
    }
    if (req.method === "GET" && op === "requests") {
      if (!admin(req)) return res.status(404).json({ error: "Not found." });
      const blobs = (await listAll(REQUESTS)).sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt)).slice(0, 100);
      const items = []; for (const x of blobs) { try { items.push(await (await fetch(x.url)).json()); } catch { /* skip a bad one */ } }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ items, total: blobs.length });
    }

    // ── moderation ───────────────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      if (!admin(req)) return res.status(404).json({ error: "Not found." });
      const id = String(req.query?.id || ""); if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).json({ error: "Pass ?id=<the row's 8-character id>." });
      const { all } = await board(), hit = all.filter((e) => e.ph.startsWith(id));
      if (hit.length) await del(hit.map((e) => e.pathname));
      return res.status(200).json({ ok: true, removed: hit.length });
    }

    return res.status(405).json({ error: "Unknown request." });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "The scorekeeper fell over." });
  }
}
