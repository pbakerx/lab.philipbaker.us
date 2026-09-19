// game.js — MISSILE COMMAND DELUXE
// The simulation, input, scoring, panels and audio of /missile-command, byte for byte: this file is GENERATED from that
// game's script (the transform asserts every edit, so the two cannot drift silently). Only the 2D canvas renderer was cut
// out; in its place the three.js world (world.js) draws the same state, fed by a handful of hooks:
//   R.onReset(S) R.onWave(S) R.onShot(shot,base) R.onBlast(blast) R.onImpact(enemy,target,destroyed) R.onKill(enemy)
//   R.onSplit(enemy) R.onCityRestored(city) R.onGameOver(S) · R.resize(view) · R.shakeOffset · R.render(S,dt,flags)
// Tune WAVES and CONFIG exactly as in the original. Its own leaderboard; the sound setting is shared.
import { createWorld } from './world.js';
const $ = id => document.getElementById(id);
const canvas=$('game'), menu=$('menu');
let R=null, lost=false; // R: the three.js world (world.js), everything that is drawn · lost: the browser took the GPU context back
const W=1000, H=450, GROUND=404;
const CONFIG={ammo:10,bonusEvery:10000,blastRadius:49,blastLife:2.35,
 sideSpeed:365,centerSpeed:640,smartFirstWave:6,maxCityLosses:3};
// [ballistic missiles, speed, aircraft, smart bombs, MIRV chance].
// Hand-tuned progression, NOT extracted from the arcade ROM.
const WAVES=[
 [12,24,0,0,0],[15,28,1,0,.12],[18,33,1,0,.16],[20,38,2,0,.20],
 [22,44,2,0,.24],[24,49,2,1,.25],[26,55,2,2,.28],[28,61,3,2,.30],
 [30,67,3,3,.32],[32,73,3,3,.34],[34,79,3,4,.36],[36,85,4,4,.38]
];
const PALETTES=[['#f4ec66','#66e5ff','#ff533e'],['#f777e7','#8bfa8b','#f6e870'],['#69e88c','#69baff','#ff5c80'],['#75a9ff','#f4ec66','#ff836b']];
const BASE_X=[65,500,935], CITY_X=[190,305,405,595,695,810];
const NAMES=['ALPHA','DELTA','OMEGA'];
const STORE='mc-deluxe-scores-v1', SETTINGS='mc-mobile-sound-v1';
const fmt=n=>Math.floor(n).toLocaleString('en-US');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const rnd=(a,b)=>a+Math.random()*(b-a), pick=a=>a[Math.floor(Math.random()*a.length)];
let storageOK=true, scores=[], soundOn=true;
try { const data=JSON.parse(localStorage.getItem(STORE)||'[]');
 if(Array.isArray(data)) scores=data.filter(e=>e&&/^[A-Z0-9 ]{1,3}$/.test(e.name)&&Number.isSafeInteger(e.score)&&e.score>=0&&Number.isSafeInteger(e.wave)&&e.wave>0).sort((a,b)=>b.score-a.score).slice(0,8);
 soundOn=localStorage.getItem(SETTINGS)!=='off';
} catch(e){storageOK=false;}
const S={mode:'home',wave:1,score:0,reserve:0,nextBonus:10000,selected:-1,
 cities:[],bases:[],enemies:[],shots:[],blasts:[],sparks:[],trails:[],schedule:[],
 time:0,totalTime:0,cityLosses:0,intro:0,toastTime:0,lastBase:-1,flashBase:0,settle:0};
let view={scale:1,x:0,y:0,w:0,h:0}, last=0, accumulator=0, blocked=true, letters=[0,0,0], saved=false;
// mobile picks the wording and the rotate gate; pointer is the mouse's last spot, for the fire keys; slot is the initial being typed.
let mobile=isMobile(), pointer=null, slot=0;
let audio=null, master=null, noiseBuffer=null, activeVoices=0;

