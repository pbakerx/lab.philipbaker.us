#!/usr/bin/env python3
"""Generate missile-command-deluxe/game.js from missile-command/index.html: the original's simulation, input, scoring,
UI and audio, byte for byte, with the 2D canvas renderer cut out and a handful of hooks for the three.js world put in.
Every edit is an asserted exact-string replacement, so if the original changes this fails loudly instead of drifting."""
import re, sys
src_path, out_path = sys.argv[1], sys.argv[2]
html = open(src_path, encoding='utf-8').read()
js = max(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S), key=len)
n = 0
def sub(old, new, count=1):
    global js, n
    assert js.count(old) == count, (old[:80], js.count(old))
    js = js.replace(old, new); n += 1
def cut(start, end):
    """remove from the line starting with `start` up to (not including) the line starting with `end`"""
    global js, n
    a = js.index('\n' + start) + 1; b = js.index('\n' + end) + 1
    assert a < b; js = js[:a] + js[b:]; n += 1

# 1 — module instead of IIFE
head_end = js.index("(() => {\n'use strict';\n") + len("(() => {\n'use strict';\n")
js = js[head_end:]
assert js.rstrip().endswith('})();'); js = js.rstrip()[:-len('})();')].rstrip() + '\n'
# 2 — no 2D context; the world is created at boot (it may need an async GPU init)
sub("const canvas=$('game'), ctx=canvas.getContext('2d'), menu=$('menu');", "const canvas=$('game'), menu=$('menu');\nlet R=null, lost=false; // R: the three.js world (world.js), everything that is drawn · lost: the browser took the GPU context back")
sub("const STORE='mc-mobile-scores-v1',", "const STORE='mc-deluxe-scores-v1',")   # its own leaderboard; the sound setting is shared with the original
# 3 — hooks
sub("function initGround(){\n S.cities=CITY_X.map((x,i)=>({x,y:GROUND,alive:true,id:i}));\n S.bases=BASE_X.map((x,i)=>({x,y:GROUND-17,alive:true,ammo:CONFIG.ammo,id:i}));\n}",
    "function initGround(){\n S.cities=CITY_X.map((x,i)=>({x,y:GROUND,alive:true,id:i}));\n S.bases=BASE_X.map((x,i)=>({x,y:GROUND-17,alive:true,ammo:CONFIG.ammo,id:i}));\n R?.onReset(S);\n}")
sub(" S.schedule.sort((a,b)=>a.at-b.at);voice('bonus');updateHUD();\n}", " S.schedule.sort((a,b)=>a.at-b.at);voice('bonus');updateHUD();paintIntro();R?.onWave(S);\n}")
sub(" S.shots.push({x:base.x,y:base.y,ox:base.x,oy:base.y,tx:x,ty:y,speed:base.id===1?CONFIG.centerSpeed:CONFIG.sideSpeed});\n",
    " const shot={x:base.x,y:base.y,ox:base.x,oy:base.y,tx:x,ty:y,speed:base.id===1?CONFIG.centerSpeed:CONFIG.sideSpeed};S.shots.push(shot);R?.onShot(shot,base);\n")
sub(" S.blasts.push({x,y,age:0,r:0,max,life:hostile?1.25:CONFIG.blastLife,hostile});voice(hostile?'impact':'blast');\n",
    " const blast={x,y,age:0,r:0,max,life:hostile?1.25:CONFIG.blastLife,hostile};S.blasts.push(blast);voice(hostile?'impact':'blast');R?.onBlast(blast);\n")
