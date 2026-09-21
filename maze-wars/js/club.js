/* The clubhouse: everything about Maze Wars+ that outlives a browser tab — the How to Play page,
   the high score board, the player's card, the feature-request box, and "I just came in".
   It talks to /api/mazewars; the game itself still has no server. Nothing here is needed to
   play: if the scorekeeper does not answer, the maze works exactly as before. */
window.MW = window.MW || {};
(function () {
  const G = MW.gfx, ui = MW.ui, CHI = MW.FONT.chi, GEN = MW.FONT.gen, A = MW.audio;
  const KEY = 'mazewars.club.v1', API = '/api/mazewars', EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
  const prof = Object.assign({ pid: '', full: '', loc: '', email: '', bump: true, online: false, announce: false, skipHow: false, asked: false, saved: false, helloAt: 0 },
    (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prof)); } catch (e) { } };
  const newPid = () => { let s = ''; const a = new Uint8Array(24); try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 24; i++) a[i] = Math.random() * 256; } for (const v of a) s += (v % 36).toString(36); return s; };
  if (!/^[a-z0-9]{16,40}$/.test(prof.pid)) { prof.pid = newPid(); save(); }

  const board = { state: 'idle', top: [], players: 0, email: false, you: '', rank: 0 };
  let t0 = 0, sendT = 0, sent = { k: 0, d: 0 }, pendingCard = false, saidHello = false;
  const me = () => MW.game.me, say = (s) => MW.game.notice(s);

  async function call(body, query) {
    const r = await fetch(API + (query || ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = null; try { j = await r.json(); } catch (e) { } if (!r.ok) throw new Error((j && j.error) || 'The scorekeeper did not answer.'); return j;
  }
  const take = (j) => { board.state = 'ok'; board.top = Array.isArray(j.top) ? j.top.slice(0, 10) : []; board.players = j.players | 0; board.email = !!j.email; if (j.you) board.you = j.you; if (j.rank !== undefined) board.rank = j.rank | 0; };
  const refresh = () => { board.state = board.state === 'ok' ? 'ok' : 'loading'; return call(null, '?op=board').then(take, () => { if (board.state !== 'ok') board.state = 'error'; }); };

  // ---------------------------------------------------------------- the visit log
  // Who came, and for how long: one row per visit, for Philip's morning digest (see lib/mazewars.js). "play" counts only seconds
  // with the window showing and a hand on the controls; "stay" runs from arriving to the last such second, so a tab left open all
  // night is not a twelve-hour visit. Reported when the page is hidden or closed — a beacon, since closing is one of the ways a
  // visit ends — and every two minutes in between, because a phone kills a tab without a word. A report that would say nothing
  // new is not sent, so an abandoned window goes quiet. No address, no fingerprint: the name they typed and what the game counted.
  const visit = { id: '', at: 0, tick: 0, play: 0, activeAt: 0, humans: 0, thumbs: 0, chat: 0, sentAt: 0, sentKey: '' };
  const refHost = (() => { try { const h = new URL(document.referrer).hostname.toLowerCase(); return h && h !== location.hostname ? h.replace(/^www\./, '') : ''; } catch (e) { return ''; } })();
  function report(leaving) { if (!visit.id) return; const m = me(), now = Date.now();
    const body = { op: 'visit', pid: prof.pid, vid: visit.id, at: visit.at, stay: Math.round(((visit.activeAt || visit.at) - visit.at) / 1000), play: Math.round(visit.play / 1000), name: m.name, full: prof.full, loc: prof.loc, kills: m.kills, deaths: m.deaths,
      humans: visit.humans, thumbs: visit.thumbs, chat: visit.chat, touch: ui.touch ? 1 : 0, ref: refHost, line: MW.game.cfg.zone ? 1 : 0 };
    const key = [body.play, body.kills, body.deaths, body.chat, body.humans, body.thumbs, body.name].join('|'); if (key === visit.sentKey) return; visit.sentKey = key; visit.sentAt = now;
    const json = JSON.stringify(body); try { if (leaving && navigator.sendBeacon && navigator.sendBeacon(API, new Blob([json], { type: 'application/json' }))) return; } catch (e) { }
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => { }); }
  function watch() { const now = Date.now(), dt = Math.min(2000, now - visit.tick); visit.tick = now; const g = MW.game;
    if (!document.hidden && g.x.idleMs() < 60000) { visit.play += dt; visit.activeAt = now; }
    let h = 0; for (const p of g.others.values()) if (!p.local && p.inMaze) h++; if (h > visit.humans) visit.humans = h; if (MW.thumbs && MW.thumbs.here) visit.thumbs = 1;
    if (now - visit.sentAt > 120000) report(false); }
  function arrive() { if (visit.id) return; visit.id = newPid().slice(0, 16); visit.at = visit.tick = visit.activeAt = visit.sentAt = Date.now(); setInterval(watch, 1000);
    addEventListener('pagehide', () => report(true)); document.addEventListener('visibilitychange', () => { if (document.hidden) report(true); }); }

  // A score goes in only when it could matter: the board has room, you would beat the last row, or you are already on it.
  function worthSending() { const m = me(); if (m.kills < 1 || (m.kills === sent.k && m.deaths === sent.d)) return false; if (board.state !== 'ok' || board.top.length < 10) return true;
    if (board.top.some(r => r.id === board.you)) return true; const last = board.top[board.top.length - 1]; return m.kills > last.kills || (m.kills === last.kills && m.deaths < last.deaths); }
  function submit() { const m = me(); if (!worthSending()) return; const k = m.kills, d = m.deaths; sent = { k, d };
    call({ op: 'score', pid: prof.pid, name: m.name, full: prof.full, loc: prof.loc, kills: k, deaths: d, secs: Math.round((performance.now() - t0) / 1000) }).then((j) => { const was = board.rank; take(j);
      if (j.improved && j.rank >= 1 && j.rank <= 10 && j.rank !== was) { say('You are number ' + j.rank + ' on the high score board.'); A.score(); if (!prof.asked && !prof.saved) pendingCard = true; } }, () => { }); }

  // ---------------------------------------------------------------- little drawing helpers
  const para = (text, x, y, w, pitch) => { const lines = G.wrap(GEN, text, w); lines.forEach((l, k) => G.text(GEN, l, x, y + k * (pitch || 12), 1)); return y + lines.length * (pitch || 12); };
  const keycap = (k, x, y) => { const w = Math.max(15, G.textW(CHI, k) + 8); G.rrect(x, y - 11, w, 15, 3, 1, 0); G.textC(CHI, k, x + w / 2, y, 1); return w; };

  const club = MW.club = {
    prof, board,
    // ---------------------------------------------------------------- hooks the game calls
    said() { visit.chat++; },
    entered() { arrive(); if (!t0) t0 = performance.now(); if (board.state === 'idle') refresh(); if (saidHello) return; saidHello = true;
      if (Date.now() - (prof.helloAt || 0) < 20 * 60000) return; prof.helloAt = Date.now(); save(); const m = me();
      call({ op: 'hello', pid: prof.pid, name: m.name, full: prof.full, loc: prof.loc, announce: !!prof.announce }).then((j) => { if (!prof.announce || !j.email) return;
        if (j.announced > 0) say('The others have been told you are here: ' + j.announced + (j.announced === 1 ? ' email.' : ' emails.'));
        else if (j.rested > 0) say('The bell was rung a little while ago, and rests ' + j.rested + ' more minutes.'); else say('Nobody has asked to be told yet. You are the first.'); }, () => { }); },
    kill() { clearTimeout(sendT); sendT = setTimeout(submit, 2500); },
    died() { clearTimeout(sendT); sendT = setTimeout(submit, 1500); },
    afterDeath(next) { if (pendingCard) { pendingCard = false; prof.asked = true; save(); club.card(next, true); } else next(); },

    // ---------------------------------------------------------------- How to Play
    howTo(next) {
      const keys = [['F', 'forward', 'V', 'back up'], ['D', 'turn left', 'G', 'turn right'], ['J', 'step left', 'L', 'step right'], ['A', 'about-face', 'K', 'fire, or Space'], ['E', 'peek left', 'T', 'peek right']];
      ui.show({ x: 36, y: 34, w: 440, h: 286, escDefault: true, isHowTo: true, items: [
        { t: 'custom', x: 0, y: 0, w: 440, h: 250, draw: (x, y) => {
            G.text(CHI, 'Maze Wars+', x + 10, y + 14, 1); G.text(GEN, 'Macintosh, 1986. Rebuilt to play online.', x + 112, y + 14, 1); G.hline(x + 8, x + 431, y + 21, 1);
            let yy = para('You are loose in a maze with whoever else is online, and a robot. Find them before they find you. One hit and you are out, until you rematerialize somewhere else.', x + 10, y + 38, 204);
            if (ui.touch) { yy = para('Left thumb, the round pad: push up to walk, either side to turn, down to back up. Slide from one to the next without lifting. STEP side-steps: you move over and keep facing the same way.', x + 10, yy + 10, 204);
              para('Right thumb: FIRE, or tap the hall. The bent arrow is about-face, the envelope sends a message.', x + 10, yy + 8, 204); }
            else { yy += 8; keys.forEach((r, i) => { const ky = yy + 4 + i * 19; let w = keycap(r[0], x + 10, ky); G.text(GEN, r[1], x + 14 + w, ky, 1); w = keycap(r[2], x + 112, ky); G.text(GEN, r[3], x + 116 + w, ky, 1); });
              para('Arrow keys work too. Click the hall to fire. On a phone, use the pad under the screen.', x + 10, yy + 4 + 5 * 19, 204); }
            G.vline(x + 221, y + 30, y + 246, 1);
            let ry = para('Police boxes teleport you. The patterned squares on the map are lifts: there are four levels, and the column beside the map counts who is on each.', x + 232, y + 38, 200);
            ry = para(ui.touch ? 'Everyone on your level shows on the map. A message goes to everybody: tap the envelope, or the message box.' : 'Everyone on your level shows on the map. Return sends a message to everybody.', x + 232, ry + 8, 200);
            ry = para('File menu: invite a friend, the high scores, your card. Options menu: Phone opens a private line, for a game among friends.', x + 232, ry + 8, 200);
            para('Nobody about? Thumbs, the house AI, plays you, and talks. What you say to him is kept.', x + 232, ry + 8, 200); } },   // the email pitch that stood here lives on the card itself; this column has room for one or the other
        { t: 'check', x: 10, y: 260, label: 'Skip this page next time', on: () => prof.skipHow, set: () => { prof.skipHow = !prof.skipHow; save(); } },
        { t: 'button', x: 204, y: 259, w: 88, h: 20, label: 'High Scores', act: () => club.scores(() => club.howTo(next)) },
        { t: 'button', x: 298, y: 259, w: 66, h: 20, label: 'My Card', act: () => club.card(() => club.howTo(next)) },
        { t: 'button', x: 372, y: 259, w: 60, h: 20, label: 'Play', def: true, act: () => { ui.close(); if (next) next(); } }] });
    },

    // ---------------------------------------------------------------- High Scores
    scores(after) {
      refresh();
      ui.show({ x: 56, y: 44, w: 400, h: 254, escDefault: true, items: [
        { t: 'custom', x: 0, y: 0, w: 400, h: 220, draw: (x, y) => {
            G.text(CHI, 'High Scores', x + 10, y + 14, 1); G.textR(GEN, 'Most kills in one visit', x + 390, y + 14, 1); G.hline(x + 8, x + 391, y + 22, 1);
            if (board.state !== 'ok') { G.text(GEN, board.state === 'error' ? 'The scorekeeper did not answer. (The board lives on the live site.)' : 'Asking the scorekeeper…', x + 12, y + 46, 1); return; }
            if (!board.top.length) { G.text(GEN, 'Nobody yet. The first kill takes first place.', x + 12, y + 46, 1); return; }
            board.top.forEach((r, i) => { const ry = y + 40 + i * 18, mine = r.id === board.you; if (mine) G.fill(x + 6, ry - 11, 388, 16, 1); const c = mine ? 0 : 1;
              G.textR(GEN, String(i + 1), x + 24, ry, c); G.text(GEN, G.fit(GEN, MW.FONT.clean(r.full || r.name, 40), 158), x + 34, ry, c);
              G.text(GEN, G.fit(GEN, MW.FONT.clean(r.loc, 40), 104), x + 200, ry, c); G.text(GEN, MW.FONT.clean(r.when, 10).slice(5), x + 312, ry, c); G.textR(GEN, (r.kills | 0) + '-' + (r.deaths | 0), x + 388, ry, c); });
            G.text(GEN, "A robot's kills do not count." + (board.players > 10 ? '  ' + board.players + ' players have scored.' : ''), x + 12, y + 222, 1); } },
        { t: 'button', x: 232, y: 228, w: 78, h: 20, label: 'My Card', act: () => club.card(() => club.scores(after)) },
        { t: 'button', x: 322, y: 228, w: 70, h: 20, label: 'OK', def: true, act: () => { ui.close(); if (after) after(); } }] });
    },

    // ---------------------------------------------------------------- the card
    card(after, congrats) {
      let bump = prof.bump, online = prof.online; const done = () => { ui.close(); if (after) after(); };
      ui.show({ x: 56, y: 30, w: 400, h: 284, items: [
        { t: 'text', x: 10, y: 4, s: congrats ? 'You made the high scores!' : 'High Score Card' },
        { t: 'custom', x: 10, y: 24, w: 380, h: 14, draw: (x, y) => G.text(GEN, congrats ? 'Put a name to it, if you like. All of this is optional.' : 'All of this is optional.', x, y + 10, 1) },
        { t: 'text', x: 10, y: 46, s: 'Full name' }, { t: 'edit', x: 96, y: 46, w: 292, h: 16, max: 40, id: 'full', value: prof.full },
        { t: 'text', x: 10, y: 72, s: 'Location' }, { t: 'edit', x: 96, y: 72, w: 292, h: 16, max: 40, id: 'loc', value: prof.loc },
        { t: 'text', x: 10, y: 98, s: 'Email' }, { t: 'edit', x: 96, y: 98, w: 292, h: 16, max: 60, id: 'email', value: prof.email },
        { t: 'check', x: 94, y: 120, label: 'Tell me if I am bumped off the top ten', on: () => bump, set: () => { bump = !bump; } },
        { t: 'check', x: 94, y: 140, label: 'Tell me when another player comes in', on: () => online, set: () => { online = !online; } },
        { t: 'custom', x: 10, y: 166, w: 380, h: 80, draw: (x, y) => para('Your name and location go on the high score board, for anyone to see. Your email is never shown to other players: it is kept scrambled and used only for the notices you tick, each with a one-click way to stop. Philip, who runs this maze, is told who comes in to play.' + (board.state === 'ok' && !board.email ? ' (Email is not switched on yet; your address waits until it is.)' : ''), x, y + 10, 380) },
        { t: 'button', x: 10, y: 256, w: 92, h: 20, label: 'Remove Me', act: () => { call({ op: 'forget', pid: prof.pid }).then(() => say('Everything we held about you has been removed.'), () => say('The scorekeeper did not answer; nothing was removed.'));
            Object.assign(prof, { full: '', loc: '', email: '', bump: true, online: false, saved: false, pid: newPid() }); save(); board.you = ''; board.rank = 0; sent = { k: 0, d: 0 }; done(); } },
        { t: 'button', x: 236, y: 256, w: 70, h: 20, label: 'Cancel', cancel: true, act: done },
        { t: 'button', x: 320, y: 256, w: 70, h: 20, label: 'Save', def: true, act: () => { const email = ui.field('email').value.trim(); if (email && !EMAIL.test(email)) { A.beep(); ui.dialog.focus = ui.dialog.items.indexOf(ui.field('email')); ui.field('email').sel = true; ui.syncIME(); return; }
            Object.assign(prof, { full: ui.field('full').value.trim(), loc: ui.field('loc').value.trim(), email, bump, online, saved: true, asked: true }); save();
            call({ op: 'card', pid: prof.pid, name: me().name, full: prof.full, loc: prof.loc, email, bump, online }).then((j) => { board.email = !!j.email; say('Your card is saved.'); refresh(); }, (e) => say('Your card could not be saved: ' + e.message)); done(); } }] });
    },

    // ---------------------------------------------------------------- the feature-request box
    request() {
      ui.show({ x: 76, y: 52, w: 360, h: 224, items: [
        { t: 'text', x: 10, y: 4, s: 'What should Maze Wars+ do next?' },
        { t: 'edit', x: 12, y: 32, w: 336, h: 96, multi: true, max: 240, id: 'idea' },
        { t: 'text', x: 10, y: 140, s: 'Reply to' }, { t: 'edit', x: 84, y: 140, w: 264, h: 16, max: 60, id: 'contact', value: prof.email },
        { t: 'custom', x: 84, y: 160, w: 264, h: 26, draw: (x, y) => { G.text(GEN, 'Optional. Only Philip sees it.', x, y + 9, 1); G.text(GEN, 'Your idea and game name go on a list all can read.', x - 72, y + 23, 1); } },
        { t: 'button', x: 12, y: 196, w: 96, h: 20, label: 'See the List', act: () => { ui.close(); club.ideas(); } },
        { t: 'button', x: 196, y: 196, w: 70, h: 20, label: 'Cancel', cancel: true, act: () => ui.close() },
        { t: 'button', x: 280, y: 196, w: 70, h: 20, label: 'Send', def: true, act: () => { const text = ui.field('idea').value.trim(), contact = ui.field('contact').value.trim(); if (text.length < 4) { A.beep(); return; } ui.close();
            call({ op: 'request', text, name: me().name, full: prof.full, contact }).then(() => club.ideas({ text, name: me().name, when: new Date().toISOString().slice(0, 10) }), (e) => ui.alert('That did not get through.\r' + e.message)); } }] });
    },

    // ---------------------------------------------------------------- everybody's ideas
    // Philip: "Can we make it so that folks can see all the feature requests?" The idea, the game name and the date — never the
    // contact. `mine` is the one just sent: it goes on top at once, whatever a cache in between still thinks the list is.
    ideas(mine) {
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], PER = 4; let list = null, failed = false, top = 0;
      const day = (w) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(w || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; };
      call(null, '?op=ideas').then((j) => { list = (j.items || []).filter((q) => !(mine && q.text === mine.text && q.name === mine.name)); if (mine) list.unshift(mine); }, () => { failed = true; list = mine ? [mine] : []; });
      ui.show({ x: 36, y: 30, w: 440, h: 294, escDefault: true, items: [
        { t: 'custom', x: 0, y: 0, w: 440, h: 256, draw: (x, y) => { G.text(CHI, mine ? 'Thank you. It is on the list.' : 'What people have asked for', x + 12, y + 14, 1); G.hline(x + 10, x + 429, y + 21, 1);
            if (!list) { G.text(GEN, 'Fetching the list...', x + 12, y + 40, 1); return; } if (!list.length) { G.text(GEN, failed ? 'The list did not answer. Try again in a moment.' : 'Nothing yet. Be the first.', x + 12, y + 40, 1); return; }
            G.textR(GEN, (top + 1) + ' to ' + Math.min(list.length, top + PER) + ' of ' + list.length, x + 428, y + 14, 1); let yy = y + 38;
            for (const q of list.slice(top, top + PER)) { const lines = G.wrap(GEN, MW.FONT.clean(q.text, 240), 416); const show = lines.slice(0, 3); if (lines.length > 3) show[2] = show[2].replace(/.{0,3}$/, '...');
              show.forEach((l) => { G.text(GEN, l, x + 12, yy, 1); yy += 12; }); G.textR(GEN, '- ' + MW.FONT.clean(q.name || 'somebody', 15) + (day(q.when) ? ', ' + day(q.when) : ''), x + 428, yy, 1); yy += 12 + 10; } } },
        { t: 'button', x: 12, y: 266, w: 66, h: 20, label: 'Newer', hidden: () => !list || top === 0, act: () => { top = Math.max(0, top - PER); } },
        { t: 'button', x: 86, y: 266, w: 66, h: 20, label: 'Older', hidden: () => !list || top + PER >= list.length, act: () => { top += PER; } },
        { t: 'button', x: 244, y: 266, w: 110, h: 20, label: 'Suggest One...', act: () => { ui.close(); club.request(); } },
        { t: 'button', x: 362, y: 266, w: 66, h: 20, label: 'OK', def: true, act: () => ui.close() }] });
    }
  };
})();