function initGround(){
 S.cities=CITY_X.map((x,i)=>({x,y:GROUND,alive:true,id:i}));
 S.bases=BASE_X.map((x,i)=>({x,y:GROUND-17,alive:true,ammo:CONFIG.ammo,id:i}));
 R?.onReset(S);
}
function multiplier(){return Math.min(6,Math.floor((S.wave-1)/2)+1);}
function waveConfig(n){
 if(n<=WAVES.length)return WAVES[n-1];
 const extra=Math.min(12,n-WAVES.length);
 return [36+Math.min(18,extra*2),85+extra*4,4+Math.floor(extra/5),4+Math.floor(extra/3),.4];
}
function writeScores(){try{localStorage.setItem(STORE,JSON.stringify(scores));}catch(e){storageOK=false;}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;S.toastTime=1.8;}
function updateHUD(){
 $('score').textContent=fmt(S.score);$('high').textContent=fmt(Math.max(S.score,scores[0]?.score||0));
 $('wave').textContent=S.wave;$('mult').textContent=multiplier()+'×';$('reserve').textContent=S.reserve;
 $('sound').setAttribute('aria-pressed',String(soundOn));$('sound').textContent=soundOn?'SOUND ON':'SOUND OFF';
 $('auto').setAttribute('aria-pressed',String(S.selected<0));
 document.querySelectorAll('[data-base]').forEach((b,i)=>{const base=S.bases[i];
  b.setAttribute('aria-pressed',String(S.selected===i));b.querySelector('.ammo').textContent=base.alive?base.ammo:'×';
  b.setAttribute('aria-label',NAMES[i]+(base.alive?`, ${base.ammo} missiles`: ', destroyed')+(S.selected===i?', selected':''));
 });
 $('pause').disabled=S.mode!=='playing'&&S.mode!=='paused';$('pause').textContent=S.mode==='paused'?'RESUME':'PAUSE';
}

