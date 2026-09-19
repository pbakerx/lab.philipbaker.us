// MISSILE COMMAND DELUXE · CITY RUN — scene.js: the look.
//
// Everything three.js lives here; the rules live in main.js, which owns plain arrays of plain
// objects (enemies, shots, blasts…) and calls sync() once a frame. Nothing here decides anything.
//
// THE STYLE is a vector display that grew a third dimension: black sky, a luminous city, light
// that blooms. Every colour on screen is one of the original game's three — GROUND, FRIENDLY,
// ENEMY — plus white-hot cores. The palette changes on the original's cadence (every two levels).
//
// THE APPROACH is deliberately plain: the classic WebGLRenderer (WebGL2 everywhere, phones
// included), hand-written GLSL, one bloom pass. A handful of pooled, instanced draws:
//   buildings · beams (every line of light: trails, the tether, contrails) · sprites (every
//   point of light: heads, sparks, embers) · blast shells. No textures, no models, no lights —
//   blastLight() below is the one light function, and every surface calls it.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const V3 = THREE.Vector3;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// The street grid. Avenue k (0..N) and block i (0..N-1) alternate: |ave|block|ave|block|…|ave|.
export const GRID = { N: 11, ave: 40, block: 44, pitch: 84 };
GRID.half = (GRID.N * GRID.pitch + GRID.ave) / 2;
export const aveAt = k => -GRID.half + k * GRID.pitch + GRID.ave / 2;
export const blockAt = i => -GRID.half + i * GRID.pitch + GRID.ave + GRID.block / 2;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Three hand-drawn circuits on the avenue lattice, each with the six tower blocks and the camp
// block that sit beside it. A level picks one and one of the square's 8 symmetries, so 24 cities
// fly differently before anything repeats.
const CIRCUITS = [
  { path: [[1,1],[10,1],[10,4],[5,4],[5,7],[10,7],[10,10],[1,10],[1,6],[3,6],[3,3],[1,3]], towers: [[3,1],[8,3],[5,5],[8,7],[3,9],[2,4]], camp: [4,5] },
  { path: [[1,2],[4,2],[4,5],[8,5],[8,2],[10,2],[10,9],[6,9],[6,7],[3,7],[3,10],[1,10]], towers: [[2,2],[5,4],[8,3],[7,8],[4,7],[1,6]], camp: [5,5] },
  { path: [[2,1],[9,1],[9,3],[6,3],[6,6],[9,6],[9,10],[2,10],[2,8],[5,8],[5,5],[2,5]], towers: [[4,1],[7,3],[6,5],[7,9],[3,8],[3,5]], camp: [4,6] },
];
function symmetry(s, centre) { // one of the 8 symmetries of the square, about `centre`
  return ([x, y]) => { x -= centre; y -= centre; if (s & 4) x = -x; for (let r = 0; r < (s & 3); r++) [x, y] = [-y, x]; return [x + centre, y + centre]; };
}

const GLSL_COMMON = /* glsl */`
uniform vec3 uFogColor; uniform float uFogDensity;
uniform vec4 uLightPos[8];   // xyz, radius
uniform vec3 uLightCol[8];   // colour × power
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 blastLight(vec3 wp, vec3 n){
  vec3 sum=vec3(0.);
  for(int i=0;i<8;i++){
    float r=uLightPos[i].w; if(r<=0.) continue;
    vec3 d=uLightPos[i].xyz-wp; float att=1./(1.+dot(d,d)/(r*r)); att*=att;
    float ndl=max(dot(n,normalize(d+vec3(1e-4))),0.)*.8+.2;
    sum+=uLightCol[i]*att*ndl;
  }
  return sum;
}
vec3 fogged(vec3 c, float dist){ float f=dist*uFogDensity; return mix(c,uFogColor,1.-exp(-f*f)); }
`;

