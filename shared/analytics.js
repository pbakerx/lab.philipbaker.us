/* Lab event tracking — one file, swept into every page's <head> by scripts/head-meta.py.
 *
 * Why this exists: GA4's enhanced measurement reports **outbound** clicks only. A click on
 * an internal link is not collected at all, so without this file nothing records which
 * project on the lab someone actually opened — only that a page view happened somewhere
 * later, which you then have to infer from page_referrer. It also closes two blind spots
 * that were invisible in both directions: /second-brain and /mind-harvest are internal
 * hrefs that redirect to other sites, so no outbound click fires and the destination
 * carries none of our tags.
 *
 * Rules this file lives by, because it loads on pages that are games:
 *   - it never throws — every call is wrapped, and gtag may legitimately be absent
 *     (ad blocker, or the tag not yet installed by the sweep script);
 *   - it never calls preventDefault or stopPropagation, so no page's own click handling
 *     changes;
 *   - it draws nothing and adds no DOM, so a `?shot=1` screenshot hashes the same;
 *   - it defines exactly one global, `pbTrack`.
 *
 * Events sent (GA4 recommended names, so the standard reports pick them up):
 *   select_item     a click on any same-origin link. items[0].item_id is the destination
 *                   path, item_name the link's own text, item_list_name the page it was
 *                   clicked from — that last one is what answers "the case study got a
 *                   click from the home page".
 *   view_item_list  once on the home page, listing the projects on offer, so a click has
 *                   an impression to be a rate of.
 *   game_start      a real game actually beginning. Four games report it: the two Missile
 *                   Commands and Maze Wars+ call pbTrack from their own start handlers,
 *                   and the Vault's two players report it from here, off the query string.
 */
(function () {
  "use strict";

  function send(name, params) {
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    } catch (e) { /* analytics must never be the reason a page breaks */ }
  }

  // The games call this. Defined even if gtag never loads, so their call is always safe.
  window.pbTrack = send;

  function text(el) {
    var s = (el.textContent || "").replace(/\s+/g, " ").trim();
    return s.length > 100 ? s.slice(0, 100) : s;
  }

  var here = location.pathname;

  // ── a click on any same-origin link ──────────────────────────────────────────────────
  // Cross-origin links are deliberately skipped: GA4's enhanced measurement already sends
  // a `click` for those, and sending our own would double-count them.
  document.addEventListener("click", function (e) {
    try {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin) return;
      if (u.pathname === here && u.hash) return;            // an in-page jump is not a choice
      send("select_item", {
        item_list_name: here,
        items: [{ item_id: u.pathname + (u.search || ""), item_name: text(a) || u.pathname }]
      });
    } catch (err) { /* ignore */ }
  }, false);

  // ── the home page's list of projects, so clicks have a denominator ──────────────────
  if (here === "/" || here === "/index.html") {
    try {
      var items = [], seen = {}, links = document.querySelectorAll("main a[href]");
      for (var i = 0; i < links.length && items.length < 25; i++) {
        var u = new URL(links[i].href, location.href);
        var id = u.origin === location.origin ? u.pathname : u.href;
        if (seen[id]) continue;
        seen[id] = 1;
        items.push({ item_id: id, item_name: text(links[i]) || id, index: items.length });
      }
      if (items.length) send("view_item_list", { item_list_name: "lab home", items: items });
    } catch (err) { /* ignore */ }
  }

  // ── the Vault's players ─────────────────────────────────────────────────────────────
  // /vault/ itself is a catalogue; opening player.html?f=… IS the play. Reported from here
  // rather than from a click on the card, so it counts the game that actually loaded — and
  // so vault/index.html needs no edit at all.
  if (/\/vault\/(player|play)\.html$/.test(here)) {
    try {
      var q = new URLSearchParams(location.search), f = q.get("f");
      if (f) send("game_start", { game_id: f, game_name: q.get("t") || f, game_host: "vault" });
    } catch (err) { /* ignore */ }
  }
})();
