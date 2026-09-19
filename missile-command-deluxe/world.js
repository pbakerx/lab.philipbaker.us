// world.js — MISSILE COMMAND DELUXE: everything that is drawn.
// three.js r186, WebGPURenderer + TSL + RenderPipeline, written inside the subset that also compiles for the renderer's
// WebGL2 backend (no compute, no storage buffers, no MSAA, one pooled instanced draw per kind of thing, every material
// created once). The game (game.js) owns the simulation; this file only READS its state S each frame and reacts to a
// handful of events. Nothing here may change how the game plays.
//
// SPACE. Playfield: 1000 x 450, y down, ground line at y = 404. World: x = field x, y = 404 - field y (ground at 0,
// sky up), gameplay plane z = 0, +z toward the camera. The camera is a SHIFT LENS: it looks straight down -z from low
// over the desert floor and slides its frustum window up, so the gameplay plane is an exact, undistorted rectangle
// (the same letterbox the 2D game computes — taps keep their original maths) while the horizon sits low behind the cities.
import * as THREE from 'three/webgpu';
import {
	Fn, uniform, uniformArray, instancedDynamicBufferAttribute, instanceIndex, positionGeometry, positionWorld, normalWorld,
	uv, screenUV, vec2, vec3, vec4, float, int, mix, smoothstep, step, clamp, sin, cos, abs, max, min, pow, exp, sqrt, fract, floor, dot, length, normalize,
	hash, Loop, pass, texture,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { buildLand } from './land.js';
import { buildFx } from './fx.js';
import { buildCraft } from './craft.js';

const Q = new URLSearchParams( location.search );
const PALETTES = [ [ '#f4ec66', '#66e5ff', '#ff533e' ], [ '#f777e7', '#8bfa8b', '#f6e870' ], [ '#69e88c', '#69baff', '#ff5c80' ], [ '#75a9ff', '#f4ec66', '#ff836b' ] ]; // [ground, friendly, enemy], as in the 2D game

export async function createWorld( canvas, cfg ) {

	const { W, H, GROUND, BASE_X, CITY_X, CONFIG } = cfg;
	const fy = ( y ) => GROUND - y; // field y → world y
	const status = cfg.status || ( () => {} );

	// ── tier + backend ───────────────────────────────────────────────────────────────────────────────────────────
	// A phone gets the WebGL2 backend by default: ANGLE-on-Metal is the path iOS has run for years. ?gpu=1 opts into WebGPU
	// (Safari 26 ships it), ?gl=1 forces WebGL2 anywhere; the choice is remembered so it can be flipped once and compared.
	const HIGH = ( Q.get( 'tier' ) || ( cfg.mobile ? 'mobile' : 'high' ) ) === 'high';
	let pref = null; try { pref = localStorage.getItem( 'mcd-backend' ); } catch ( e ) {}
	if ( Q.has( 'gl' ) ) pref = 'gl'; else if ( Q.has( 'gpu' ) ) pref = 'gpu';
	try { if ( Q.has( 'gl' ) || Q.has( 'gpu' ) ) localStorage.setItem( 'mcd-backend', pref ); } catch ( e ) {}
	const forceWebGL = pref ? pref === 'gl' : !! cfg.mobile;

	const renderer = new THREE.WebGPURenderer( { canvas, antialias: false, forceWebGL, powerPreference: 'high-performance', alpha: false } );
	renderer.toneMapping = Q.get( 'tm' ) === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping; // ACES keeps fire saturated; AgX (?tm=agx) rolls it to white like a camera
	renderer.toneMappingExposure = cfg.mobile ? 1.35 : 1.0;
	const lost0 = renderer.onDeviceLost; // three's own handler logs it and stops submitting work to a dead context; after it, the game is told
	renderer.onDeviceLost = ( info ) => { try { lost0.call( renderer, info ); } catch ( e ) {} cfg.onLost && cfg.onLost( info ); };
	status( 'WAKING THE GPU…' );
	await renderer.init();
	const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0.006, 0.009, 0.02 );
	const camera = new THREE.PerspectiveCamera( 40, 2, 5, 60000 );
	const EYE = { x: W / 2, y: 48, z: 900 };
	camera.position.set( EYE.x, EYE.y, EYE.z );
	camera.lookAt( EYE.x, EYE.y, 0 );

	const uTime = uniform( 0 ); // the world's own clock (not TSL `time`, which never pauses)
	const uFlash = uniform( 1 ); // the clarity / reduced-motion profile turns the ignition flash down
	const uGround = uniform( new THREE.Color() ), uFriendly = uniform( new THREE.Color() ), uEnemy = uniform( new THREE.Color() );
	const setPalette = ( wave ) => { const p = PALETTES[ Math.floor( ( wave - 1 ) / 2 ) % PALETTES.length ]; uGround.value.set( p[ 0 ] ); uFriendly.value.set( p[ 1 ] ); uEnemy.value.set( p[ 2 ] ); };
	setPalette( 1 );

	// ── a small tiling noise texture, made once on the CPU: every "octave" in a shader is one fetch of it ───────────────
	status( 'MIXING NOISE…' );
	const noiseTex = makeNoiseTexture( 256 );
	const noise = ( p ) => texture( noiseTex, p ); // rgba: four decorrelated tiling fBm fields in 0..1

	// ── pools ────────────────────────────────────────────────────────────────────────────────────────────────────
	// One instanced draw per kind. Every instance is rewritten from the simulation each frame (they are small), dead ones
	// get zero size. Emit + occlude in one pass: (ONE, ONE_MINUS_SRC_ALPHA) — rgb is light added, alpha is light removed.
	function pool( n, itemSizes ) {
		const attrs = itemSizes.map( ( s ) => { const a = new THREE.InstancedBufferAttribute( new Float32Array( n * s ), s ); a.setUsage( THREE.DynamicDrawUsage ); return a; } );
		return { n, attrs, nodes: attrs.map( ( a ) => instancedDynamicBufferAttribute( a, 'vec' + a.itemSize ) ), used: 0,
			begin() { this.used = 0; },
			put( ...vals ) { if ( this.used >= n ) return; const i = this.used ++; for ( let k = 0; k < attrs.length; k ++ ) attrs[ k ].array.set( vals[ k ], i * attrs[ k ].itemSize ); },
			end() { for ( const a of attrs ) { a.array.fill( 0, this.used * a.itemSize ); a.needsUpdate = true; } } };
	}
	const emitOcclude = ( m ) => { m.transparent = true; m.depthWrite = false; m.depthTest = false; m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.fog = false; return m; };
	const quad = new THREE.PlaneGeometry( 1, 1 );
	const addPool = ( mat, n, order ) => { const mesh = new THREE.Mesh( quad, mat ); mesh.count = n; mesh.frustumCulled = false; mesh.renderOrder = order; scene.add( mesh ); return mesh; };

	// LINES — trails, tracers, the target X, the selected-base bar. a→b in the gameplay plane.
	//   seg = ax, ay, bx, by · style = width, z, headBias (0 flat … 1 bright at b, faint at a), darkAlpha · col = rgb, intensity
	const LINES = pool( 1400, [ 4, 4, 4 ] );
	{
		const [ seg, style, col ] = LINES.nodes;
		const m = emitOcclude( new THREE.MeshBasicNodeMaterial() );
		m.positionNode = Fn( () => {
			const a = seg.xy, d = seg.zw.sub( a ), len = d.length().max( 1e-4 ), dir = d.div( len ), nrm = vec2( dir.y.negate(), dir.x );
			const p = a.add( d.mul( positionGeometry.x.add( 0.5 ) ) ).add( nrm.mul( positionGeometry.y ).mul( style.x ) );
			return vec3( p, style.y );
		} )();
		const colV = col.toVarying(), styleV = style.toVarying();
		m.colorNode = Fn( () => {
			const across = abs( uv().y.sub( 0.5 ) ).mul( 2 ); // 0 centre … 1 edge
			const core = smoothstep( 1.0, 0.25, across );
			const along = mix( float( 1 ), pow( uv().x.clamp( 0, 1 ), 2.2 ).mul( 0.92 ).add( 0.08 ), styleV.z );
			const light = colV.rgb.mul( colV.w ).mul( core ).mul( along );
			return vec4( light, styleV.w.mul( smoothstep( 1.0, 0.55, across ) ) );
		} )();
		addPool( m, LINES.n, 50 );
	}

	// SPRITES — heads, beacons, glints: soft HDR discs in the gameplay plane.  a = x, y, size, z · col = rgb, intensity
	const DOTS = pool( 400, [ 4, 4 ] );
	{
		const [ a, col ] = DOTS.nodes;
		const m = emitOcclude( new THREE.MeshBasicNodeMaterial() );
		m.positionNode = vec3( positionGeometry.xy.mul( a.z ).add( a.xy ), a.w );
		const colV = col.toVarying();
		m.colorNode = Fn( () => { const d = uv().sub( 0.5 ).length().mul( 2 ); const g = exp( d.mul( d ).mul( - 5.5 ) ).mul( smoothstep( 1.0, 0.7, d ) ); return vec4( colV.rgb.mul( colV.w ).mul( g ), 0 ); } )();
		addPool( m, DOTS.n, 52 );
	}

	// FIREBALLS — the centrepiece. A sphere impostor on a quad: noise-eroded, blackbody-coloured, soot-occluding; the luminous
	// region IS the kill radius (erosion only ever eats inward). a = x, y, r(now), rMax · b = u(0..1), seed, hostile, age
	const BALLS = pool( 40, [ 4, 4 ] );
	const blackbody = Fn( ( [ T ] ) => { // scene-linear HDR, T in 0..1 (≈ 600 K … white-hot)
		const c0 = vec3( 0, 0, 0 ), c1 = vec3( 0.10, 0.008, 0.001 ), c2 = vec3( 0.85, 0.09, 0.008 ), c3 = vec3( 2.6, 0.55, 0.05 ), c4 = vec3( 6.0, 2.2, 0.35 ), c5 = vec3( 12, 7.5, 2.4 ), c6 = vec3( 24, 20, 14 );
		let c = mix( c0, c1, smoothstep( 0.0, 0.12, T ) );
		c = mix( c, c2, smoothstep( 0.12, 0.30, T ) ); c = mix( c, c3, smoothstep( 0.30, 0.50, T ) ); c = mix( c, c4, smoothstep( 0.50, 0.70, T ) );
		c = mix( c, c5, smoothstep( 0.70, 0.85, T ) ); c = mix( c, c6, smoothstep( 0.85, 1.0, T ) );
		return c;
	} );
	{
		const [ a, b ] = BALLS.nodes;
		const SPAN = 1.7; // quad half-size in units of rMax: room for the flash and the soft outer glow
		const m = emitOcclude( new THREE.MeshBasicNodeMaterial() );
		m.positionNode = vec3( positionGeometry.xy.mul( a.w.mul( SPAN * 2 ) ).add( a.xy ), 1.5 );
		const aV = a.toVarying(), bV = b.toVarying();
		m.colorNode = Fn( () => {
			const u = bV.x, seed = bV.y, hostile = bV.z, age = bV.w;
			const P = uv().sub( 0.5 ).mul( SPAN * 2 ).mul( aV.w ); // field units from the centre
			const r = aV.z.max( 0.001 ), pn = P.div( r ), dist = pn.length();
			const z = sqrt( max( float( 1 ).sub( dist.mul( dist ) ), 0 ) );
			// The ball is optically thick: what you see is its SURFACE — cooling lumps of soot-laden gas with white-hot veins
			// between them, rolling outward and up. Noise is looked up on a sphere (features bunch at the limb), warped by a
			// slower field so it boils instead of scrolling, and each blast has its own place in the texture.
			const o = vec2( seed.mul( 7.13 ), seed.mul( 3.71 ) );
			const sph = pn.div( z.add( 0.6 ) ).mul( 1.15 ).div( age.mul( 0.3 ).add( 1 ) );
			const rise = vec2( 0, age.mul( - 0.16 ) );
			const warp = noise( sph.mul( 0.33 ).add( o ).add( rise.mul( 0.5 ) ) ).rg.sub( 0.5 );
			const base = noise( sph.mul( 0.5 ).add( warp.mul( 0.42 ) ).add( o.yx ).add( rise ) ).r;
			const fine = noise( sph.mul( 1.45 ).add( warp.mul( 0.7 ) ).add( o ).add( rise.mul( 1.7 ) ) ).g;
			const lump = base.mul( 0.68 ).add( fine.mul( 0.32 ) ); // 0 valley … 1 crest of a billow
			const veins = pow( float( 1 ).sub( abs( fine.mul( 2 ).sub( 1 ) ) ), 3 ); // ridged: the cracks between lumps
			// taut while the shock drives it, a ragged cauliflower in the hold, torn pockets as it dies — never outside r
			const erosion = mix( float( 0.16 ), float( 0.44 ), smoothstep( 0.2, 0.45, u ) ).add( smoothstep( 0.6, 1.0, u ).mul( 0.75 ) );
			const dens = smoothstep( 0.0, 0.10, float( 1 ).sub( dist ).sub( erosion.mul( float( 1 ).sub( lump ) ) ) );
			const billow = smoothstep( 0.42, 0.7, lump );
			// core temperature: white-hot for an instant, orange through the hold, deep red and soot as it dies
			const Tc0 = mix( float( 1.0 ), float( 0.7 ), smoothstep( 0.0, 0.2, u ) );
			const Tc = mix( mix( Tc0, float( 0.55 ), smoothstep( 0.3, 0.65, u ) ), float( 0.14 ), smoothstep( 0.65, 1.0, u ) ).mul( mix( float( 1 ), float( 0.84 ), hostile ) );
			const core = exp( dist.mul( dist ).mul( - 2.2 ) ).mul( float( 1 ).sub( smoothstep( 0.0, 0.4, u ) ) ).mul( 0.3 ); // the heart still shows through, early
			const Tpix = Tc.mul( mix( float( 1.18 ), float( 0.32 ), billow ) ).add( veins.mul( Tc ).mul( 0.26 ) ).add( core ).mul( z.mul( 0.22 ).add( 0.78 ) );
			const above = mix( float( 1 ), smoothstep( - 0.5, 1.5, aV.y.add( P.y ) ), hostile ); // a ground burst is a dome: nothing of it exists below the desert floor
			const inside = smoothstep( 1.0, 0.97, dist ).mul( above ); // HARD RULE: nothing luminous outside the kill radius
			const emission = blackbody( Tpix.clamp( 0, 1 ) ).mul( dens ).mul( inside ).mul( 0.62 );
			const sootAmt = mix( float( 0.12 ), float( 0.5 ), smoothstep( 0.25, 0.6, u ) ).add( smoothstep( 0.62, 1.0, u ).mul( 0.35 ) ).add( hostile.mul( 0.25 ) );
			const soot = dens.mul( billow ).mul( sootAmt ).mul( inside ).clamp( 0, 0.9 );
			// the flash: a few hundredths of a second of white, wider than the ball — bloom makes it glare
			const R = P.length().div( aV.w.max( 0.001 ) );
			const flash = exp( R.mul( R ).mul( - 14 ) ).mul( exp( age.mul( - 1 / 0.06 ) ) ).mul( 60 ).mul( uFlash ); // a small, violent core: bloom makes the glare
			const glow = exp( R.mul( R ).mul( - 2.4 ) ).mul( Tc ).mul( Tc ).mul( 0.05 ).mul( smoothstep( 0.0, 0.1, aV.z.div( aV.w ) ) ); // hot air scattering around it
			const light = emission.add( vec3( 1, 0.95, 0.86 ).mul( flash ) ).add( blackbody( Tc.mul( 0.72 ) ).mul( glow ).mul( 0.35 ) );
			return vec4( light, soot );
		} )();
		addPool( m, BALLS.n, 40 );
	}

	// RINGS — the kill zone, exactly. Drawn over everything else in the plane. a = x, y, r, u · b = hostile, 0, 0, 0
	const RINGS = pool( 40, [ 4, 4 ] );
	{
		const [ a, b ] = RINGS.nodes;
		const m = emitOcclude( new THREE.MeshBasicNodeMaterial() );
		const PAD = 1.12;
		m.positionNode = vec3( positionGeometry.xy.mul( a.z.mul( PAD * 2 ) ).add( a.xy ), 2.5 );
		const aV = a.toVarying(), bV = b.toVarying();
		m.colorNode = Fn( () => {
			const d = uv().sub( 0.5 ).length().mul( 2 * PAD ).mul( aV.z ); // field units from the centre
			const u = aV.w, hostile = bV.x;
			const w = max( float( 1.5 ), aV.z.mul( 0.03 ) ); // ring half-thickness, field units
			const ring = smoothstep( w, w.mul( 0.35 ), abs( d.sub( aV.z ).add( w ) ) ); // sits just INSIDE r: its outer edge is the radius
			const fill = step( d, aV.z ).mul( 0.05 );
			// the 2D game's colour phases: friendly → ground → enemy as the blast ages; a hostile impact is the enemy's colour
			const phase = mix( mix( uFriendly, uGround, step( 0.2, u ) ), uEnemy, step( 0.6, u ) );
			const c = mix( phase, uEnemy, hostile );
			const gain = mix( mix( float( 5.0 ), float( 2.6 ), smoothstep( 0.3, 0.4, u ) ), float( 1.3 ), smoothstep( 0.65, 0.8, u ) );
			const keyline = smoothstep( w.mul( 0.9 ), float( 0 ), abs( d.sub( aV.z ).sub( 0.9 ) ) ).mul( 0.5 ); // a dark hairline outside: the true edge survives the glow
			const above = mix( float( 1 ), smoothstep( - 0.5, 1.0, aV.y.add( uv().y.sub( 0.5 ).mul( 2 * PAD ).mul( aV.z ) ) ), hostile );
			return vec4( c.mul( ring.mul( gain ).add( fill ) ).mul( above ), keyline.mul( step( aV.z, d ) ).mul( above ) );
		} )();
		addPool( m, RINGS.n, 60 );
	}

	// ── the place: desert, sky, cities, batteries — and the light array every surface reads ──────────────────────────────
	status( 'RAISING THE CITIES…' );
	const land = buildLand( { scene, cfg, HIGH, uTime, noise } );
	const reduceMotion = matchMedia( '(prefers-reduced-motion: reduce)' ).matches || Q.has( 'clarity' );
	const fx = buildFx( { scene, HIGH, uTime, noise, land, reduceMotion } );
	const craft = buildCraft( { scene, land } );
	if ( reduceMotion ) uFlash.value = 0.3;

	// ── post: HDR scene → bloom → AgX (the renderer's own output transform) ─────────────────────────────────────────────
	const pipeline = new THREE.RenderPipeline( renderer );
	const scenePass = pass( scene, camera, { samples: 0 } );
	const sceneColor = scenePass.getTextureNode( 'output' );
	const bloomPass = bloom( min( sceneColor, vec4( 48 ) ), 0.2, 0.3, 1.4 );
	if ( bloomPass.setResolutionScale ) bloomPass.setResolutionScale( HIGH ? 0.5 : 0.25 );
	pipeline.outputNode = Fn( () => {
		const c = sceneColor.rgb.add( min( bloomPass.rgb, vec3( 1.6 ) ) );
		const v = screenUV.sub( 0.5 ); const vig = float( 1 ).sub( dot( v, v ).mul( 0.55 ) ); // vignette
		const dither = fract( sin( dot( screenUV.mul( 1931.7 ).add( fract( uTime ).mul( 17.3 ) ), vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) ).sub( 0.5 ).mul( 0.004 ); // breaks up 8-bit banding in a near-black sky
		return vec4( c.mul( vig ).add( dither ), 1 );
	} )();

	// ── the shift lens ───────────────────────────────────────────────────────────────────────────────────────────
	let view = { w: 1, h: 1, scale: 1, x: 0, y: 0 };
	// The governor trades resolution for frame rate. A phone's rAF is capped at 16.7 ms, so "fast enough to step up" can
	// never be measured there — instead it PROBES: a long calm stretch earns one rung up, and a rung that stutters is
	// handed back and left alone for a minute.
	const gov = { rungs: HIGH ? [ 2, 1.5, 1.25, 1 ] : [ 1.75, 1.5, 1.25, 1, 0.85 ], i: 0, last: 0, slow: 0, calm: 0, probeUntil: 0, probeSlow: 0, blocked: new Map(), buf: [], m0: 0, from: 0, cappedUntil: 0 };
	let dprCap = gov.rungs[ 0 ];
	function govern( now ) {
		const ms = now - gov.last; gov.last = now; if ( ! ( ms > 0 ) || ms > 100 || document.hidden ) return; // a hitch or a tab switch is not a trend
		gov.buf.push( ms ); if ( gov.buf.length > 30 ) gov.buf.shift(); if ( gov.buf.length < 30 ) return;
		const med = [ ...gov.buf ].sort( ( a, b ) => a - b )[ 15 ], set = ( i ) => { gov.i = i; dprCap = gov.rungs[ i ]; gov.buf.length = 0; gov.slow = gov.calm = 0; resize( view ); };
		if ( gov.probeUntil ) { if ( ms > 20 ) gov.probeSlow ++; if ( now > gov.probeUntil ) { gov.probeUntil = 0; if ( gov.probeSlow > 3 ) { gov.blocked.set( gov.i, now + 60000 ); set( gov.i + 1 ); } } return; }
		if ( med > 20 ) { gov.calm = 0; if ( gov.cappedUntil > now ) return;
			// Two rungs down and the frame time has not moved? Then it is not the GPU: something CAPS the frame rate (iOS Low
			// Power Mode and battery savers run rAF at 30 Hz). Give the resolution back and leave it alone for a minute.
			if ( gov.m0 && gov.i - gov.from >= 2 && med > gov.m0 * 0.85 ) { gov.cappedUntil = now + 60000; gov.m0 = 0; set( gov.from ); return; }
			gov.slow += ms; if ( gov.slow > 1500 && gov.i < gov.rungs.length - 1 ) { if ( ! gov.m0 ) { gov.m0 = med; gov.from = gov.i; } const keep = [ gov.m0, gov.from ]; set( gov.i + 1 ); gov.m0 = keep[ 0 ]; gov.from = keep[ 1 ]; } }
		else { gov.slow = 0; gov.m0 = 0; gov.calm = ms > 20 ? 0 : gov.calm + ms; if ( gov.calm > 10000 && gov.i > 0 && ! ( gov.blocked.get( gov.i - 1 ) > now ) ) { set( gov.i - 1 ); gov.probeUntil = now + 2000; gov.probeSlow = 0; } }
	}
	const shake = { x: 0, y: 0, amp: 0, t: 0 }, shakeOffset = { x: 0, y: 0 };
	function resize( v ) {
		view = v; if ( ! ( v.w > 1 && v.h > 1 ) ) return;
		renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, dprCap ) );
		renderer.setSize( v.w, v.h, false );
		aim();
	}
	function aim() {
		const { w, h, scale } = view; if ( ! ( w > 1 ) ) return;
		// the window we must show is centred on field (500, 225) = world (500, 179); the eye sits lower, so slide the window up
		const dx = ( W / 2 - camera.position.x ) * scale - shake.x * scale, dy = ( fy( H / 2 ) - camera.position.y ) * scale + shake.y * scale; // the window slides −shake, so the field shows at +shake: what is under the finger is what fieldPoint() returns
		const mx = Math.abs( dx ) + 2, my = Math.abs( dy ) + 2, fullW = w + 2 * mx, fullH = h + 2 * my;
		camera.fov = 2 * Math.atan( ( fullH / scale / 2 ) / camera.position.z ) * 180 / Math.PI;
		camera.aspect = fullW / fullH;
		camera.setViewOffset( fullW, fullH, fullW / 2 + dx - w / 2, fullH / 2 - dy - h / 2, w, h );
		camera.updateProjectionMatrix();
	}

	// ── events from the game ─────────────────────────────────────────────────────────────────────────────────────
	const seeds = new WeakMap();
	const cities = CITY_X.map( () => ( { alive: true, collapse: 0, burn: 0, lights: 1, grid: 1, since: 0 } ) );
	const bases = BASE_X.map( () => ( { alive: true, burn: 0 } ) );
	let scorchHead = 0, SS = null, cookFlash = null; const cookOff = [];
	const addScorch = ( x, r ) => { land.scorch.array[ scorchHead ++ % 12 ].set( x, 4 + Math.random() * 16, r, uTime.value ); };
	const resetWorld = () => { fx.reset(); cookOff.length = 0; cookFlash = null; cities.forEach( ( c ) => Object.assign( c, { alive: true, collapse: 0, burn: 0, lights: 1, grid: 1 } ) ); bases.forEach( ( b ) => Object.assign( b, { alive: true, burn: 0 } ) ); land.scorch.array.forEach( ( v ) => v.set( 0, 0, 0, - 1e5 ) ); };
	const api = {
		backend, tier: HIGH ? 'high' : 'mobile', shakeOffset,
		resize,
		onReset( S ) { SS = S; setPalette( S.wave || 1 ); resetWorld(); },
		onWave( S ) { SS = S; setPalette( S.wave ); },
		onShot( shot ) { fx.launch( shot, fy ); }, onSplit( e ) { fx.split( e, fy( e.y ) ); }, onKill( e ) { fx.kill( e, fy( e.y ) ); }, onCityRestored() {}, onGameOver() {},
		onBlast( b ) { seeds.set( b, Math.random() ); if ( SS ) fx.blast( b, fy( b.y ), SS ); },
		onImpact( e, target, destroyed ) {
			addScorch( e.x, destroyed ? 46 : 30 ); fx.impact( e, destroyed );
			// a battery that dies with interceptors still in the magazine cooks them off, one after another
			if ( destroyed && 'ammo' in target ) { const left = bases[ target.id ].ammo || 0; for ( let j = 0; j < Math.min( 10, left ); j ++ ) cookOff.push( { at: uTime.value + 0.25 + j * 0.12, x: target.x + ( Math.random() - 0.5 ) * 50 } ); }
			if ( ! reduceMotion ) { shake.amp = Math.min( 3, Math.max( shake.amp, destroyed ? ( 'ammo' in target ? 2.5 : 3 ) : 1.5 ) ); shake.t = 0; }
		},
		render,
		// QA: the promise the tap maths relies on — the camera shows the playfield as the exact letterbox rectangle the 2D
		// game computes. Projects the four corners and the centre; returns the worst miss in CSS pixels (expect < 0.5).
		checkFit() {
			aim(); camera.updateMatrixWorld(); let worst = 0; const v = new THREE.Vector3();
			for ( const [ fx_, fy_ ] of [ [ 0, 0 ], [ W, 0 ], [ 0, H ], [ W, H ], [ W / 2, H / 2 ], [ 250, GROUND ] ] ) {
				v.set( fx_, fy( fy_ ), 0 ).project( camera );
				const px = ( v.x * 0.5 + 0.5 ) * view.w, py = ( 1 - ( v.y * 0.5 + 0.5 ) ) * view.h, ex = view.x + ( fx_ + shake.x ) * view.scale, ey = view.y + ( fy_ + shake.y ) * view.scale;
				worst = Math.max( worst, Math.hypot( px - ex, py - ey ) );
			}
			return +worst.toFixed( 3 );
		},
		// QA: r186 re-renders the scene pass once per FRAME id, and that id only advances from the renderer's own rAF loop —
		// which never ticks in a hidden pane. The virtual-clock capture mode advances it by hand, once per tick.
		tickFrame() { const n = renderer._nodes; if ( n && n.nodeFrame ) { n.nodeFrame.update(); renderer.info.frame = n.nodeFrame.frameId; } },
		// QA: the finished frame, read back from an offscreen target (a hidden pane never re-presents its canvas, so the
		// canvas itself would hand back stale pixels). Resolves to a PNG blob.
		async capture() {
			const w = renderer.domElement.width, h = renderer.domElement.height, rt = new THREE.RenderTarget( w, h, { type: THREE.UnsignedByteType, depthBuffer: false } );
			renderer.setRenderTarget( rt ); pipeline.render(); renderer.setRenderTarget( null );
			const px = await renderer.readRenderTargetPixelsAsync( rt, 0, 0, w, h ), row = w * 4, stride = Math.round( px.length / h ); rt.dispose();
			const c = document.createElement( 'canvas' ); c.width = w; c.height = h; const g = c.getContext( '2d' ), img = g.createImageData( w, h ), flip = backend !== 'WebGPU'; // WebGL reads bottom-up
			for ( let y = 0; y < h; y ++ ) { const src = ( flip ? h - 1 - y : y ) * stride; img.data.set( px.subarray( src, src + row ), y * row ); }
			for ( let i = 3; i < img.data.length; i += 4 ) img.data[ i ] = 255;
			g.putImageData( img, 0, 0 ); return new Promise( ( res ) => c.toBlob( res, 'image/png' ) );
		},
		get info() { return { backend, tier: api.tier, dpr: +Math.min( window.devicePixelRatio || 1, dprCap ).toFixed( 2 ), calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles }; },
	};

	// ── the frame ────────────────────────────────────────────────────────────────────────────────────────────────
	const tmp = new THREE.Color();
	const lin = ( u ) => [ u.value.r, u.value.g, u.value.b ];
	function render( S, dt, flags ) {
		if ( S.mode === 'paused' || ( flags && flags.blocked ) ) dt = 0; // a held battle holds its smoke, sparks and fires too
		uTime.value += dt; govern( performance.now() );
		// idle sway: the eye drifts, the window re-centres — the playfield never moves, the desert behind it does
		const t = uTime.value;
		if ( ! reduceMotion ) { camera.position.x = EYE.x + Math.sin( t * 2 * Math.PI / 23 ) * 6; camera.position.y = EYE.y + Math.sin( t * 2 * Math.PI / 17 + 1.3 ) * 2.5; }
		if ( shake.amp > 0.01 ) { shake.t += dt; const k = shake.amp * Math.exp( - shake.t / 0.12 ); shake.x = Math.sin( shake.t * 176 ) * k; shake.y = Math.cos( shake.t * 143 + 1 ) * k * 0.7; if ( shake.t > 0.4 ) { shake.amp = 0; shake.x = shake.y = 0; } }
		shakeOffset.x = shake.x; shakeOffset.y = shake.y;
		aim();

		// cities and batteries: watch the simulation's flags, animate the difference
		S.cities.forEach( ( c, i ) => { const k = cities[ i ];
			if ( k.alive && ! c.alive ) { k.alive = false; k.burn = 1; k.since = t; cities.forEach( ( o ) => { if ( o !== k ) o.grid = 0.3; } ); } // the grid browns out everywhere when a city dies
			else if ( ! k.alive && c.alive ) { k.alive = true; k.since = t; }
			k.collapse += ( ( k.alive ? 0 : 1 ) - k.collapse ) * Math.min( 1, dt * ( k.alive ? 1.4 : 5 ) );
			k.lights += ( ( k.alive && k.collapse < 0.25 ? 1 : 0 ) - k.lights ) * Math.min( 1, dt * ( k.alive ? 1.2 : 12 ) );
			k.grid += ( 1 - k.grid ) * Math.min( 1, dt * 3.2 );
			if ( k.alive ) k.burn = Math.max( 0, k.burn - dt * 1.5 ); else k.burn = Math.max( 0.5, k.burn - dt * 0.025 );
			land.uCity.array[ i ].set( k.lights, k.collapse, k.burn, k.grid ); } );
		S.bases.forEach( ( b, i ) => { const k = bases[ i ]; if ( b.alive ) k.ammo = b.ammo; if ( k.alive && ! b.alive ) { k.alive = false; k.burn = 1; } else if ( ! k.alive && b.alive ) k.alive = true;
			k.burn = k.alive ? Math.max( 0, k.burn - dt * 2 ) : Math.max( 0.5, k.burn - dt * 0.03 ); land.uBase.array[ i ].set( k.alive ? 1 : 0, k.burn, 0, 0 ); } );
		// the light every surface reads: the brightest blasts and fires. Radiated power ~ area · T⁴, plus the flash.
		const Ls = [];
		for ( const b of S.blasts ) { const u = b.age / b.life, Tc = u < 0.2 ? 1 - 1.5 * u : u < 0.65 ? 0.7 - 0.33 * ( u - 0.2 ) : 0.55 - 1.17 * ( u - 0.65 ), rr = b.r / 49;
			const P = 7.5e4 * rr * rr * Math.pow( Math.max( Tc, 0 ) / 0.7, 4 ) + 2.4e5 * Math.exp( - b.age / 0.05 ), hot = Math.min( 1, Math.max( 0, ( Tc - 0.35 ) / 0.6 ) );
			Ls.push( [ b.x, fy( b.y ), 0, Math.max( b.r, 8 ), 1, 0.42 + 0.5 * hot, 0.1 + 0.62 * hot * hot, P, P ] ); }
		S.cities.forEach( ( c, i ) => { const k = cities[ i ]; if ( k.burn > 0.02 ) Ls.push( [ c.x, 14, - 2, 16, 1, 0.45, 0.12, 1.5e4 * k.burn * ( 0.75 + 0.25 * Math.sin( t * 9 + i * 2.1 ) * Math.sin( t * 5.3 + i ) ), 1.5e4 * k.burn ] ); } );
		S.bases.forEach( ( b, i ) => { const k = bases[ i ]; if ( k.burn > 0.02 ) Ls.push( [ b.x, 22, 0, 12, 1, 0.45, 0.12, 1.1e4 * k.burn * ( 0.75 + 0.25 * Math.sin( t * 8 + i * 3.3 ) ), 1.1e4 * k.burn ] ); } );
		while ( cookOff.length && cookOff[ 0 ].at <= t ) { const c = cookOff.shift(); fx.kill( { x: c.x, type: 'cook' }, 14 + Math.random() * 20 ); cookFlash = { x: c.x, at: t }; } // a round in the magazine goes up
		if ( cookFlash ) { const k = Math.exp( - ( t - cookFlash.at ) / 0.08 ); if ( k < 0.02 ) cookFlash = null; else Ls.push( [ cookFlash.x, 20, 0, 10, 1, 0.55, 0.15, 6e4 * k, 6e4 * k ] ); }
		Ls.sort( ( a, b ) => b[ 8 ] - a[ 8 ] ); // ranked by STEADY power: a fire's flicker must never reshuffle which ruin gets a light slot
		for ( let i = 0; i < land.NL; i ++ ) { const l = Ls[ i ]; if ( l ) { land.uLpos.array[ i ].set( l[ 0 ], l[ 1 ], l[ 2 ], l[ 3 ] ); land.uLcol.array[ i ].set( l[ 4 ] * l[ 7 ], l[ 5 ] * l[ 7 ], l[ 6 ] * l[ 7 ], 0 ); } else land.uLcol.array[ i ].set( 0, 0, 0, 0 ); }

		const G = lin( uGround ), F = lin( uFriendly ), E = lin( uEnemy ), WHITE = [ 1, 0.97, 0.9 ];
		LINES.begin(); DOTS.begin(); BALLS.begin(); RINGS.begin();
		const line = ( x1, y1, x2, y2, width, c, gain, head = 0, dark = 0, z = 1 ) => LINES.put( [ x1, fy( y1 ), x2, fy( y2 ) ], [ width, z, head, dark ], [ c[ 0 ], c[ 1 ], c[ 2 ], gain ] );
		const dot = ( x, y, size, c, gain, z = 2 ) => DOTS.put( [ x, fy( y ), size, z ], [ c[ 0 ], c[ 1 ], c[ 2 ], gain ] );

		line( - 3000, GROUND - 1.2, 4000, GROUND - 1.2, 2.2, G, 1.1, 0, 0, 0.5 ); // the arcade's ground line, kept: a strip of light at the foot of the field
		for ( const tr of S.trails ) line( tr.x, tr.y, tr.tx, tr.ty, 2.2, E, 2.2 * tr.life / 0.35, 1 );
		for ( const e of S.enemies ) {
			if ( e.type === 'missile' ) {
				line( e.ox, e.oy, e.x, e.y, 6, [ 0, 0, 0 ], 0, 0, 0.34, 0.9 ); // a dark under-stroke: the trail reads over fire, smoke and lit cloud
				line( e.ox, e.oy, e.x, e.y, 2.4, E, 3.2, 1 );
				dot( e.x, e.y, 13, WHITE, 9 ); dot( e.x, e.y, 30, E, 1.4 );
			} else if ( e.type === 'smart' ) {
				const p = e.path; for ( let i = 1; i < p.length; i ++ ) line( p[ i - 1 ].x, p[ i - 1 ].y, p[ i ].x, p[ i ].y, 1.8, E, 2.4 * ( i / p.length ), 0 );
				const l = p[ p.length - 1 ]; line( l.x, l.y, e.x, e.y, 1.8, E, 2.4 );
				const s = 7, pulse = 2.5 + Math.sin( t * 14 ) * 1.2;
				line( e.x, e.y - s, e.x + s, e.y, 2, G, pulse ); line( e.x + s, e.y, e.x, e.y + s, 2, G, pulse ); line( e.x, e.y + s, e.x - s, e.y, 2, G, pulse ); line( e.x - s, e.y, e.x, e.y - s, 2, G, pulse );
				dot( e.x, e.y, 16, E, 5 );
			}
		}
		craft.sync( S, t, fy, dot, E ); // the bomber and the satellite are real objects (craft.js); this places them and blinks their lights
		for ( const s of S.shots ) {
			line( s.ox, s.oy, s.x, s.y, 2.2, F, 2.6, 1 ); dot( s.x, s.y, 12, WHITE, 10 ); dot( s.x, s.y, 26, F, 1.6 );
			line( s.tx - 5, s.ty - 5, s.tx + 5, s.ty + 5, 1.6, F, 3.2 ); line( s.tx - 5, s.ty + 5, s.tx + 5, s.ty - 5, 1.6, F, 3.2 );
		}
		for ( const b of S.bases ) if ( S.selected === b.id || S.selected < 0 && S.lastBase === b.id && S.flashBase > 0 ) line( b.x - 40, GROUND - 28, b.x + 40, GROUND - 28, 2.4, F, 3 );
		for ( const b of S.bases ) for ( let i = 0; i < b.ammo; i ++ ) { const x = b.x - 22 + ( i % 5 ) * 10 + 1.5, y = GROUND + 12 + Math.floor( i / 5 ) * 13; line( x, y, x, y + 9, 3, F, 1.5, 0, 0, 0.6 ); line( x - 3.5, y + 7.5, x + 3.5, y + 7.5, 3, F, 1.5, 0, 0, 0.6 ); }
		for ( const b of S.blasts ) {
			if ( b.r <= 0 ) continue;
			const u = b.age / b.life, seed = seeds.get( b ) ?? 0.5;
			BALLS.put( [ b.x, fy( b.y ), b.r, b.max ], [ u, seed, b.hostile ? 1 : 0, b.age ] );
			RINGS.put( [ b.x, fy( b.y ), b.r, u ], [ b.hostile ? 1 : 0, 0, 0, 0 ] );
		}
		fx.update( S, dt, t, fy, cities, bases );
		LINES.end(); DOTS.end(); BALLS.end(); RINGS.end();
		pipeline.render();
	}

	// everything is in the scene from the first frame, so every shader compiles behind the title screen
	if ( Q.has( 'debug' ) ) { // what to read off a phone: which backend it got, which rung it settled on, how fast
		const el = document.createElement( 'div' ); el.style.cssText = 'position:fixed;left:8px;bottom:64px;z-index:40;font:11px/1.35 ui-monospace,Menlo,monospace;color:#8f8;background:#000a;padding:4px 7px;pointer-events:none;white-space:pre';
		document.body.appendChild( el ); let n = 0, t0 = performance.now();
		const tick = () => { n ++; const now = performance.now(); if ( now - t0 > 500 ) { const i = api.info; el.textContent = `${ i.backend } · ${ i.tier } · dpr ${ i.dpr } · ${ Math.round( n * 1000 / ( now - t0 ) ) } fps · ${ i.calls } draws`; n = 0; t0 = now; } requestAnimationFrame( tick ); }; tick();
	}
	status( 'LIGHTING THE FUSE…' );
	return api;

}