export async function createWorld(canvas, { mobile = false, quality = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const lowEnd = quality === 'low' || (mobile && quality !== 'high');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.6, 9000);
  camera.position.set(0, 60, -200);

  // MSAA on the scene target where it is cheap; a phone leans on its pixel density instead.
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: lowEnd ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.42);
  composer.addPass(bloom);
  // The lens: what makes a render read as a hologram seen through glass — colour fringing toward the edges, a vignette, a breath of grain.
  const lens = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: lowEnd ? .6 : 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime,uAmount; varying vec2 vUv;
      float h(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
      void main(){ vec2 c=vUv-.5; float r2=dot(c,c); vec2 off=c*r2*.011*uAmount;
        vec3 col=vec3(texture2D(tDiffuse,vUv+off).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-off).b);
        col*=1.-.6*r2*uAmount; col+=(h(vUv*vec2(1613.,907.)+fract(uTime)*7.)-.5)*.016*uAmount; gl_FragColor=vec4(max(col,0.),1.); }` });
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------------------- shared uniforms
  const pal = { ground: new THREE.Color('#f4ec66'), friendly: new THREE.Color('#66e5ff'), enemy: new THREE.Color('#ff533e') };
  const U = {
    uTime: { value: 0 }, uGround: { value: pal.ground }, uFriendly: { value: pal.friendly }, uEnemy: { value: pal.enemy },
    uFogColor: { value: new THREE.Color(0, 0, 0) }, uFogDensity: { value: 0.00125 },
    uLightPos: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uLightCol: { value: Array.from({ length: 8 }, () => new V3()) },
    uPxScale: { value: 0.001 }, uHalf: { value: GRID.half }, uPitch: { value: GRID.pitch }, uAve: { value: GRID.ave },
  };
  const shared = (...names) => Object.fromEntries(names.map(n => [n, U[n]]));
  const LIGHT = ['uFogColor', 'uFogDensity', 'uLightPos', 'uLightCol'];

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: shared('uTime', 'uGround', 'uFriendly'),
    vertexShader: `varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uGround,uFriendly;
      float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){ vec3 d=normalize(vDir); float h=d.y; vec3 col=vec3(0.);
        col+=uGround*exp(-abs(h)*10.)*.085 + uFriendly*exp(-abs(h)*3.2)*.010;      // the horizon breathes the ground colour
        vec2 g=vec2(atan(d.z,d.x),asin(clamp(h,-1.,1.)))*58.; vec2 id=floor(g), f=fract(g)-.5;
        float r=hash21(id); vec2 o=(vec2(hash21(id+1.7),hash21(id+9.2))-.5)*.7;
        float s=smoothstep(.075,0.,length(f-o))*step(.84,r)*(.55+.45*sin(uTime*(.8+r*2.5)+r*40.));
        col+=mix(vec3(1.),uFriendly,.35*r)*s*smoothstep(.02,.22,h)*1.5;
        gl_FragColor=vec4(col,1.); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // ---------------------------------------------------------------- the ground: streets inside the city, a vector desert outside
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, uniforms: shared('uTime', 'uGround', 'uFriendly', 'uHalf', 'uPitch', 'uAve', ...LIGHT),
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying vec3 vW; uniform vec3 uGround,uFriendly; uniform float uHalf,uPitch,uAve,uTime;
      float aaLine(float d,float w){ float fw=fwidth(d); return 1.-smoothstep(w-fw,w+fw,abs(d)); }
      void main(){
        vec2 p=vW.xz; float dist=length(vW-cameraPosition); vec3 col;
        float inCity=step(max(abs(p.x),abs(p.y)),uHalf);
        vec2 g=mod(p+uHalf,uPitch); float inX=step(g.x,uAve), inY=step(g.y,uAve);
        float fade=exp(-dist*.0012);
        if(inCity>.5 && max(inX,inY)>.5){                                     // asphalt
          col=vec3(.0085,.0095,.0125);
          float lx=aaLine(g.x-uAve*.5,.4)*inX*(1.-inY)*step(.45,fract(p.y/14.));
          float ly=aaLine(g.y-uAve*.5,.4)*inY*(1.-inX)*step(.45,fract(p.x/14.));
          float kx=(aaLine(g.x-1.4,.24)+aaLine(g.x-(uAve-1.4),.24))*inX*(1.-inY);
          float ky=(aaLine(g.y-1.4,.24)+aaLine(g.y-(uAve-1.4),.24))*inY*(1.-inX);
          col+=uGround*((lx+ly)*1.15+(kx+ky)*.3)*fade;
        }else if(inCity>.5){                                                  // a block's plot
          col=vec3(.0055,.0065,.009); vec2 b=g-uAve; float bw=uPitch-uAve;
          float e=min(min(b.x,bw-b.x),min(b.y,bw-b.y));
          col+=uGround*aaLine(e-.7,.26)*.5*fade;
        }else{                                                                // beyond the city: the defence perimeter, ring after ring
          col=vec3(.0032,.0038,.0058); float rr=length(p); float ring=aaLine(mod(rr,260.)-130.,.8);
          float spoke=aaLine(abs(fract(atan(p.y,p.x)*3.8197)-.5)*rr*.2618,.6)*step(uHalf*1.5,rr);
          col+=uFriendly*(ring*.42+spoke*.16)*exp(-dist*.00062);
        }
        col+=blastLight(vW,vec3(0.,1.,0.))*.62;
        float ndv=clamp(normalize(cameraPosition-vW).y,0.,1.), street=inCity*max(inX,inY);
        float alpha=mix(1.,mix(.42,.9,ndv),street);                           // an avenue is a dark mirror: most reflective at a grazing angle
        gl_FragColor=vec4(fogged(col,dist),alpha);
      }`,
  }));
  ground.frustumCulled = false; ground.renderOrder = 1; scene.add(ground);

  // ---------------------------------------------------------------- the defence grid: a faint hex dome over the city that lights up around every blast
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: shared('uTime', 'uFriendly', 'uLightPos', 'uLightCol'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      varying vec3 vW; uniform float uTime; uniform vec3 uFriendly; uniform vec4 uLightPos[8]; uniform vec3 uLightCol[8];
      float hexEdge(vec2 uv){ vec2 r=vec2(1.,1.7320508), h=r*.5, a=mod(uv,r)-h, b=mod(uv-h,r)-h; vec2 g=dot(a,a)<dot(b,b)?a:b; g=abs(g); return .5-max(dot(g,vec2(.5,.866025)),g.x); }   // the tiling (1, √3) is pointy-top: its flat distance is along x. Swap the axes and the outlines become filled wedges
      void main(){
        vec3 d=normalize(vW); float e=hexEdge(d.xz/(1.+d.y)*10.), fw=fwidth(e); float line=1.-smoothstep(.012-fw,.012+fw,e);
        float scan=smoothstep(.965,1.,sin(d.y*8.-uTime*.4)); vec3 v=normalize(vW-cameraPosition), halo=vec3(0.);
        for(int i=0;i<8;i++){ if(uLightPos[i].w<=0.) continue; float a=max(dot(v,normalize(uLightPos[i].xyz-cameraPosition)),0.); a*=a; a*=a; a*=a; a*=a; halo+=uLightCol[i]*a*a; }
        float band=smoothstep(0.,.16,d.y)*(1.-smoothstep(.45,.95,d.y))+.12;
        gl_FragColor=vec4(uFriendly*line*(.02+.06*scan)*band+halo*(line*.3+.012),1.);
      }`,
  }));
  dome.renderOrder = 2; dome.frustumCulled = false; scene.add(dome);
  const MOTES = Array.from({ length: lowEnd ? 70 : 160 }, () => new V3(Math.random() * 180, Math.random() * 100, Math.random() * 180));   // drifting specks near the lens: the cheapest sense of speed there is

  // ---------------------------------------------------------------- buildings: one instanced box, dressed entirely in the shader
  const MAXB = 900;
  const bGeo = new THREE.InstancedBufferGeometry(); { const box = new THREE.BoxGeometry(1, 1, 1); bGeo.index = box.index; bGeo.setAttribute('position', box.getAttribute('position')); bGeo.setAttribute('normal', box.getAttribute('normal')); }
  const bPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3), bSize = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
  const bMisc = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4), bState = new THREE.InstancedBufferAttribute(new Float32Array(MAXB), 1);
  bState.setUsage(THREE.DynamicDrawUsage);
  bGeo.setAttribute('aPos', bPos); bGeo.setAttribute('aSize', bSize); bGeo.setAttribute('aMisc', bMisc); bGeo.setAttribute('aState', bState);
  bGeo.instanceCount = 0;
  const makeBuildingMat = mirror => new THREE.ShaderMaterial({
    side: mirror ? THREE.BackSide : THREE.FrontSide, uniforms: { ...shared('uTime', 'uGround', 'uFriendly', 'uEnemy', ...LIGHT), uMirror: { value: mirror ? 1 : 0 } },
    vertexShader: /* glsl */`
      attribute vec3 aPos,aSize; attribute vec4 aMisc; attribute float aState; uniform float uMirror;
      varying vec3 vW,vN,vL,vSize; varying vec4 vMisc; varying float vState;
      void main(){
        vec3 p=position; p.y+=.5; float s=smoothstep(0.,1.,aState), keep=1.-.9*s;       // a fallen tower keeps a tenth of itself
        vec3 lp=vec3(p.x*aSize.x,p.y*aSize.y*keep,p.z*aSize.z);
        lp.xz+=aState*(1.-aState)*5.*p.y*vec2(sin(p.y*9.+aMisc.x*40.),cos(p.y*7.+aMisc.x*23.));  // it sways on the way down
        vec3 w=vec3(aPos.x,aPos.y*keep,aPos.z)+lp;
        vW=w; vN=normal; vL=vec3(p.x*aSize.x,p.y*aSize.y,p.z*aSize.z); vSize=aSize; vMisc=aMisc; vState=aState;
        gl_Position=projectionMatrix*viewMatrix*vec4(w.x,mix(w.y,-w.y,uMirror),w.z,1.);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying vec3 vW,vN,vL,vSize; varying vec4 vMisc; varying float vState;
      uniform vec3 uGround,uFriendly,uEnemy; uniform float uTime,uMirror;
      void main(){
        vec3 n=normalize(vN); float seed=vMisc.x, kind=vMisc.y, glow=vMisc.z; float dist=length(vW-cameraPosition);
        float alive=1.-smoothstep(.05,.6,vState); vec3 col=vec3(.010,.012,.018); vec3 emit=vec3(0.);
        vec3 accent=mix(uFriendly,uGround,step(.8,fract(seed*5.7))*(1.-step(.5,kind)));   // one building in five wears the ground colour
        if(n.y>.5){                                                                      // roof: a rim of light
          vec2 q=abs(vL.xz)/(vSize.xz*.5); float e=max(q.x,q.y);
          emit+=accent*smoothstep(.86,.9,e)*(1.-smoothstep(.95,1.,e))*(kind>.5?1.3:.22*glow);
        }else if(n.y>-.5){                                                               // a wall: windows, corner strips, a crown
          float side=step(.5,abs(n.x)); float u=mix(vL.x,vL.z,side), w=mix(vSize.x,vSize.z,side);
          vec2 uv=vec2(u+w*.5,vL.y), cs=vec2(2.5,3.2), c=floor(uv/cs), f=fract(uv/cs);
          float r=hash21(c+seed*97.+side*13.+step(0.,n.x+n.z)*7.);
          float lit=mix(.08,.36,fract(seed*7.13)); float on=step(1.-lit,r);
          float win=smoothstep(.13,.22,f.x)*(1.-smoothstep(.78,.87,f.x))*smoothstep(.2,.3,f.y)*(1.-smoothstep(.7,.8,f.y));
          vec3 wc=mix(accent,vec3(1.,.84,.6),step(.74,hash21(c.yx+seed*31.))*(1.-step(.5,kind)))*(.16+1.05*pow(hash21(c+3.7),2.2));
          float aa=clamp(1.-max(fwidth(uv.x)/cs.x,fwidth(uv.y)/cs.y)*1.3,0.,1.);        // far away, windows melt into an average glow
          emit+=wc*mix(lit*.3,win*on,aa)*.78*alive;
          float corner=smoothstep(w*.5-.75,w*.5-.2,abs(u));
          float top=smoothstep(vSize.y-1.3,vSize.y-.35,vL.y);
          emit+=accent*(corner+top)*(kind>.5?1.15:.17*glow)*alive;
          if(kind>.5){ float y=vL.y/vSize.y; float scan=smoothstep(.985,1.,sin(y*26.-uTime*2.2+seed*9.)); emit+=uFriendly*scan*.75*alive; } // the six: a scan climbs them
          emit+=accent*pow(1.-abs(dot(n,normalize(cameraPosition-vW))),3.)*.11*alive;   // glass catches light at a glancing angle
          emit+=uGround*exp(-vW.y*.16)*.05;                                             // street light spills up the first storeys
          col*=.55+.45*smoothstep(0.,26.,vW.y);
        }
        emit+=uEnemy*vState*(1.-vState)*5.+uEnemy*.22*step(.95,vState)*exp(-vW.y*.12)*(.6+.4*sin(uTime*7.+seed*50.)); // falling glows; a stump smoulders
        col+=blastLight(vW,n)*.55+emit;
        if(uMirror>.5) col*=.8*exp(-vW.y*.0125);                              // the reflection: strongest at the kerb, gone by the rooftops
        gl_FragColor=vec4(fogged(col,dist),1.);
      }`,
  });
  const buildings = new THREE.Mesh(bGeo, makeBuildingMat(false)); buildings.frustumCulled = false; scene.add(buildings);
  const mirrored = new THREE.Mesh(bGeo, makeBuildingMat(true)); mirrored.frustumCulled = false; scene.add(mirrored);   // the same city, hung upside-down beneath the see-through avenues

  // ---------------------------------------------------------------- beams: every line of light
  const MAXBEAM = 420;
  const beamGeo = new THREE.InstancedBufferGeometry(); { const q = new THREE.PlaneGeometry(1, 1); beamGeo.index = q.index; beamGeo.setAttribute('position', q.getAttribute('position')); }
  const beA = new THREE.InstancedBufferAttribute(new Float32Array(MAXBEAM * 3), 3), beB = new THREE.InstancedBufferAttribute(new Float32Array(MAXBEAM * 3), 3);
  const beC = new THREE.InstancedBufferAttribute(new Float32Array(MAXBEAM * 4), 4), beP = new THREE.InstancedBufferAttribute(new Float32Array(MAXBEAM * 4), 4);
  for (const a of [beA, beB, beC, beP]) a.setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute('aStart', beA); beamGeo.setAttribute('aEnd', beB); beamGeo.setAttribute('aColor', beC); beamGeo.setAttribute('aParam', beP); beamGeo.instanceCount = 0;
  const beams = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    uniforms: shared('uTime', 'uPxScale'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aStart,aEnd; attribute vec4 aColor,aParam; uniform float uPxScale;
      varying vec2 vUv; varying vec4 vColor; varying vec3 vP;
      void main(){
        float t=position.y+.5; vec3 c=mix(aStart,aEnd,t), dir=aEnd-aStart; float len=length(dir); dir/=max(len,1e-4);
        vec3 side=normalize(cross(dir,normalize(cameraPosition-c))+vec3(1e-5));
        float w=max(aParam.x,length(cameraPosition-c)*uPxScale*2.1);                    // never thinner than a pixel and a bit: no shimmer
        vUv=vec2(position.x+.5,t); vColor=vec4(aColor.rgb,clamp(aParam.x/w,.62,1.)); vP=vec3(aColor.a,aParam.y,aParam.z*len);
        gl_Position=projectionMatrix*viewMatrix*vec4(c+side*position.x*w,1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec4 vColor; varying vec3 vP; uniform float uTime;
      void main(){
        float prof=1.-abs(vUv.x*2.-1.); prof=prof*prof*(3.-2.*prof);
        float a=mix(vP.y,vP.x,vUv.y)*vColor.a;                                           // tail alpha → head alpha
        if(vP.z>0.) a*=.25+.75*step(.5,fract(vUv.y*vP.z-uTime*1.6));                     // a dashed beam crawls toward its head
        vec3 col=vColor.rgb*(1.+1.6*pow(prof,6.));                                       // a white-ish spine
        gl_FragColor=vec4(col,a*prof);
      }`,
  }));
  beams.frustumCulled = false; beams.renderOrder = 5; scene.add(beams);

  // ---------------------------------------------------------------- sprites: every point of light
  const MAXSPR = 1500;
  const sprGeo = new THREE.InstancedBufferGeometry(); { const q = new THREE.PlaneGeometry(1, 1); sprGeo.index = q.index; sprGeo.setAttribute('position', q.getAttribute('position')); }
  const spP = new THREE.InstancedBufferAttribute(new Float32Array(MAXSPR * 4), 4), spC = new THREE.InstancedBufferAttribute(new Float32Array(MAXSPR * 4), 4);
  spP.setUsage(THREE.DynamicDrawUsage); spC.setUsage(THREE.DynamicDrawUsage);
  sprGeo.setAttribute('aPos', spP); sprGeo.setAttribute('aCol', spC); sprGeo.instanceCount = 0;
  const sprites = new THREE.Mesh(sprGeo, new THREE.ShaderMaterial({
    uniforms: shared('uPxScale'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aPos,aCol; uniform float uPxScale; varying vec2 vUv; varying vec4 vCol;
      void main(){ vec4 mv=viewMatrix*vec4(aPos.xyz,1.); float base=abs(aPos.w), s=aPos.w<0.?base:max(base,-mv.z*uPxScale*4.2); mv.xy+=position.xy*s;
        vUv=position.xy*2.; vCol=vec4(aCol.rgb,aCol.a*clamp(base/s,.6,1.)); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec4 vCol;
      void main(){ float d=length(vUv); float a=exp(-d*d*4.2)*(1.-smoothstep(.82,1.,d)); gl_FragColor=vec4(vCol.rgb*(1.+2.4*exp(-d*d*42.)),a*vCol.a); }`,
  }));
  sprites.frustumCulled = false; sprites.renderOrder = 6; scene.add(sprites);

  // ---------------------------------------------------------------- blast shells: the original's colour-cycling circle, as a sphere
  const blastMat = () => new THREE.ShaderMaterial({
    uniforms: { uRim: { value: new V3(1, 1, 1) }, uCore: { value: new V3(1, 1, 1) }, uT: { value: 0 }, uFade: { value: 1 }, uSeed: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN,vV,vO; void main(){ vO=position; vec4 w=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=cameraPosition-w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      varying vec3 vN,vV,vO; uniform vec3 uRim,uCore; uniform float uT,uFade,uSeed;
      void main(){ float ndv=abs(dot(normalize(vN),normalize(vV))); float fres=pow(1.-ndv,1.7);
        float n=sin(vO.x*7.+uT*5.+uSeed)*sin(vO.y*9.-uT*4.)*sin(vO.z*8.+uT*3.+uSeed*2.);
        vec3 col=uRim*(fres*2.5+.09)*(.74+.26*n)+uCore*ndv*ndv*ndv*.26;   // the rim carries the colour; too much core and ACES turns the whole disc white
        gl_FragColor=vec4(col*uFade,1.); }`,
  });
  const MAXBLAST = 22, sphere = new THREE.IcosahedronGeometry(1, 4);
  const shells = Array.from({ length: MAXBLAST }, () => { const m = new THREE.Mesh(sphere, blastMat()); m.visible = false; m.frustumCulled = false; m.renderOrder = 4; scene.add(m); return m; });

  // ---------------------------------------------------------------- the craft: a dark dart with lit edges
  const dart = (() => { const v = [[0, 0, 2.6], [-2.0, -0.05, -1.5], [2.0, -0.05, -1.5], [0, 0.1, -0.9], [0, 0.62, -0.5], [0, -0.3, -0.4]], faces = [[0, 4, 1], [0, 2, 4], [1, 4, 3], [4, 2, 3], [0, 1, 5], [0, 5, 2], [1, 3, 5], [5, 3, 2]];
    const g = new THREE.BufferGeometry(), pos = []; for (const f of faces) for (const i of f) pos.push(...v[i]); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return { g, edges: new THREE.EdgesGeometry(g, 1) }; })();
  const hullMat = key => new THREE.ShaderMaterial({ uniforms: shared(key, ...LIGHT), side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW,vN; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: GLSL_COMMON + `varying vec3 vW,vN; uniform vec3 ${key};
      void main(){ vec3 n=normalize(vN), v=normalize(cameraPosition-vW); float fr=pow(1.-abs(dot(n,v)),2.);
        gl_FragColor=vec4(vec3(.016,.02,.028)+${key}*fr*.55+blastLight(vW,n)*.7,1.); }` });
  const edgeMat = key => new THREE.ShaderMaterial({ uniforms: shared(key), vertexShader: `void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: `uniform vec3 ${key}; void main(){ gl_FragColor=vec4(${key}*2.4,1.); }` });
  const craft = new THREE.Group(); craft.add(new THREE.Mesh(dart.g, hullMat('uFriendly')), new THREE.LineSegments(dart.edges, edgeMat('uFriendly'))); scene.add(craft);
  // the enemy flies the same dart, stretched into a bomber's wing or left small for a raider
  const enemyHull = hullMat('uEnemy'), enemyEdge = edgeMat('uEnemy'), PLANE = { bomber: new V3(11, 4.2, 5.4), raider: new V3(3.6, 2.4, 3.3) };
  const planes = Array.from({ length: 14 }, () => { const g = new THREE.Group(); g.add(new THREE.Mesh(dart.g, enemyHull), new THREE.LineSegments(dart.edges, enemyEdge)); g.visible = false; scene.add(g); return g; });

  // ---------------------------------------------------------------- pickups (rings) and jammers (mines): small pools of plain meshes
  const glowMat = key => new THREE.ShaderMaterial({ uniforms: { ...shared(key), uK: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: `uniform vec3 ${key}; uniform float uK; void main(){ gl_FragColor=vec4(${key}*uK,1.); }` });
  const ringGeo = new THREE.TorusGeometry(4.6, 0.34, 8, 40);
  const rings = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(ringGeo, glowMat('uFriendly')); m.material.uniforms.uK.value = 1.7; m.visible = false; m.renderOrder = 3; scene.add(m); return m; });
  const mineGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.2, 0));
  const mines = Array.from({ length: 10 }, () => { const m = new THREE.LineSegments(mineGeo, glowMat('uEnemy')); m.material.uniforms.uK.value = 2.2; m.visible = false; m.renderOrder = 3; scene.add(m); return m; });
  const padRings = Array.from({ length: 3 }, () => { const m = new THREE.Mesh(new THREE.RingGeometry(5.2, 6.4, 40).rotateX(-Math.PI / 2), glowMat('uFriendly')); m.visible = false; m.renderOrder = 3; scene.add(m); return m; });

  // ---------------------------------------------------------------- city
  let city = null;
  function buildCity(level, paletteHex) {
    setPalette(paletteHex);
    const r = rng(9176 + level * 7919), tpl = CIRCUITS[(level - 1) % CIRCUITS.length], s = ((level - 1) * 3 + (level >> 1)) % 8;
    const symA = symmetry(s, GRID.N / 2), symB = symmetry(s, (GRID.N - 1) / 2);
    const lattice = tpl.path.map(symA), towerBlocks = tpl.towers.map(symB), camp = symB(tpl.camp);
    const key = ([i, j]) => i + ',' + j, reserved = new Map(towerBlocks.map((b, i) => [key(b), i])); reserved.set(key(camp), 'camp');

    let n = 0; const list = [], towers = [];
    const add = (x, y, z, w, h, d, kind, glow) => { if (n >= MAXB) return -1; bPos.setXYZ(n, x, y, z); bSize.setXYZ(n, w, h, d); bMisc.setXYZW(n, r(), kind, glow, 0); bState.setX(n, 0); return n++; };

    for (let i = 0; i < GRID.N; i++) for (let j = 0; j < GRID.N; j++) {
      const cx = blockAt(i), cz = blockAt(j), what = reserved.get(key([i, j]));
      if (what === 'camp') { add(cx, 0, cz, 40, 1.6, 40, 2, 1); continue; }
      if (what !== undefined) { towers[what] = landmark(what, cx, cz, r, add); continue; }
      const f = 1 - clamp(Math.hypot(cx, cz) / (GRID.half * 1.15), 0, 1), tall = lerp(46, 168, Math.pow(f, 1.15));
      const cut = r(), lots = cut < .3 ? [[0, 0, 1, 1]] : cut < .62 ? (r() < .5 ? [[-.25, 0, .5, 1], [.25, 0, .5, 1]] : [[0, -.25, 1, .5], [0, .25, 1, .5]]) : [[-.25, -.25, .5, .5], [.25, -.25, .5, .5], [-.25, .25, .5, .5], [.25, .25, .5, .5]];
      for (const [ox, oz, sw, sd] of lots) {
        if (r() < .06) continue;                                                          // an empty lot now and then
        const w = GRID.block * sw - 3 - r() * 4, d = GRID.block * sd - 3 - r() * 4, h = Math.max(14, tall * (.5 + r() * .9));
        const x = cx + ox * GRID.block, z = cz + oz * GRID.block, idx = add(x, 0, z, w, h, d, 0, .5 + r() * 1.1);
        if (idx >= 0) list.push({ idx: [idx], x, z, w, d, h });
        if (h > 70 && r() < .5) { const k = .55 + r() * .25, up = add(x, h, z, w * k, h * (.18 + r() * .22), d * k, 0, 1.2); if (up >= 0) list[list.length - 1].idx.push(up); } // a setback crown
      }
    }
    for (let k = 0; k < 230; k++) {                                                       // a low skyline beyond the grid, for depth
      const a = r() * Math.PI * 2, rad = GRID.half * 1.12 + r() * r() * 1300, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (Math.max(Math.abs(x), Math.abs(z)) < GRID.half + 18) continue;
      add(x, 0, z, 16 + r() * 34, 5 + r() * r() * 44, 16 + r() * 34, 0, .4 + r() * .6);
    }
    bGeo.instanceCount = n; for (const a of [bPos, bSize, bMisc, bState]) a.needsUpdate = true;

    // base camp: three pads and the uplink mast
    const bx = blockAt(camp[0]), bz = blockAt(camp[1]);
    const pads = [[-13, -7], [0, 11], [13, -7]].map(([dx, dz], id) => ({ id, pos: new V3(bx + dx, 1.8, bz + dz) }));
    pads.forEach((p, i) => { padRings[i].position.copy(p.pos); padRings[i].visible = true; });
    const mast = new V3(bx, 46, bz); add(bx, 1.6, bz, 1.6, 44, 1.6, 1, 1); bGeo.instanceCount = n; bPos.needsUpdate = bSize.needsUpdate = bMisc.needsUpdate = true;

    // the route: round every lattice corner, keep the legs straight, then give it a rise and fall
    const pts = [], L = lattice.length, CUT = 20;
    for (let i = 0; i < L; i++) {
      const p = lattice[i], a = lattice[(i + L - 1) % L], b = lattice[(i + 1) % L], P = new V3(aveAt(p[0]), 0, aveAt(p[1]));
      const din = new V3(Math.sign(p[0] - a[0]), 0, Math.sign(p[1] - a[1])), dout = new V3(Math.sign(b[0] - p[0]), 0, Math.sign(b[1] - p[1]));
      pts.push(P.clone().addScaledVector(din, -CUT - 22), P.clone().addScaledVector(din, -CUT), P.clone().addScaledVector(dout, CUT), P.clone().addScaledVector(dout, CUT + 22));
      const legs = Math.abs(b[0] - p[0]) + Math.abs(b[1] - p[1]);
      for (let m = 1; m < legs; m++) pts.push(P.clone().addScaledVector(dout, m * GRID.pitch));
    }
    let run = 0; const at = [0]; for (let i = 1; i < pts.length; i++) at.push(run += pts[i].distanceTo(pts[i - 1])); run += pts[0].distanceTo(pts[pts.length - 1]);
    const ph = r() * 6.28; pts.forEach((p, i) => { const f = at[i] / run; p.y = Math.max(15, 30 + 15 * Math.sin(6.283 * 2 * f + ph) + 9 * Math.sin(6.283 * 5 * f + ph * 2) + 46 * smooth(clamp(1 - Math.abs(f - .7) / .13, 0, 1))); });
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'); curve.arcLengthDivisions = 1600; const length = curve.getLength();
    // THE HIGH ROAD. Above the rooftops nothing needs a right angle: the same circuit, low-passed into one long easy loop. Its control
    // points are samples at EQUAL distances along the street route, so parameter t on it is the same place as distance-fraction u below.
    const M = 400, zig = Array.from({ length: M }, (_, i) => curve.getPointAt(i / M)), WIN = 26, soft = [];
    for (let i = 0; i < M; i += 5) { let x = 0, z = 0; for (let k = -WIN; k <= WIN; k++) { const q = zig[(i + k + M) % M]; x += q.x; z += q.z; } soft.push(new V3(x / (2 * WIN + 1), 0, z / (2 * WIN + 1))); }
    const high = new THREE.CatmullRomCurve3(soft, true, 'centripetal'), hp = new V3(), ht = new V3();
    const route = { length, curve,
      frame(u, P, T) { return route.frameAt(u, 0, P, T); },
      frameAt(u, s, P, T) { u = ((u % 1) + 1) % 1; curve.getPointAt(u, P); curve.getTangentAt(u, T); if (s > 0) { const y = P.y; high.getPoint(u, hp); high.getTangent(u, ht).normalize(); P.lerp(hp, s); P.y = y; T.lerp(ht, s).normalize(); } return route; },
      map: Array.from({ length: 160 }, (_, i) => { const p = curve.getPointAt(i / 160); return [p.x, p.z]; }) };

    fires.length = 0; anims.length = 0; particles.n = 0; flashes.length = 0; pulses.length = 0;
    wing[0].length = wing[1].length = 0; camReady = false;                              // a new city: no ribbon or camera glide from the last one
    city = { level, half: GRID.half, towers, pads, mast, buildings: list, route };
    return city;
  }
  // The six. Each is a stack of boxes that rises, sets back, and ends in something to remember it by.
  function landmark(id, x, z, r, add) {
    const H = 165 + r() * 70, idx = [], tier = (y, w, h, d, ox = 0, oz = 0) => { const i = add(x + ox, y, z + oz, w, h, d, 1, 1); if (i >= 0) idx.push(i); };
    if (id % 6 === 0) { tier(0, 38, H * .5, 38); tier(H * .5, 28, H * .3, 28); tier(H * .8, 17, H * .2, 17); tier(H, 2.2, 52, 2.2); }
    else if (id % 6 === 1) { tier(0, 17, H, 34, -11); tier(0, 17, H * .9, 34, 11); tier(H * .55, 8, 7, 12); }
    else if (id % 6 === 2) { for (let k = 0; k < 5; k++) tier(H * .2 * k, 40 - k * 7, H * .2, 40 - k * 7); tier(H, 1.8, 30, 1.8); }
    else if (id % 6 === 3) { tier(0, 30, H * .42, 30); tier(H * .42, 23, H * .3, 23); tier(H * .72, 15, H * .2, 15); tier(H * .92, 7, H * .13, 7); }
    else if (id % 6 === 4) { tier(0, 24, H * .84, 24); tier(H * .84, 40, H * .07, 40); tier(H * .91, 30, H * .09, 30); }
    else { tier(0, 12, H, 40); tier(0, 28, H * .62, 10, 0, -14); tier(H, 1.6, 40, 1.6); }
    return { id, x, z, h: H, top: new V3(x, H * .93, z), idx, alive: true };
  }
  function setPalette([g, f, e]) {
    pal.ground.set(g); pal.friendly.set(f); pal.enemy.set(e);
    U.uFogColor.value.copy(pal.ground).multiplyScalar(.014).add(pal.friendly.clone().multiplyScalar(.006));
  }

  // ---------------------------------------------------------------- collapses, fires, particles
  const anims = [], fires = [];
  function collapse(idx, at) { anims.push({ idx, t: 0, dir: 1 }); if (at) fires.push({ pos: at.clone(), t: 0 }); }
  function rebuild(idx, at) { anims.push({ idx, t: 0, dir: -1 }); const k = fires.findIndex(f => at && f.pos.distanceToSquared(at) < 4); if (k >= 0) fires.splice(k, 1); }

  const MAXP = 900, particles = { n: 0, p: new Float32Array(MAXP * 3), v: new Float32Array(MAXP * 3), c: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), span: new Float32Array(MAXP), size: new Float32Array(MAXP), g: new Float32Array(MAXP) };
  function spark(x, y, z, vx, vy, vz, col, life, size, grav = 34) {
    const P = particles; let i = P.n < MAXP ? P.n++ : Math.floor(Math.random() * MAXP);
    P.p[i * 3] = x; P.p[i * 3 + 1] = y; P.p[i * 3 + 2] = z; P.v[i * 3] = vx; P.v[i * 3 + 1] = vy; P.v[i * 3 + 2] = vz;
    P.c[i * 3] = col.r; P.c[i * 3 + 1] = col.g; P.c[i * 3 + 2] = col.b; P.life[i] = P.span[i] = life; P.size[i] = size; P.g[i] = grav;
  }
  function burst(pos, colorKey, count, speed, life = .9, size = 1.6, grav = 34) {
    const col = pal[colorKey] || pal.friendly;
    for (let i = 0; i < count; i++) { const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), s = speed * (.35 + Math.random() * .85);
      spark(pos.x, pos.y, pos.z, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s, col, life * (.5 + Math.random() * .8), size * (.6 + Math.random() * .8), grav); }
  }
  const flashes = []; function flash(pos, colorKey, size, life = .22) { flashes.push({ pos: pos.clone(), key: colorKey, size, life, t: 0 }); }
  const pulses = []; function pulse() { pulses.push({ t: 0 }); }
  let shakeAmt = 0; function shake(a) { shakeAmt = Math.min(3.2, shakeAmt + a); }

  // ---------------------------------------------------------------- per-frame sync
  let nb = 0, ns = 0;
  const beam = (a, b, col, aHead, aTail, width, dash = 0, k = 1) => { if (nb >= MAXBEAM) return; beA.setXYZ(nb, a.x, a.y, a.z); beB.setXYZ(nb, b.x, b.y, b.z); beC.setXYZW(nb, col.r * k, col.g * k, col.b * k, aHead); beP.setXYZW(nb, width, aTail, dash, 0); nb++; };
  const spr = (p, size, col, a, k = 1) => { if (ns >= MAXSPR) return; spP.setXYZW(ns, p.x, p.y, p.z, size); spC.setXYZW(ns, col.r * k, col.g * k, col.b * k, a); ns++; };
  const WHITE = new THREE.Color(1, 1, 1), tmpA = new V3(), tmpB = new V3(), tmpC = new V3(), camP = new V3(), camT = new V3(), look = new V3(), lookNow = new V3(0, 40, 0), camNow = new V3(0, 60, -200);
  const wing = [[], []], lights = [], basis = new THREE.Matrix4(); let camReady = false, trailClock = 0;
  const blastColour = b => b.hostile ? pal.enemy : (b.age / b.life < .2 ? pal.friendly : b.age / b.life < .6 ? pal.ground : pal.enemy);  // the original's three phases

  function sync(S, dt, view) {
    U.uTime.value += dt; nb = 0; ns = 0; lights.length = 0;
    const t = U.uTime.value, c = S.craft, route = city.route;

    // craft and camera. The camera rides the ROUTE a little way behind — never the craft's tangent — so it cannot swing through a corner block.
    route.frameAt(c.u - 15 / route.length, c.s, camP, camT);
    const R = tmpA.crossVectors(camT, THREE.Object3D.DEFAULT_UP).normalize(), Uv = tmpB.crossVectors(R, camT).normalize();
    camP.addScaledVector(R, c.ox - clamp(c.ox * .18, -1.5, 1.5)).addScaledVector(Uv, c.oy - clamp(c.oy * .1, -1.2, 1.2) + 4.2 + c.s * 5);
    const tip = smooth(clamp((c.pos.y - 130) / 300, 0, 1));                               // down in the canyon you look up at the raid; over the city you look down on it
    look.copy(c.pos).addScaledVector(c.T, 60).addScaledVector(c.U, lerp(25, -30, tip) + (view.lookY + view.leanY) * 52).addScaledVector(c.R, (view.lookX + view.leanX) * 70);
    const k = camReady ? 1 - Math.exp(-dt * 7) : 1; camNow.lerp(camP, k); lookNow.lerp(look, camReady ? 1 - Math.exp(-dt * 5) : 1); camReady = true;
    camera.position.copy(camNow); if (shakeAmt > .01) { camera.position.x += (Math.random() - .5) * shakeAmt; camera.position.y += (Math.random() - .5) * shakeAmt; shakeAmt *= Math.exp(-dt * 5); }
    camera.up.set(0, 1, 0).addScaledVector(c.R, -c.roll * .2).normalize(); camera.lookAt(lookNow);   // the craft banks hard; the horizon only leans — you have to aim through this
    sky.position.copy(camera.position);
    craft.visible = !view.hideCraft; craft.position.copy(c.pos);
    craft.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tmpC.copy(c.R).negate(), c.U, c.T)); craft.rotateZ(c.roll); craft.rotateX(-c.pitch);

    if (!view.hideCraft) {                                                               // engines and wingtip ribbons
      const tail = tmpA.copy(c.pos).addScaledVector(c.T, -1.7); spr(tail, 1.3, pal.friendly, .9, 1.5); spr(tail, 3.6, pal.friendly, .14);
      trailClock += dt; if (trailClock > .028) { trailClock = 0; craft.updateMatrixWorld(true); for (let s = 0; s < 2; s++) { const w = craft.localToWorld(new V3(s ? 2 : -2, -.05, -1.5)); wing[s].unshift(w); if (wing[s].length > 22) wing[s].pop(); } }
      for (let s = 0; s < 2; s++) for (let i = 1; i < wing[s].length; i++) { const f = 1 - i / wing[s].length; beam(wing[s][i], wing[s][i - 1], pal.friendly, .5 * f, .5 * f, .42 * f + .08); }
    }

    // the tether: craft → mast, an arc of crawling dashes. Jammed, it turns enemy-coloured and stutters.
    if (!view.hideCraft) {
      const jam = S.linkLost > 0, col = jam ? pal.enemy : pal.friendly, a = c.pos, b = city.mast, mid = tmpA.lerpVectors(a, b, .5); mid.y += a.distanceTo(b) * .2 + 18;
      let prev = a.clone(); const SEG = 26;
      for (let i = 1; i <= SEG; i++) { const u = i / SEG, q = new V3().copy(a).multiplyScalar((1 - u) * (1 - u)).addScaledVector(mid, 2 * u * (1 - u)).addScaledVector(b, u * u);
        const near = smooth(clamp((u - .02) / .3, 0, 1)), al = (jam ? .45 : .22) * near;               // it fades in over its first third: the near end passes right by the lens
        if (al > .004 && (!jam || Math.sin(i * 12.9 + t * 31) > -.2)) beam(prev, q, col, al, al, .3, .3); prev = q; }
      for (let i = pulses.length - 1; i >= 0; i--) { const p = pulses[i]; p.t += dt / .22; if (p.t >= 1) { pulses.splice(i, 1); continue; } const u = p.t;
        spr(new V3().copy(a).multiplyScalar((1 - u) * (1 - u)).addScaledVector(mid, 2 * u * (1 - u)).addScaledVector(b, u * u), 1.1 + 7 * u, WHITE, .9, 1.4); }   // born small: it starts fifteen units from the lens
      spr(b, 7 + Math.sin(t * 5) * 1.2, col, .85, 1.4);
    }

    // base camp
    city.pads.forEach((p, i) => { const pad = S.pads[i], on = pad && pad.alive; padRings[i].material.uniforms.uK.value = on ? 1.5 + .4 * Math.sin(t * 3 + i) : .12;
      if (on) beam(p.pos, tmpA.set(p.pos.x, 330, p.pos.z), pal.friendly, 0, .28, 2.4); });

    // the six: a beacon over each that stands, a fire in each that has fallen
    for (const tw of S.towers) if (tw.alive) { const warn = tw.threat < 5; spr(tmpA.set(tw.x, tw.h + 16, tw.z), warn ? 12 + 5 * Math.sin(t * 16) : 8, warn ? pal.enemy : pal.friendly, .85, 1.4); beam(tmpA.set(tw.x, tw.h, tw.z), tmpB.set(tw.x, tw.h + 120, tw.z), warn ? pal.enemy : pal.friendly, 0, .3, 1.5); }
    for (const f of fires) { f.t += dt; const fl = .7 + .3 * Math.sin(t * 11 + f.pos.x); spr(tmpA.set(f.pos.x, 9, f.pos.z), 30, pal.enemy, .42 * fl); spr(tmpA.set(f.pos.x, 5, f.pos.z), 12, pal.ground, .5 * fl);
      if (Math.random() < dt * 9) spark(f.pos.x + (Math.random() - .5) * 18, 3, f.pos.z + (Math.random() - .5) * 18, (Math.random() - .5) * 4, 9 + Math.random() * 12, (Math.random() - .5) * 4, pal.enemy, 1.6 + Math.random(), 1.3, -3);
      lights.push({ p: tmpA.set(f.pos.x, 14, f.pos.z).clone(), r: 70, col: pal.enemy, k: .55 * fl, rank: .55 }); }                  // ranked by STEADY power, so the flicker never reshuffles the slots

    // the raid
    let pi = 0;
    for (const e of S.enemies) {
      if (e.type === 'satellite') { const d = tmpA.copy(e.vel).normalize(), rgt = tmpB.set(-d.z, 0, d.x);
        beam(tmpC.copy(e.pos).addScaledVector(rgt, -16), new V3().copy(e.pos).addScaledVector(rgt, 16), pal.enemy, 1, 1, 5, 0, 1.2); beam(tmpC.copy(e.pos).addScaledVector(d, -5), new V3().copy(e.pos).addScaledVector(d, 5), pal.ground, 1, 1, 4, 0, 1.3);
        spr(e.pos, 14, pal.enemy, .55); continue; }
      if (e.type === 'bomber' || e.type === 'raider') { const big = e.type === 'bomber', d = tmpA.copy(e.vel).normalize(), rgt = tmpB.crossVectors(d, THREE.Object3D.DEFAULT_UP).normalize(), up = tmpC.crossVectors(rgt, d).normalize();
        if (pi < planes.length) { const m = planes[pi++]; m.visible = true; m.position.copy(e.pos); m.scale.copy(PLANE[e.type]); m.quaternion.setFromRotationMatrix(basis.makeBasis(rgt.clone().negate(), up, d)); m.rotateZ(e.bank || 0); }
        const span = big ? 21 : 6.8, back = big ? 8 : 4.6, tail = new V3().copy(e.pos).addScaledVector(d, -back);
        spr(tail, big ? 7 : 3.4, pal.enemy, .95, 1.7); spr(tail, big ? 20 : 9, pal.enemy, .3);
        e.ribbon = e.ribbon || [[], []]; e.ribbonClock = (e.ribbonClock || 0) + dt;
        if (e.ribbonClock > .07) { e.ribbonClock = 0; for (let k = 0; k < 2; k++) { e.ribbon[k].unshift(new V3().copy(tail).addScaledVector(rgt, k ? span : -span)); if (e.ribbon[k].length > 24) e.ribbon[k].pop(); } }
        for (let k = 0; k < 2; k++) for (let i = 1; i < e.ribbon[k].length; i++) { const f = 1 - i / e.ribbon[k].length; beam(e.ribbon[k][i], e.ribbon[k][i - 1], pal.enemy, .55 * f, .55 * f, (big ? 1.5 : .8) * f + .2); }
        continue; }
      const smart = e.type === 'smart'; beam(e.origin, e.pos, smart ? pal.ground : pal.enemy, .95, .1, smart ? 1.0 : 1.5);
      spr(e.pos, smart ? 7 : 5, WHITE, 1, 1.5); spr(e.pos, smart ? 17 : 13, smart ? pal.ground : pal.enemy, .55);
    }
    for (; pi < planes.length; pi++) planes[pi].visible = false;
    for (const tr of S.trails) beam(tr.a, tr.b, pal.enemy, .9 * tr.life / .45, .08 * tr.life / .45, 1.5);
    for (const s of S.shots) { beam(s.from, s.pos, pal.friendly, 1, .06, 1.3); spr(s.pos, 5.5, WHITE, 1, 1.6); spr(s.pos, 14, pal.friendly, .5); }

    // blasts: a shell, a core, a light
    let bi = 0;
    for (const b of S.blasts) { if (b.r <= 0) continue; const col = blastColour(b), u = b.age / b.life;
      if (bi < MAXBLAST) { const m = shells[bi++], mu = m.material.uniforms; m.visible = true; m.position.copy(b.pos); m.scale.setScalar(b.r); mu.uRim.value.set(col.r, col.g, col.b); const core = b.hostile ? pal.ground : pal.friendly; mu.uCore.value.set(core.r, core.g, core.b); mu.uT.value = t; mu.uSeed.value = b.seed; mu.uFade.value = 1; }
      if (!b.hostile && u > .22 && u < .75 && bi < MAXBLAST) { const m = shells[bi++], mu = m.material.uniforms; m.visible = true; m.position.copy(b.pos); m.scale.setScalar(b.r * .57); mu.uRim.value.set(pal.friendly.r, pal.friendly.g, pal.friendly.b); mu.uCore.value.set(1, 1, 1); mu.uT.value = t + 3; mu.uSeed.value = b.seed + 1; mu.uFade.value = .55; } // the original's inner disc
      spr(b.pos, b.r * 2.9, col, .1);
      lights.push({ p: b.pos, r: b.max * 3.4, col, k: 2.6 * b.r / b.max, rank: 2.6 * b.r / b.max }); }
    for (; bi < MAXBLAST; bi++) shells[bi].visible = false;
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t += dt; if (f.t >= f.life) { flashes.splice(i, 1); continue; } const u = f.t / f.life; spr(f.pos, f.size * (.5 + u), f.key === 'white' ? WHITE : pal[f.key], (1 - u) * (1 - u), 2); }

    // pickups and jammers
    rings.forEach((m, i) => { const p = S.pickups[i]; m.visible = !!p && !p.taken; if (m.visible) { m.position.copy(p.pos); m.lookAt(tmpA.copy(p.pos).add(p.T)); m.rotateZ(t * 1.4); spr(p.pos, 6, pal.friendly, .5); } });
    mines.forEach((m, i) => { const p = S.mines[i]; m.visible = !!p && !p.hit; if (m.visible) { m.position.copy(p.pos); m.rotation.set(t * .7, t * 1.1 + i, 0); m.scale.setScalar(1 + .12 * Math.sin(t * 6 + i)); spr(p.pos, 9, pal.enemy, .55); } });

    for (const m of MOTES) { const x = ((m.x - camera.position.x) % 180 + 180) % 180 - 90, y = ((m.y - camera.position.y) % 100 + 100) % 100 - 50, z = ((m.z - camera.position.z) % 180 + 180) % 180 - 90;
      const d2 = x * x + y * y + z * z; if (d2 < 100) continue;                                  // never near the lens: a speck a unit away is a hundred pixels wide, and the near plane cuts it into a triangle
      spr(tmpA.set(camera.position.x + x, camera.position.y + y, camera.position.z + z), -.2, WHITE, .34 * Math.min(1, (d2 - 100) / 300) * (1 - Math.min(1, d2 / 8100))); }
    lens.uniforms.uTime.value = t;

    // particles
    const P = particles; for (let i = 0; i < P.n; i++) { P.life[i] -= dt; if (P.life[i] <= 0) { const l = --P.n; if (i !== l) { for (const a of [P.p, P.v, P.c]) { a[i * 3] = a[l * 3]; a[i * 3 + 1] = a[l * 3 + 1]; a[i * 3 + 2] = a[l * 3 + 2]; } P.life[i] = P.life[l]; P.span[i] = P.span[l]; P.size[i] = P.size[l]; P.g[i] = P.g[l]; } i--; continue; }
      const drag = Math.exp(-dt * 1.4); P.v[i * 3] *= drag; P.v[i * 3 + 1] = P.v[i * 3 + 1] * drag - P.g[i] * dt; P.v[i * 3 + 2] *= drag;
      P.p[i * 3] += P.v[i * 3] * dt; P.p[i * 3 + 1] += P.v[i * 3 + 1] * dt; P.p[i * 3 + 2] += P.v[i * 3 + 2] * dt; if (P.p[i * 3 + 1] < .3 && P.g[i] > 0) { P.p[i * 3 + 1] = .3; P.v[i * 3 + 1] *= -.35; }
      if (ns < MAXSPR) { const f = P.life[i] / P.span[i]; spP.setXYZW(ns, P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2], P.size[i] * (.4 + .6 * f)); spC.setXYZW(ns, P.c[i * 3] * 1.5, P.c[i * 3 + 1] * 1.5, P.c[i * 3 + 2] * 1.5, f); ns++; } }

    // collapses and rebuilds
    for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]; a.t += dt / (a.dir > 0 ? 2.3 : 1.6); const s = clamp(a.t, 0, 1), v = a.dir > 0 ? s : 1 - s; for (const k of a.idx) bState.setX(k, v); bState.needsUpdate = true; if (a.t >= 1) anims.splice(i, 1); }

    // the eight strongest lights win the slots
    lights.sort((a, b) => b.rank - a.rank);
    for (let i = 0; i < 8; i++) { const L = lights[i]; if (L) { U.uLightPos.value[i].set(L.p.x, L.p.y, L.p.z, L.r); U.uLightCol.value[i].set(L.col.r * L.k, L.col.g * L.k, L.col.b * L.k); } else U.uLightPos.value[i].set(0, 0, 0, 0); }

    beamGeo.instanceCount = nb; for (const a of [beA, beB, beC, beP]) a.needsUpdate = true;
    sprGeo.instanceCount = ns; spP.needsUpdate = spC.needsUpdate = true;
  }

  // ---------------------------------------------------------------- size, render, picking
  let W = 1, H = 1, ratio = 1;
  function resize(w, h, pixelRatio) {
    W = Math.max(1, w); H = Math.max(1, h); ratio = pixelRatio;
    renderer.setPixelRatio(ratio); renderer.setSize(W, H, false); composer.setPixelRatio(ratio); composer.setSize(W, H);
    camera.aspect = W / H; camera.fov = W / H < 1.5 ? 80 : 72; camera.updateProjectionMatrix();
    U.uPxScale.value = 2 * Math.tan(camera.fov * Math.PI / 360) / H;                     // world units per CSS pixel, at distance 1
    bloom.strength = lowEnd ? .5 : .58;
  }
  function render() { composer.render(); }
  const ndc = new V3(), rayO = new V3(), rayD = new V3();
  function project(v, out = {}) { ndc.copy(v).project(camera); out.x = (ndc.x * .5 + .5) * W; out.y = (-ndc.y * .5 + .5) * H; out.behind = ndc.z > 1; out.on = !out.behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1; return out; }
  function ray(px, py) { rayD.set(px / W * 2 - 1, -(py / H) * 2 + 1, .5).unproject(camera).sub(camera.position).normalize(); rayO.copy(camera.position); return { o: rayO, d: rayD }; }

  let lost = false; const lostHandlers = [];
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; lostHandlers.forEach(f => f()); });

  return { buildCity, setPalette, sync, render, resize, project, ray, collapse, rebuild, burst, flash, pulse, shake, spark,
    get city() { return city; }, get lost() { return lost; }, onLost: f => lostHandlers.push(f), camera, renderer, pal,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, beams: nb, sprites: ns, ratio }) };
}