// Audio is unlocked by a user gesture. LFSR noise and square waves imitate
// the character of old arcade hardware without using recorded game assets.
//
// iPHONE / iPAD. A page that only uses Web Audio gets iOS's "ambient" audio session, which Silent
// Mode (the ring switch, the Action button, Control Center) mutes — while audio.state still reads
// "running". An audible <audio> element moves the page to the "playback" session, which Silent Mode
// does not touch. So on iOS one looping, silent, UNMUTED element is played inside the same tap that
// unlocks the context (START GAME, RESUME, SOUND ON). Half a second long: WebKit only offers an
// element to the lock screen above 0.95 s. One element for life: once it has played inside a tap,
// WebKit lets THAT element play again without one. A playback session is not mixable — it pauses
// the player's own music — so only a tap that asks for the game's sound may take it (`ask`); any
// other unlock merely follows a context that is already running, and PAUSE, a hidden page and
// SOUND OFF hand the session back. (?ios=1 exercises this path on a desktop browser.)
const IOS=new URLSearchParams(location.search).has('ios')||/iP(hone|ad|od)/.test(navigator.userAgent)||(/Mac/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
let keep=null;
function silentWav(rate,secs=.5){ // 16-bit stereo PCM zeros at the context's own rate, as a data: URI — nothing to fetch
 const ch=2,len=Math.floor(rate*secs)*ch*2,b=new ArrayBuffer(44+len),v=new DataView(b),w=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
 w(0,'RIFF');v.setUint32(4,36+len,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);
 v.setUint32(24,rate,true);v.setUint32(28,rate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,len,true);
 const u=new Uint8Array(b);let t='';for(let i=0;i<u.length;i+=0x8000)t+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));
 return 'data:audio/wav;base64,'+btoa(t);
}
function keepAlive(on){
 if(!IOS||!audio)return;
 try{
  if(!keep){keep=document.createElement('audio');keep.setAttribute('x-webkit-airplay','deny');keep.disableRemotePlayback=true;keep.preload='auto';keep.loop=true;
   keep.muted=false;keep.volume=1;keep.src=silentWav(audio.sampleRate);keep.load();} // unmuted and at volume: WebKit only counts an element that CAN produce audio
  if(on&&soundOn&&!document.hidden&&S.mode!=='paused'){if(keep.paused)keep.play()?.catch(()=>{});}else if(!keep.paused)keep.pause();
 }catch(e){}
}
function unlockAudio(ask){
 try{
  if(!audio){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
   audio=new AC();master=audio.createGain();master.gain.value=soundOn?.32:0;
   const limiter=audio.createDynamicsCompressor();limiter.threshold.value=-16;limiter.ratio.value=8;
   master.connect(limiter);limiter.connect(audio.destination);
   noiseBuffer=audio.createBuffer(1,audio.sampleRate*2,audio.sampleRate);
   const d=noiseBuffer.getChannelData(0);let lfsr=0x1ffff,v=0;
   for(let i=0;i<d.length;i++){if(i%4===0){lfsr=(lfsr>>1)|(((lfsr^(lfsr>>3))&1)<<16);v=(lfsr&1)?1:-1;}d[i]=v;}
  }
  // play() before resume(), both synchronous inside the tap. Without `ask`, only follow a running context: while it is
  // interrupted the player's own audio has the session, and resume() simply waits for it — play() would take it back.
  if(ask||audio.state==='running')keepAlive(true);
  if(audio.state!=='running')audio.resume().then(()=>keepAlive(true)).catch(()=>{});
 }catch(e){audio=null;}
}
function voice(kind){
 if(!soundOn||!audio||audio.state!=='running'||activeVoices>18)return;
 const t=audio.currentTime,g=audio.createGain();g.connect(master);let src,filter;
 const noisy=kind==='blast'||kind==='impact';
 const dur=noisy?(kind==='impact'?.85:.43):(kind==='shot'?.16:kind==='bonus'?.48:.10);
 if(noisy){src=audio.createBufferSource();src.buffer=noiseBuffer;src.playbackRate.value=kind==='impact'?.43:.8;
  filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(kind==='impact'?950:2800,t);filter.frequency.exponentialRampToValueAtTime(65,t+dur);
  src.connect(filter);filter.connect(g);
 }else{src=audio.createOscillator();src.type='square';
  const f=kind==='shot'?920:kind==='bonus'?440:170;
  src.frequency.setValueAtTime(f,t);src.frequency.exponentialRampToValueAtTime(kind==='bonus'?1760:kind==='shot'?110:85,t+dur);src.connect(g);
 }
 g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(noisy?.38:.14,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+dur);
 activeVoices++;src.onended=()=>{activeVoices--;src.disconnect();g.disconnect();if(filter)filter.disconnect();};src.start(t);src.stop(t+dur+.01);
}
function addScore(points){
 S.score+=Math.round(points);
 while(S.score>=S.nextBonus){S.reserve++;S.nextBonus+=CONFIG.bonusEvery;toast('BONUS CITY EARNED');voice('bonus');}
 updateHUD();
}
function board(){
 if(!scores.length)return '<p>No scores yet. Set the first one.</p>';
 return '<table><thead><tr><th>#</th><th>NAME</th><th>WAVE</th><th>SCORE</th></tr></thead><tbody>'+scores.map((e,i)=>`<tr><td>${i+1}</td><td>${e.name}</td><td>${e.wave}</td><td>${fmt(e.score)}</td></tr>`).join('')+'</tbody></table>';
}
function showHome(){
 S.mode='home';menu.hidden=false;
 menu.innerHTML=`<div class="panel home-grid"><div><p class="eyebrow">${mobile?'MOBILE ':''}ARCADE / 1980 TRIBUTE</p><h1>MISSILE<br>COMMAND<br><span class="deluxe">DELUXE</span></h1><p>Six cities. Thirty missiles. Make every shot count.</p><div class="actions"><button class="primary" id="start">START GAME</button><button id="scores">HIGH SCORES</button></div></div><div><p class="instructions"><b>${mobile?'TAP':'CLICK'} THE SKY</b> to fire at that point.<br>Lead the incoming missiles.<br>Chain explosions to save ammunition.<br><b>AUTO</b> chooses a stocked base.<br>${mobile?'Tap':'Click'} <b>ALPHA / DELTA / OMEGA</b> to lock a base. Delta fires faster.${mobile?'':'<br>Or play it like the cabinet: keys <b>1 2 3</b> (or <b>A S D</b>) fire from Alpha, Delta and Omega at the pointer.'}</p><p class="muted line">Bonus city every 10,000 points.<br>High scores stay in this browser.${mobile?'':'<br>SPACE fire · P pause · M sound · F full screen'}</p></div></div>`;
 $('start').onclick=startGame;$('scores').onclick=showScores;updateHUD();
}
function showScores(){
 menu.innerHTML=`<div class="panel" style="max-width:510px"><h2>HIGH SCORES</h2>${board()}<p class="muted">${storageOK?'Saved on this device and browser.':'Storage unavailable. Scores last for this session only.'}</p><div class="actions"><button class="primary" id="back">BACK</button></div></div>`;$('back').onclick=showHome;
}
function startGame(){
 // The mode leaves 'paused' BEFORE the unlock (RESTART is pressed on the pause panel): keepAlive() will not play while paused,
 // and on an iPhone the keep-alive has to be played inside this very tap.
 if(blocked||!R||lost)return;S.mode='playing';unlockAudio(true);initGround();S.wave=1;S.score=0;S.reserve=0;S.nextBonus=CONFIG.bonusEvery;S.selected=-1;S.totalTime=0;saved=false;
 nextWave();
 // Browsers may refuse fullscreen/orientation lock. The rotation gate remains.
 // Phones only: there it hides the browser chrome. A desktop window taken over on START is rude — F is the opt-in.
 if(mobile&&document.documentElement.requestFullscreen&&!document.fullscreenElement){
  try{const f=document.documentElement.requestFullscreen();if(f?.then)f.then(()=>{try{screen.orientation?.lock?.('landscape').catch(()=>{});}catch(e){}}).catch(()=>{});}catch(e){}
 }
}
function nextWave(){
 S.mode='playing';menu.hidden=true;S.enemies=[];S.shots=[];S.blasts=[];S.sparks=[];S.trails=[];S.schedule=[];
 S.time=0;S.intro=1.7;S.settle=0;S.cityLosses=0;S.lastBase=-1;$('toast').hidden=true;
 S.bases.forEach(b=>{b.alive=true;b.ammo=CONFIG.ammo;});
 const [count,speed,craft,smart,split]=waveConfig(S.wave);S.speed=speed;S.split=split;
 let t=.6;
 for(let i=0;i<count;){const batch=Math.min(count-i,3+Math.floor(Math.random()*3));const origin=rnd(90,W-90);
  for(let j=0;j<batch;j++,i++)S.schedule.push({at:t+j*.14,type:'missile',x:clamp(origin+rnd(-65,65),20,W-20)});
  t+=Math.max(1.2,3.5-S.wave*.09);
 }
 for(let i=0;i<craft;i++)S.schedule.push({at:3+i*Math.max(3,t/Math.max(1,craft)),type:i%2?'satellite':'bomber'});
 for(let i=0;i<smart;i++)S.schedule.push({at:5+i*Math.max(1.6,t/Math.max(1,smart)),type:'smart',x:rnd(65,W-65)});
 S.schedule.sort((a,b)=>a.at-b.at);voice('bonus');updateHUD();paintIntro();R?.onWave(S);
}
function target(){
 // After three losses, remaining cities survive this wave, as in the arcade.
 const live=S.cityLosses<CONFIG.maxCityLosses?S.cities.filter(c=>c.alive):[];
 const bases=S.bases.filter(b=>b.alive);
 if(live.length&&(!bases.length||Math.random()<.78))return pick(live);
 return pick(bases.length?bases:S.cities.filter(c=>!c.alive).length?S.cities.filter(c=>!c.alive):S.cities);
}
function spawnMissile(x,y=0,type='missile',canSplit=true){
 const dest=target();S.enemies.push({type,x,y,ox:x,oy:y,tx:dest.x,ty:dest.y,target:dest,
  speed:S.speed*(type==='smart'?1.45:rnd(.92,1.09)),split:type==='missile'&&canSplit&&Math.random()<S.split,
  splitY:rnd(100,205),dead:false,path:[{x,y}]});
}
function spawn(item){
 if(item.type==='bomber'||item.type==='satellite'){
  const direction=Math.random()<.5?1:-1;
  S.enemies.push({type:item.type,x:direction>0?-25:W+25,y:rnd(60,150),direction,speed:70+Math.min(S.wave,24)*3.3,drop:rnd(.6,1.6),drops:0,dead:false});
 }else spawnMissile(item.x,0,item.type);
}
// from: -1 lets AUTO choose, 0-2 names a base. Taps and clicks pass the HUD selection; a fire key passes its own base.
function fire(x,y,from=S.selected){
 if(S.mode!=='playing'||S.intro>0||blocked)return false;
 x=clamp(x,5,W-5);y=clamp(y,5,GROUND-27);
 const available=S.bases.filter(b=>b.alive&&b.ammo>0);
 const base=from<0?available.sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x)||b.ammo-a.ammo)[0]:S.bases[from];
 if(!base||!base.alive||!base.ammo){voice('dry');toast(from<0?'OUT OF MISSILES':`${NAMES[from]} ${base?.alive?'EMPTY':'DESTROYED'}${from===S.selected?' · SELECT ANOTHER BASE':''}`);return false;}
 base.ammo--;S.lastBase=base.id;S.flashBase=.22;
 const shot={x:base.x,y:base.y,ox:base.x,oy:base.y,tx:x,ty:y,speed:base.id===1?CONFIG.centerSpeed:CONFIG.sideSpeed};S.shots.push(shot);R?.onShot(shot,base);
 voice('shot');updateHUD();return true;
}
function burst(x,y,max=CONFIG.blastRadius,hostile=false){
 const blast={x,y,age:0,r:0,max,life:hostile?1.25:CONFIG.blastLife,hostile};S.blasts.push(blast);voice(hostile?'impact':'blast');R?.onBlast(blast);
 for(let i=0;i<7;i++)S.sparks.push({x,y,vx:rnd(-55,55),vy:rnd(-55,55),life:rnd(.25,.6)});
}
function impact(e){
 const t=e.target,was=t.alive;
 if(t.alive){
  if('ammo'in t){t.alive=false;t.ammo=0;}
  else if(S.cityLosses<CONFIG.maxCityLosses){t.alive=false;S.cityLosses++;}
 }
 R?.onImpact(e,t,was&&!t.alive);burst(e.x,e.y,38,true);updateHUD();
}
function distanceToSegment(px,py,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;
 const u=l?clamp(((px-ax)*dx+(py-ay)*dy)/l,0,1):0;
 return Math.hypot(px-ax-u*dx,py-ay-u*dy);
}
function kill(e){
 if(e.dead)return;e.dead=true;R?.onKill(e);
 addScore((e.type==='smart'?125:e.type==='missile'?25:100)*multiplier());burst(e.x,e.y,41);
}
function finishWave(){
 const cities=S.cities.filter(c=>c.alive).length,ammo=S.bases.reduce((n,b)=>n+(b.alive?b.ammo:0),0),m=multiplier();
 const cityPoints=cities*100*m,ammoPoints=ammo*5*m;addScore(cityPoints+ammoPoints);
 let restored=0;for(const city of S.cities){if(!city.alive&&S.reserve>0){city.alive=true;S.reserve--;restored++;R?.onCityRestored(city);}}
 updateHUD();if(!S.cities.some(c=>c.alive)){endGame();return;}
 S.mode='bonus';menu.hidden=false;
 menu.innerHTML=`<div class="panel center"><p class="eyebrow">WAVE ${S.wave} COMPLETE</p><h2>BONUS POINTS</h2><div class="bonus-grid"><span>${cities} CITIES × ${100*m}</span><b>${fmt(cityPoints)}</b><span>${ammo} MISSILES × ${5*m}</span><b>${fmt(ammoPoints)}</b></div><p>${restored?restored+' BONUS '+(restored===1?'CITY RESTORED':'CITIES RESTORED'):'ALL BASES REARMED'}${S.reserve?' · '+S.reserve+' IN RESERVE':''}</p><div class="actions"><button id="next" class="primary">WAVE ${S.wave+1}</button></div></div>`;
 $('next').onclick=()=>{if(blocked)return;unlockAudio();S.wave++;nextWave();};updateHUD();
}
function pauseGame(){
 if(S.mode!=='playing')return;S.mode='paused';menu.hidden=false;
 menu.innerHTML=`<div class="panel center"><p class="eyebrow">MISSION ON HOLD</p><h2>PAUSED</h2><p>${mobile?'Tap':'Click'} a base to lock it. AUTO restores automatic selection.${mobile?'':'<br>1 2 3 or A S D fire from Alpha, Delta or Omega · P or ENTER resumes'}</p><div class="actions"><button class="primary" id="resume">RESUME</button><button id="restart">RESTART</button></div></div>`;
 $('resume').onclick=resumeGame;$('restart').onclick=startGame;
 if(audio?.state==='running')audio.suspend().catch(()=>{});keepAlive(false);updateHUD();
}
function resumeGame(){if(blocked||lost||S.mode!=='paused')return;S.mode='playing';unlockAudio(true);menu.hidden=true;last=performance.now();accumulator=0;updateHUD();}
function endGame(){
 R?.onGameOver(S);S.mode='over';menu.hidden=false;letters=[0,0,0];slot=0;
 const qualify=S.score>0&&(scores.length<8||S.score>scores[scores.length-1].score);
 menu.innerHTML=`<div class="panel center"><p class="eyebrow">WAVE ${S.wave}</p><h2>THE END</h2><div class="score-number">${fmt(S.score)}</div>${qualify?`<p>HIGH SCORE · ${mobile?'ENTER':'TYPE'} YOUR INITIALS</p><div id="initials" class="initials"></div>`:'<p>The cities have fallen.</p>'}<div class="actions">${qualify?'<button id="save" class="primary">SAVE SCORE</button>':'<button id="again" class="primary">PLAY AGAIN</button>'}<button id="home">MAIN MENU</button></div><p id="save-note" class="muted"></p></div>`;
 if(qualify){drawInitials();$('save').onclick=saveEntry;}else $('again').onclick=startGame;
 $('home').onclick=()=>{if(qualify&&!saved)saveEntry(false);initGround();showHome();};updateHUD();
}
function drawInitials(){
 // On a desktop the slot the next keystroke lands in is lit; the +/− buttons work either way.
 $('initials').innerHTML=letters.map((n,i)=>`<div class="letter${!mobile&&!saved&&i===Math.min(slot,2)?' on':''}"><button data-letter="${i}" data-change="1" aria-label="Next letter ${i+1}">+</button><span>${String.fromCharCode(65+n)}</span><button data-letter="${i}" data-change="-1" aria-label="Previous letter ${i+1}">−</button></div>`).join('');
 $('initials').querySelectorAll('button').forEach(b=>b.onclick=()=>{const i=+b.dataset.letter;letters[i]=(letters[i]+(+b.dataset.change)+26)%26;drawInitials();});
}
function saveEntry(changeUI=true){
 if(saved)return;saved=true;scores.push({name:letters.map(n=>String.fromCharCode(65+n)).join(''),score:S.score,wave:S.wave});scores.sort((a,b)=>b.score-a.score);scores=scores.slice(0,8);writeScores();
 if(changeUI){$('save').textContent='PLAY AGAIN';$('save').onclick=startGame;$('save-note').textContent=storageOK?'HIGH SCORE SAVED':'Saved for this session. Browser storage is unavailable.';drawInitials();$('initials').querySelectorAll('button').forEach(b=>b.disabled=true);}updateHUD();
}