// A tiling RGBA noise texture: four decorrelated fBm fields of periodic value noise, 0..1.
function makeNoiseTexture( N ) {
	const data = new Uint8Array( N * N * 4 );
	const rnd = ( seed ) => { let s = seed >>> 0; return () => ( ( s = Math.imul( s ^ ( s >>> 15 ), 2246822519 ) + 0x9e3779b9 | 0 ), ( ( s ^ ( s >>> 13 ) ) >>> 0 ) / 4294967296 ); };
	for ( let c = 0; c < 4; c ++ ) {
		const field = new Float32Array( N * N ); let amp = 1, total = 0;
		for ( let o = 0, cells = 4; o < 5; o ++, cells *= 2, amp *= 0.5 ) {
			const r = rnd( 1337 + c * 101 + o * 17 ), lat = new Float32Array( cells * cells ); for ( let i = 0; i < lat.length; i ++ ) lat[ i ] = r();
			for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {
				const fx = x / N * cells, fyy = y / N * cells, x0 = Math.floor( fx ), y0 = Math.floor( fyy ), tx = fx - x0, ty = fyy - y0;
				const sx = tx * tx * ( 3 - 2 * tx ), sy = ty * ty * ( 3 - 2 * ty ), x1 = ( x0 + 1 ) % cells, y1 = ( y0 + 1 ) % cells;
				const a = lat[ y0 * cells + x0 ], b = lat[ y0 * cells + x1 ], cc = lat[ y1 * cells + x0 ], d = lat[ y1 * cells + x1 ];
				field[ y * N + x ] += amp * ( a + ( b - a ) * sx + ( cc - a ) * sy + ( a - b - cc + d ) * sx * sy );
			}
			total += amp;
		}
		for ( let i = 0; i < N * N; i ++ ) data[ i * 4 + c ] = Math.max( 0, Math.min( 255, Math.round( ( field[ i ] / total - 0.5 ) * 1.9 * 255 + 127.5 ) ) );
	}
	// The mip chain is built here, by box filter, and handed over whole: a GPU-generated chain for a data texture came out
	// empty on the WebGPU backend (every lookup read ~0: smooth fireballs, no clouds). Mips matter — the desert floor is
	// seen edge-on and moirés without them.
	const mips = [ { data, width: N, height: N } ];
	for ( let n = N; n > 1; n >>= 1 ) { const src = mips[ mips.length - 1 ].data, m = n >> 1, dst = new Uint8Array( m * m * 4 );
		for ( let y = 0; y < m; y ++ ) for ( let x = 0; x < m; x ++ ) for ( let c = 0; c < 4; c ++ ) { const i = ( y * 2 * n + x * 2 ) * 4 + c; dst[ ( y * m + x ) * 4 + c ] = ( src[ i ] + src[ i + 4 ] + src[ i + n * 4 ] + src[ i + n * 4 + 4 ] + 2 ) >> 2; }
		mips.push( { data: dst, width: m, height: m } ); }
	const t = new THREE.DataTexture( data, N, N, THREE.RGBAFormat ); t.mipmaps = mips; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
	return t;
}