sub("function impact(e){\n const t=e.target;\n", "function impact(e){\n const t=e.target,was=t.alive;\n")
sub(" burst(e.x,e.y,38,true);updateHUD();\n}", " R?.onImpact(e,t,was&&!t.alive);burst(e.x,e.y,38,true);updateHUD();\n}")
sub(" if(e.dead)return;e.dead=true;\n addScore(", " if(e.dead)return;e.dead=true;R?.onKill(e);\n addScore(")
sub("   e.split=false;for(let i=0;i<(S.wave>10?3:2);i++)spawnMissile(e.x,e.y,'missile',false);\n", "   e.split=false;R?.onSplit(e);for(let i=0;i<(S.wave>10?3:2);i++)spawnMissile(e.x,e.y,'missile',false);\n")
sub("if(!city.alive&&S.reserve>0){city.alive=true;S.reserve--;restored++;}", "if(!city.alive&&S.reserve>0){city.alive=true;S.reserve--;restored++;R?.onCityRestored(city);}")
sub("function endGame(){\n S.mode='over';", "function endGame(){\n R?.onGameOver(S);S.mode='over';")
# a world must exist, and must still have its GPU, before anything starts or resumes
sub("if(blocked)return;S.mode='playing';unlockAudio(true);", "if(blocked||!R||lost)return;S.mode='playing';unlockAudio(true);")
sub("function resumeGame(){if(blocked||S.mode!=='paused')return;", "function resumeGame(){if(blocked||lost||S.mode!=='paused')return;")
sub("if(e.metaKey||e.ctrlKey||e.altKey||e.repeat||blocked||document.querySelector('#pb-menu .drawer.open'))return;", "if(e.metaKey||e.ctrlKey||e.altKey||e.repeat||blocked||lost||document.querySelector('#pb-menu .drawer.open'))return;")
# 4 — the title says what this is; every other word on a panel is the original's
sub("<h1>MISSILE<br>COMMAND</h1>", "<h1>MISSILE<br>COMMAND<br><span class=\"deluxe\">DELUXE</span></h1>")
# 5 — cut the 2D renderer; the wave intro it painted on the canvas becomes a DOM overlay with the same words
cut("function line(x,y,tx,ty,color,width=1.5){", "function isMobile(){")
js = js.replace("function isMobile(){", """// The wave intro: the original paints these words on its canvas; here they sit over the 3D world.
let introKey='';
function paintIntro(){
 const el=$('intro'),show=S.mode==='playing'&&S.intro>0;
 if(!show){if(!el.hidden)el.hidden=true;introKey='';return;}
 const key=S.wave+'|'+mobile;if(key===introKey&&!el.hidden)return;introKey=key;el.hidden=false;
 el.innerHTML=`<b class="w">WAVE ${S.wave}</b><span class="m">${multiplier()}× POINTS</span>${S.wave===1?`<span class="d">DEFEND CITIES</span>${mobile?'':'<span class="k">CLICK OR SPACE TO FIRE  ·  1 2 3 FIRE FROM ALPHA / DELTA / OMEGA</span>'}`:''}${S.wave===6?'<span class="s">SMART BOMBS INBOUND</span>':''}`;
}
function isMobile(){""", 1); n += 1
sub("""function resize(){
 const r=$('arena').getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
 canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
 const scale=Math.max(.01,Math.min(r.width/W,r.height/H));view={w:r.width,h:r.height,scale,x:(r.width-W*scale)/2,y:(r.height-H*scale)/2};
""", """function resize(){
 const r=$('arena').getBoundingClientRect();
 const scale=Math.max(.01,Math.min(r.width/W,r.height/H));view={w:r.width,h:r.height,scale,x:(r.width-W*scale)/2,y:(r.height-H*scale)/2};
 R?.resize(view); // the world fits its shift-lens camera to this exact rectangle, so the original tap maths below stays true
""")
sub(" if(blocked)pauseGame();draw();\n}", " if(blocked)pauseGame();\n}")
sub(""" const r=canvas.getBoundingClientRect(),x=(cx-r.left-view.x)/view.scale,y=(cy-r.top-view.y)/view.scale;
""", """ const k=R?.shakeOffset||{x:0,y:0}; // a hostile impact jolts the frame by a unit or two: what is under the finger is what gets hit
 const r=canvas.getBoundingClientRect(),x=(cx-r.left-view.x)/view.scale-k.x,y=(cy-r.top-view.y)/view.scale-k.y;
""")
sub(" if(S.mode==='playing'&&!blocked&&!document.hidden){accumulator+=dt;", " if(S.mode==='playing'&&!blocked&&(!document.hidden||QA)&&!lost){accumulator+=dt;")
# ?qa=1 runs in automated, often hidden, panes: there the game must not pause itself on blur or hide
sub("document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseGame();keepAlive(false);}", "document.addEventListener('visibilitychange',()=>{if(document.hidden&&!QA){pauseGame();keepAlive(false);}")
sub("window.addEventListener('blur',pauseGame);", "window.addEventListener('blur',()=>{if(!QA)pauseGame();});")
sub(" draw();requestAnimationFrame(frame);\n}", " paintIntro();R.render(S,dt,{mobile,blocked,paused:S.mode!=='playing'});requestAnimationFrame(frame);\n}")
sub("initGround();showHome();resize();requestAnimationFrame(frame);", """// ?qa=1: a handle for automated checks — the module's state is otherwise private.
const QA=new URLSearchParams(location.search).has('qa');
initGround();showHome();
try{
 R=await createWorld(canvas,{W,H,GROUND,BASE_X,CITY_X,CONFIG,mobile,qa:QA,status:t=>{$('boot-line').textContent=t;},
  // iOS reclaims a backgrounded tab's graphics context; three.js then draws nothing, for good. Without this the battle would run on, blind.
  onLost:()=>{lost=true;pauseGame();try{if(audio?.state==='running')audio.suspend().catch(()=>{});}catch(e){}keepAlive(false);
   const b=$('boot');b.hidden=false;b.classList.remove('done');$('boot-line').textContent='THE GPU DROPPED OUT';
   $('boot-note').innerHTML='The browser took the graphics context back — it happens after a long spell in the background. <a href="" onclick="location.reload();return false">Reload to play on</a>. Your high scores are safe.';}});
}catch(e){ // no GPU path at all: say so, and point at the version that needs none
 console.error('[deluxe] world failed to start',e);
 $('boot-line').textContent='THIS DEVICE CANNOT RUN THE DELUXE WORLD';
 $('boot-note').innerHTML='The same game, drawn in 2D, plays anywhere: <a href="/missile-command/">/missile-command</a>';
 throw e;
}
window.__mcdReady=true;$('boot').classList.add('done');setTimeout(()=>{$('boot').hidden=true;},700);
R.onReset(S);resize();
const SHOT=QA&&new URLSearchParams(location.search).get('shot');
if(!SHOT)requestAnimationFrame(frame);
if(QA)window.__mcd={S,R,CONFIG,fire,startGame,update,burst,spawn,spawnMissile,step(n=1){for(let i=0;i<n;i++)update(1/60);},get blocked(){return blocked;}};
// ?qa=1&shot=NAME&t=MS[&w=&h=]: a scripted battle, captured. It runs on a VIRTUAL clock — exactly 1/60 s of simulation and
// one rendered frame per tick, driven by a MessageChannel (neither rAF nor timers run in a hidden pane) — so the same URL
// always produces the same frame. The canvas is POSTed to /__shot/NAME from inside the tick that rendered it.
if(SHOT){
 const P=new URLSearchParams(location.search),queue=[],at=(ms,f)=>queue.push([ms,f]);
 if(P.get('w')){$('app').style.cssText+=`;width:${+P.get('w')}px;height:${+P.get('h')||900}px`;resize();}
 startGame();
 if(SHOT[0]==='s'){ // a siege: fast warheads on every city and battery, a couple of late interceptors
  at(1900,()=>{S.speed=430;for(let i=0;i<9;i++)spawnMissile(60+i*110,0,'missile',false);});at(2500,()=>{fire(500,230);fire(260,170);});
 }else{
  at(2300,()=>{fire(260,200);fire(520,150);fire(760,230);});at(3000,()=>{fire(400,280);fire(640,110);});at(3300,()=>fire(150,120));
  at(3600,()=>{spawnMissile(420,0);spawnMissile(700,0);spawnMissile(880,40);});
  at(1750,()=>{spawn({type:'bomber'});spawn({type:'satellite'});const c=S.enemies.filter(e=>e.type==='bomber'||e.type==='satellite');c.forEach((e,i)=>{e.direction=i?-1:1;e.x=i?760:230;e.y=i?75:120;e.speed=18;e.drop=99;});});
 }
 let done=false;at(+(P.get('t')||4200),()=>{done=true;});queue.sort((x,y)=>x[0]-y[0]);
 let vt=0;const ch=new MessageChannel(),warm=+(P.get('warm')||90); // a second and a half of frames first: shaders compile, the camera settles
 ch.port1.onmessage=()=>{
  vt+=1/60;const ms=(vt-warm/60)*1000;
  if(ms>=0){if(S.mode==='playing')update(1/60);while(queue.length&&queue[0][0]<=ms)queue.shift()[1]();}
  paintIntro();R.tickFrame();R.render(S,ms>=0?1/60:0,{mobile,blocked,paused:false});
  if(done){R.tickFrame();R.capture().then(b=>fetch('/__shot/'+SHOT,{method:'POST',body:b})).then(()=>{document.title='SHOT '+SHOT;},e=>{document.title='SHOT FAILED '+e;});return;}
  ch.port2.postMessage(0);
 };
 ch.port2.postMessage(0);
}""")
header = '''// game.js — MISSILE COMMAND DELUXE
// The simulation, input, scoring, panels and audio of /missile-command, byte for byte: this file is GENERATED from that
// game's script (the transform asserts every edit, so the two cannot drift silently). Only the 2D canvas renderer was cut
// out; in its place the three.js world (world.js) draws the same state, fed by a handful of hooks:
//   R.onReset(S) R.onWave(S) R.onShot(shot,base) R.onBlast(blast) R.onImpact(enemy,target,destroyed) R.onKill(enemy)
//   R.onSplit(enemy) R.onCityRestored(city) R.onGameOver(S) · R.resize(view) · R.shakeOffset · R.render(S,dt,flags)
// Tune WAVES and CONFIG exactly as in the original. Its own leaderboard; the sound setting is shared.
import { createWorld } from './world.js';
'''
# drop the original's leading comment block (it describes a one-file, no-request game) but keep everything else
m = re.match(r"\s*/\*.*?\*/\s*", js, re.S)
if m: js = js[m.end():]
open(out_path, 'w', encoding='utf-8').write(header + js)
print('edits:', n, '| lines:', js.count('\n'))
