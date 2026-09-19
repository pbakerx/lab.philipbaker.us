#!/usr/bin/env python3
"""Generate missile-command-deluxe/index.html from the original page: same HUD, controls, rotate gate, panel styles and
menu seating; new head metadata, a see-through scrim over the 3D world, the wave-intro overlay, a boot cover, the import
map and the module entry point."""
import re, sys
src, out = sys.argv[1], sys.argv[2]
h = open(src, encoding='utf-8').read(); n = 0
def sub(old, new, count=1):
    global h, n
    assert h.count(old) == count, (old[:70], h.count(old)); h = h.replace(old, new); n += 1
# the inline game script → import map + module
h = re.sub(r'<script>\n/\*\n MISSILE COMMAND.*?</script>\n', '@@SCRIPTS@@\n', h, count=1, flags=re.S); assert '@@SCRIPTS@@' in h
sub('@@SCRIPTS@@', '''<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js",
  "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js",
  "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.tsl.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
} }
</script>
<script type="module" src="/missile-command-deluxe/game.js" onerror="window.__mcdFail&&window.__mcdFail()"></script>
<script>
// The entry is ROOT-ABSOLUTE on purpose: Vercel serves this page at /missile-command-deluxe AND /missile-command-deluxe/, and
// from the first a relative ./game.js resolves to /game.js — a 404 and a dead loading screen.
// A module that cannot parse (three.js r184+ needs Safari 16.4) or cannot load fails SILENTLY. If the world has not
// reported in after a while, say so plainly and point at the version that needs nothing.
window.__mcdFail=function(){var l=document.getElementById('boot-line'),n=document.getElementById('boot-note');l.textContent='THE GAME COULD NOT LOAD';n.innerHTML='Check the connection and <a href="" onclick="location.reload();return false">reload</a> — or play the 2D original: <a href="/missile-command/">/missile-command</a>';};
setTimeout(function(){if(window.__mcdReady)return;var l=document.getElementById('boot-line'),n=document.getElementById('boot-note');if(!l||/CANNOT/.test(l.textContent))return;
 l.textContent='STILL LOADING…';n.innerHTML='If this never finishes, your browser may be too old for the Deluxe world. The same game, drawn in 2D, plays anywhere: <a href="/missile-command/">/missile-command</a>';},9000);
</script>''')
# head
sub('<meta name="description" content="Defend six cities with thirty missiles. A one-file tribute to the 1980 missile-defense arcade game — mouse and keys on a desktop, or tap the sky on a phone held sideways.">',
    '<meta name="description" content="Missile Command Deluxe: the 1980 arcade classic rebuilt in a living 3D world — real fire, smoke and shockwaves in three.js. Same game, same controls: mouse and keys on a desktop, thumbs on a phone held sideways.">')
sub('<title>Missile Command — a one-file arcade tribute · lab.philipbaker.us</title>', '<title>Missile Command Deluxe — the arcade classic in a living 3D world · lab.philipbaker.us</title>')
h = h.replace('https://lab.philipbaker.us/missile-command/', 'https://lab.philipbaker.us/missile-command-deluxe/'); n += 1
sub('<meta property="og:title" content="Missile Command — six cities, thirty missiles">', '<meta property="og:title" content="Missile Command Deluxe — six cities, thirty missiles, real fire">')
sub('<meta name="twitter:title" content="Missile Command — six cities, thirty missiles">', '<meta name="twitter:title" content="Missile Command Deluxe — six cities, thirty missiles, real fire">')
h = h.replace('A one-file tribute to the 1980 arcade game. Mouse and keys on a desktop, thumbs on a phone.', 'The 1980 arcade game rebuilt in three.js: a night world lit by its own explosions. Mouse and keys on a desktop, thumbs on a phone.'); n += 1
sub('content="Missile Command: red missile trails fall toward six cities while defensive blasts bloom in a black sky."', 'content="Missile Command Deluxe: burning trails fall toward six lit cities while fireballs bloom over a night desert."')
# markup: the intro overlay and the boot cover
sub(' <div id="toast" role="status" hidden></div>', ' <div id="intro" aria-live="polite" hidden></div>\n  <div id="toast" role="status" hidden></div>')
sub('<div id="gate" hidden><section>', '<div id="boot"><section><p class="eyebrow">MISSILE COMMAND DELUXE</p><h2 id="boot-line">LOADING THE WORLD…</h2><p id="boot-note" class="muted"></p></section></div>\n<div id="gate" hidden><section>')
# css: the world shows through the panels; intro; boot; the DELUXE line
sub('.overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(0,0,0,.9);padding:14px 24px;touch-action:pan-y}',
    '.overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:radial-gradient(ellipse at center,rgba(0,4,8,.78),rgba(0,2,5,.5) 70%,rgba(0,2,5,.34));-webkit-backdrop-filter:blur(3px) saturate(.9);backdrop-filter:blur(3px) saturate(.9);padding:14px 24px;touch-action:pan-y}\n.panel{text-shadow:0 1px 2px #000,0 0 14px rgba(0,0,0,.85);background:rgba(0,3,6,.55);box-shadow:0 0 22px 16px rgba(0,3,6,.55)}')
sub('#toast{', '''.deluxe{display:inline-block;margin-top:.12em;font-size:.5em;letter-spacing:.42em;color:#ff7a3c;text-shadow:0 0 18px rgba(255,110,40,.75),0 0 2px #000}
#intro{position:absolute;left:0;right:0;top:30%;display:grid;justify-items:center;gap:8px;pointer-events:none;text-align:center;font-weight:900;text-shadow:0 0 3px #000,0 0 16px rgba(0,0,0,.9)}
#intro .w{font-size:clamp(22px,4.4vw,38px);letter-spacing:2px;color:var(--yellow)}#intro .m{font-size:clamp(14px,2.4vw,20px);color:var(--cyan)}#intro .d{margin-top:10px;font-size:clamp(13px,2vw,17px);color:#fff}#intro .k{font-size:clamp(10px,1.4vw,13px);color:var(--dim);font-weight:400}#intro .s{margin-top:10px;font-size:clamp(13px,2vw,17px);color:var(--red)}
#boot{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;text-align:center;background:#02060a;padding:24px;transition:opacity .6s}#boot.done{opacity:0;pointer-events:none}#boot a{color:var(--cyan)}
#toast{''')
sub('canvas{width:100%;height:100%;display:block;touch-action:none;', 'canvas{width:100%;height:100%;display:block;touch-action:none;outline:none;')
h = h.replace('missile-command-deluxe/img/og.png', 'missile-command-deluxe/img/og.jpg'); n += 1   # the card is a game frame: a JPEG a tenth the size of the PNG
open(out, 'w', encoding='utf-8').write(h); print('shell edits:', n)