function update(dt){
 S.totalTime+=dt;if(S.flashBase>0)S.flashBase-=dt;
 if(S.toastTime>0){S.toastTime-=dt;if(S.toastTime<=0)$('toast').hidden=true;}
 if(S.intro>0){S.intro-=dt;return;}
 S.time+=dt;while(S.schedule.length&&S.schedule[0].at<=S.time)spawn(S.schedule.shift());
 for(const b of S.blasts){b.age+=dt;const u=b.age/b.life;b.r=b.max*(u<.35?u/.35:u<.65?1:(1-u)/.35);}
 S.blasts=S.blasts.filter(b=>b.age<b.life);
 for(const shot of S.shots){const dx=shot.tx-shot.x,dy=shot.ty-shot.y,d=Math.hypot(dx,dy),step=shot.speed*dt;
  if(d<=step){shot.dead=true;burst(shot.tx,shot.ty);}else{shot.x+=dx/d*step;shot.y+=dy/d*step;}}
 S.shots=S.shots.filter(s=>!s.dead);
 // Iterate a snapshot: split missiles and aircraft drops move on the next tick.
 for(const e of [...S.enemies]){
  if(e.dead)continue;const oldX=e.x,oldY=e.y;
  if(e.type==='bomber'||e.type==='satellite'){
   e.x+=e.direction*e.speed*dt;e.drop-=dt;
   if(e.drop<=0&&e.x>35&&e.x<W-35&&e.drops<4){spawnMissile(e.x,e.y,'missile',false);e.drop=rnd(1.3,2.8);e.drops++;}
   if(e.x<-45||e.x>W+45){e.dead=true;continue;}
  }else{
   let dx=e.tx-e.x,dy=e.ty-e.y,d=Math.hypot(dx,dy),step=e.speed*dt;
   if(d<=step){e.x=e.tx;e.y=e.ty;}
   else{
    let vx=dx/d,vy=dy/d;
    if(e.type==='smart'){
     for(const b of S.blasts){if(b.hostile)continue;const bx=e.x-b.x,by=e.y-b.y,dist=Math.hypot(bx,by);
      if(dist<b.r+48&&dist>0&&b.y>=e.y-24){vx+=Math.sign(bx||e.tx-e.x||1)*(1-dist/(b.r+48))*3;vy=Math.max(.28,vy-.5);}}
     const norm=Math.hypot(vx,vy);vx/=norm;vy/=norm;
    }
    e.x=clamp(e.x+vx*step,5,W-5);e.y+=vy*step;
   }
   if(e.type==='smart'){if(e.path.length<100&&Math.hypot(e.x-e.path[e.path.length-1].x,e.y-e.path[e.path.length-1].y)>7)e.path.push({x:e.x,y:e.y});}
  }
  for(const b of S.blasts){if(!b.hostile&&distanceToSegment(b.x,b.y,oldX,oldY,e.x,e.y)<=b.r+(e.type==='missile'?1:5)){kill(e);break;}}
  if(e.dead)continue;
  if(e.type==='missile'&&e.split&&e.y>=e.splitY){
   e.split=false;R?.onSplit(e);for(let i=0;i<(S.wave>10?3:2);i++)spawnMissile(e.x,e.y,'missile',false);
  }
  if((e.type==='missile'||e.type==='smart')&&e.y>=e.ty-.5){e.dead=true;impact(e);}
 }
 for(const e of S.enemies){if(e.dead&&e.type==='missile')S.trails.push({x:e.ox,y:e.oy,tx:e.x,ty:e.y,life:.35});}
 S.enemies=S.enemies.filter(e=>!e.dead);
 for(const p of S.sparks){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}S.sparks=S.sparks.filter(p=>p.life>0);
 for(const t of S.trails)t.life-=dt;S.trails=S.trails.filter(t=>t.life>0);
 if(!S.schedule.length&&!S.enemies.length&&!S.shots.length&&!S.blasts.length){S.settle+=dt;if(S.settle>.6)finishWave();}else S.settle=0;
}
// The wave intro: the original paints these words on its canvas; here they sit over the 3D world.
let introKey='';
function paintIntro(){
 const el=$('intro'),show=S.mode==='playing'&&S.intro>0;
 if(!show){if(!el.hidden)el.hidden=true;introKey='';return;}
 const key=S.wave+'|'+mobile;if(key===introKey&&!el.hidden)return;introKey=key;el.hidden=false;
 el.innerHTML=`<b class="w">WAVE ${S.wave}</b><span class="m">${multiplier()}× POINTS</span>${S.wave===1?`<span class="d">DEFEND CITIES</span>${mobile?'':'<span class="k">CLICK OR SPACE TO FIRE  ·  1 2 3 FIRE FROM ALPHA / DELTA / OMEGA</span>'}`:''}${S.wave===6?'<span class="s">SMART BOMBS INBOUND</span>':''}`;
}
function isMobile(){return navigator.maxTouchPoints>0&&(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));}
function resize(){
 const r=$('arena').getBoundingClientRect();
 const scale=Math.max(.01,Math.min(r.width/W,r.height/H));view={w:r.width,h:r.height,scale,x:(r.width-W*scale)/2,y:(r.height-H*scale)/2};
 R?.resize(view); // the world fits its shift-lens camera to this exact rectangle, so the original tap maths below stays true
 // Only a phone or tablet held upright is gated. A desktop window of any shape plays: the field letterboxes.
 mobile=isMobile();blocked=mobile&&window.innerWidth<=window.innerHeight;
 $('gate').hidden=!blocked;
 if(blocked)pauseGame();
}
// Client coordinates to playfield coordinates; null in the letterbox.
function fieldPoint(cx,cy){
 const k=R?.shakeOffset||{x:0,y:0}; // a hostile impact jolts the frame by a unit or two: what is under the finger is what gets hit
 const r=canvas.getBoundingClientRect(),x=(cx-r.left-view.x)/view.scale-k.x,y=(cy-r.top-view.y)/view.scale-k.y;
 return x<0||x>W||y<0||y>H?null:{x,y};
}
canvas.addEventListener('pointerdown',e=>{
 e.preventDefault();if(e.button!==0)return;unlockAudio(); // touch, pen tip, or the primary mouse button
 const p=fieldPoint(e.clientX,e.clientY);if(!p)return;
 if(p.y>GROUND-30){const base=S.bases.find(b=>Math.abs(b.x-p.x)<50);if(base){selectBase(base.id);return;}}
 fire(p.x,p.y);
},{passive:false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
function selectBase(i){S.selected=i;updateHUD();}
document.querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>selectBase(+b.dataset.base));$('auto').onclick=()=>selectBase(-1);
$('pause').onclick=()=>S.mode==='paused'?resumeGame():pauseGame();
$('sound').onclick=()=>{soundOn=!soundOn;unlockAudio(soundOn);keepAlive(soundOn);if(master)master.gain.setTargetAtTime(soundOn?.32:0,audio.currentTime,.02);try{localStorage.setItem(SETTINGS,soundOn?'on':'off');}catch(e){}updateHUD();};
// DESKTOP. The mouse stands in for the trackball and 1/2/3 (or A/S/D) for the cabinet's
// three fire buttons. Bases are matched by e.code first — the physical key, so the row works
// on any layout — then by the character, because on-screen keyboards, remote desktops and
// voice control send an empty code. The mnemonics (P, M, F) go by e.key, the letter on the cap.
const FIRE_KEYS={Digit1:0,Digit2:1,Digit3:2,Numpad1:0,Numpad2:1,Numpad3:2,KeyA:0,KeyS:1,KeyD:2};
const FIRE_CHARS={1:0,2:1,3:2,a:0,s:1,d:2};
// Tracked on the window, not the canvas: a panel covers the canvas between waves, and a mouse
// that sat still through it would otherwise have no known position when play resumes.
// pointerdown counts too — a remote desktop or an automated click can land without ever moving.
for(const type of ['pointermove','pointerdown'])window.addEventListener(type,e=>{if(e.pointerType!=='touch')pointer={x:e.clientX,y:e.clientY};},true);
function keyFire(from){const p=pointer&&fieldPoint(pointer.x,pointer.y);if(p){unlockAudio();fire(p.x,p.y,from);}}
function toggleFullscreen(){try{const f=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();f?.catch?.(()=>{});}catch(e){}}
document.addEventListener('keydown',e=>{
 // Leave browser shortcuts alone, ignore auto-repeat (a held key must not empty a base), and stand down while the lab menu is open.
 if(e.metaKey||e.ctrlKey||e.altKey||e.repeat||blocked||lost||document.querySelector('#pb-menu .drawer.open'))return;
 const key=e.code==='Space'?' ':e.key.toLowerCase(),onButton=e.target instanceof HTMLButtonElement;
 if(S.mode==='over'&&!saved&&$('initials')){ // typed initials; comes first because A, S, D, P, M and F are letters too
  if(/^[a-z]$/.test(key)){letters[Math.min(slot,2)]=key.charCodeAt(0)-97;slot=Math.min(3,slot+1);drawInitials();e.preventDefault();return;}
  if(key==='backspace'){slot=Math.max(0,slot-1);letters[slot]=0;drawInitials();e.preventDefault();return;}
 }
 const from=FIRE_KEYS[e.code]??FIRE_CHARS[key];
 if(from!==undefined){keyFire(from);return;}
 if(onButton&&(key===' '||key==='enter'))return; // a focused button takes these natively
 if(key===' '||key==='enter'){
  e.preventDefault();
  if(!menu.hidden)menu.querySelector('.primary')?.click();else if(key===' ')keyFire(S.selected);
 }else if(key==='p'||key==='escape')$('pause').click();
 else if(key==='m')$('sound').click();
 else if(key==='f')toggleFullscreen();
});
// Each panel hands focus to its primary button as it opens, so Enter or Space always answers it.
// And takes it back as it closes: not every browser blurs a button that just became display:none,
// and Space on a hidden, still-focused WAVE button would skip a wave mid-play.
new MutationObserver(()=>{
 if(!menu.hidden)menu.querySelector('.primary')?.focus({preventScroll:true});
 else if(menu.contains(document.activeElement))document.activeElement.blur();
}).observe(menu,{childList:true,attributes:true,attributeFilter:['hidden']});
document.addEventListener('click',e=>{
 if(e.target.closest('#pb-menu'))pauseGame(); // the lab's menu slides over the playfield; don't let the wave run under it
 // A mouse click (detail>0; a keyboard press is 0) must not park focus on a HUD button, or Space would press it again instead of firing.
 else if(e.detail)e.target.closest('#hud button,#controls button')?.blur();
});
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!QA){pauseGame();keepAlive(false);}last=performance.now();accumulator=0;});
window.addEventListener('pagehide',()=>{pauseGame();keepAlive(false);});window.addEventListener('blur',()=>{if(!QA)pauseGame();});
function frame(now){
 const dt=Math.min(.1,(now-(last||now))/1000);last=now;
 if(S.mode==='playing'&&!blocked&&(!document.hidden||QA)&&!lost){accumulator+=dt;while(accumulator>=1/60&&S.mode==='playing'){update(1/60);accumulator-=1/60;}}else accumulator=0;
 paintIntro();R.render(S,dt,{mobile,blocked,paused:S.mode!=='playing'});requestAnimationFrame(frame);
}
// ?qa=1: a handle for automated checks — the module's state is otherwise private.
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
}
