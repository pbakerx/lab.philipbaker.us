// land.js — MISSILE COMMAND DELUXE: the place. A high-desert basin at midnight: moonlit sand and a pale dry lakebed,
// ridgelines dissolving into haze, six small lit cities and three hardened batteries, under a dense star field.
// The world is nearly black on purpose — every fireball, tracer and burning city is the actual light source. There are no
// three.js lights: every surface calls one shared function, blastLight(), that loops a small uniform array the frame
// loop fills from the simulation (the brightest blasts and fires). One draw per kind of thing; every material made once.
import * as THREE from 'three/webgpu';
import {
	Fn, uniform, uniformArray, instancedBufferAttribute, attribute, positionGeometry, positionWorld, normalGeometry, cameraPosition,
	uv, vec2, vec3, vec4, float, int, mix, smoothstep, step, clamp, sin, cos, abs, max, min, pow, exp, sqrt, fract, floor, dot, length, normalize, reflect,
	hash, Loop, fwidth,
} from 'three/tsl';

export function buildLand( ctx ) {

	const { scene, cfg, HIGH, uTime, noise } = ctx;
	const { W, GROUND, BASE_X, CITY_X } = cfg;

	// ── light ────────────────────────────────────────────────────────────────────────────────────────────────────
	const NL = HIGH ? 12 : 6;
	const uLpos = uniformArray( Array.from( { length: NL }, () => new THREE.Vector4( 0, - 1e5, 0, 1 ) ) ); // xyz, source radius
	const uLcol = uniformArray( Array.from( { length: NL }, () => new THREE.Vector4( 0, 0, 0, 0 ) ) );     // rgb × radiant power
	const uCity = uniformArray( Array.from( { length: 6 }, () => new THREE.Vector4( 1, 0, 0, 1 ) ) );       // lights 0..1, collapse 0..1, burn 0..1, grid (brown-out) 0..1
	const uBase = uniformArray( Array.from( { length: 3 }, () => new THREE.Vector4( 1, 0, 0, 0 ) ) );       // alive 0..1, burn 0..1
	const MOON_DIR = new THREE.Vector3( 0.30, 0.34, - 0.89 ).normalize(); // toward the moon: a low back-light, so facades are dark and windows pop
	const uMoon = uniform( new THREE.Color( 0.62, 0.74, 1.0 ).multiplyScalar( 0.3 ) );
	const uSkyAmb = uniform( new THREE.Color( 0.010, 0.014, 0.026 ) ), uGndAmb = uniform( new THREE.Color( 0.006, 0.005, 0.004 ) );
	const uFog = uniform( new THREE.Color( 0.030, 0.040, 0.064 ) ), uFogDensity = uniform( 1.7e-4 );
	const moonDir = vec3( MOON_DIR.x, MOON_DIR.y, MOON_DIR.z );

	// Sphere-light falloff with no singularity: E = Φ · max(N·L, 0) / (d² + r²). wrap > 0 lights smoke and cloud from inside.
	const blastLight = Fn( ( [ P, N, wrap ] ) => {
		const acc = vec3( 0 ).toVar();
		Loop( { start: int( 0 ), end: int( NL ), type: 'int', condition: '<' }, ( { i } ) => {
			const lp = uLpos.element( i ), lc = uLcol.element( i );
			const d = lp.xyz.sub( P ), d2 = dot( d, d ), L = d.div( sqrt( d2 ).max( 1e-3 ) );
			const ndl = max( dot( N, L ).add( wrap ).div( wrap.add( 1 ) ), 0 );
			acc.addAssign( lc.rgb.mul( ndl ).div( d2.add( lp.w.mul( lp.w ) ).add( 60 ) ) );
		} );
		return acc;
	} );
	const ambient = Fn( ( [ N ] ) => mix( uGndAmb, uSkyAmb, N.y.mul( 0.5 ).add( 0.5 ) ) );
	const fogged = Fn( ( [ c, P ] ) => { // exponential height fog toward the horizon colour
		const d = length( P.sub( cameraPosition ) ), f = float( 1 ).sub( exp( d.mul( uFogDensity ).mul( exp( P.y.max( 0 ).div( - 900 ) ) ).negate() ) );
		return mix( c, uFog, f.clamp( 0, 1 ) );
	} );
	const opaque = ( m ) => { m.fog = false; return m; };

	// ── sky: gradient, a distant city's glow on the horizon, airglow, the Milky Way ─────────────────────────────────────
	{
		const m = opaque( new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, depthWrite: false } ) );
		m.colorNode = Fn( () => {
			const d = normalize( positionWorld.sub( cameraPosition ) ), el = d.y.max( 0 );
			let c = mix( vec3( 0.020, 0.028, 0.046 ), vec3( 0.0035, 0.006, 0.016 ), pow( el, 0.45 ) );
			const az = d.x.div( length( d.xz ).max( 1e-3 ) ); // -1 left … +1 right of where we look
			c = c.add( vec3( 0.075, 0.042, 0.014 ).mul( exp( el.mul( - 14 ) ) ).mul( exp( az.add( 0.55 ).mul( az.add( 0.55 ) ).mul( - 5 ) ) ) ); // a metropolis beyond the ridges
			c = c.add( vec3( 0.0, 0.010, 0.005 ).mul( exp( el.sub( 0.2 ).mul( el.sub( 0.2 ) ).mul( - 90 ) ) ) ); // airglow
			const bd = d.y.sub( d.x.mul( 0.55 ) ).sub( 0.42 ), band = exp( bd.mul( bd ).mul( - 22 ) ); // the Milky Way, tilted across the top right (squared by hand: pow() of a negative base is undefined, and a NaN sky would be bloomed over the whole frame)
			const mw = noise( d.xy.mul( 1.3 ) ).r.mul( noise( d.xy.mul( 4.1 ) ).g.mul( 0.7 ).add( 0.3 ) );
			c = c.add( vec3( 0.030, 0.032, 0.042 ).mul( band ).mul( mw ).mul( smoothstep( 0.05, 0.3, el ) ) );
			return vec4( c, 1 );
		} )();
		const sky = new THREE.Mesh( new THREE.SphereGeometry( 40000, 32, 16 ), m ); sky.renderOrder = - 10; sky.frustumCulled = false; scene.add( sky );
	}

	// ── stars: instanced quads (WebGPU points are 1 px) ─────────────────────────────────────────────────────────────
	{
		const N = HIGH ? 3200 : 1300, a = new Float32Array( N * 4 ), b = new Float32Array( N * 4 );
		let s = 12345; const rnd = () => ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
		for ( let i = 0; i < N; i ++ ) {
			const az = ( rnd() - 0.5 ) * 2.2, el = Math.asin( Math.pow( rnd(), 0.8 ) * 0.62 ), R = 30000; // only the sky we can see
			a.set( [ W / 2 + Math.sin( az ) * Math.cos( el ) * R, Math.sin( el ) * R, - Math.cos( az ) * Math.cos( el ) * R, 14 + Math.pow( rnd(), 6 ) * 60 ], i * 4 );
			const t = rnd(), mag = Math.pow( rnd(), 4 ); // B−V: blue-white … orange; a few bright ones cross the bloom knee
			b.set( [ 0.7 + 0.3 * t, 0.8 + 0.05 * t, 1.0 - 0.35 * t, 0.12 + mag * 3.2 ], i * 4 );
		}
		const A = instancedBufferAttribute( new THREE.InstancedBufferAttribute( a, 4 ), 'vec4' ), B = instancedBufferAttribute( new THREE.InstancedBufferAttribute( b, 4 ), 'vec4' );
		const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false } );
		m.positionNode = A.xyz; m.scaleNode = A.w; m.sizeAttenuation = true;
		const bV = B.toVarying(), seedV = hash( float( 7 ).add( A.x.mul( 0.137 ) ).add( A.y.mul( 0.071 ) ) ).toVarying(), elV = A.y.div( 30000 ).toVarying();
		m.colorNode = Fn( () => {
			const d = uv().sub( 0.5 ).length().mul( 2 ), g = exp( d.mul( d ).mul( - 7 ) );
			const tw = sin( uTime.mul( seedV.mul( 5 ).add( 2 ) ).add( seedV.mul( 40 ) ) ).mul( mix( float( 0.45 ), float( 0.18 ), smoothstep( 0.0, 0.35, elV ) ) ).add( 1 );
			const ext = exp( float( - 0.5 ).div( elV.max( 0.05 ) ) ).mul( 1.6 ); // extinction near the horizon
			return vec4( bV.rgb.mul( bV.w ).mul( g ).mul( tw ).mul( ext ), g );
		} )();
		const stars = new THREE.Sprite( m ); stars.count = N; stars.frustumCulled = false; stars.renderOrder = - 9; scene.add( stars );
	}

	// ── the moon: small, high on the left, the direction the key light comes from ─────────────────────────────────────────
	{
		const m = opaque( new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } ) );
		m.colorNode = Fn( () => {
			const p = uv().sub( 0.5 ).mul( 2 ), d = p.length(), disc = smoothstep( 1.0, 0.94, d );
			const maria = noise( p.mul( 0.23 ).add( 0.31 ) ).r.mul( 0.55 ).add( noise( p.mul( 0.7 ) ).g.mul( 0.25 ) );
			const limb = sqrt( max( float( 1 ).sub( d.mul( d ) ), 0 ) ).mul( 0.35 ).add( 0.65 );
			return vec4( vec3( 1.0, 0.96, 0.86 ).mul( 1.9 ).mul( disc ).mul( limb ).mul( float( 1.1 ).sub( maria.mul( 1.1 ) ) ), disc );
		} )();
		const moon = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), m ); const R = 26000;
		moon.position.set( W / 2 - R * 0.30, R * 0.345, - R * 0.89 ); moon.scale.setScalar( 400 ); moon.renderOrder = - 8; moon.frustumCulled = false; scene.add( moon );
	}

	// ── cirrus: one quad, high and far. Thin enough that the stars show through; it exists to catch light. ───────────────
	{
		const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide } );
		m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
		m.colorNode = Fn( () => {
			const P = positionWorld, drift = vec2( uTime.mul( 5 ), uTime.mul( 1.5 ) );
			const R = vec2( P.x.mul( 0.82 ).add( P.z.mul( 0.57 ) ), P.z.mul( 0.82 ).sub( P.x.mul( 0.57 ) ) ).add( drift ); // turned off the texture's axes, so its lattice never shows
			const w = noise( R.mul( 1 / 9000 ) ).rg.sub( 0.5 ).mul( 1400 );
			const n1 = noise( R.add( w ).mul( 1 / 6100 ) ).r, n2 = noise( R.add( w.mul( 0.5 ) ).mul( 1 / 1700 ) ).g, n3 = noise( vec2( R.x.mul( 1 / 520 ), R.y.mul( 1 / 2600 ) ).add( w.mul( 0.0004 ) ) ).b; // streaked along the wind
			const dens = smoothstep( 0.56, 0.9, n1.mul( 0.62 ).add( n2.mul( 0.26 ) ).add( n3.mul( 0.26 ) ) );
			const edge = smoothstep( - 9300, - 6500, P.z ).mul( smoothstep( - 500, - 1700, P.z ) ).mul( smoothstep( - 7000, - 4500, P.x ) ).mul( smoothstep( 8000, 5500, P.x ) );
			const a = dens.mul( edge ).mul( 0.24 );
			const V = normalize( P.sub( cameraPosition ) ), silver = pow( max( dot( V, moonDir ), 0 ), 5 ).mul( 0.7 ).add( 0.16 ); // forward scatter toward the moon
			const under = blastLight( P, vec3( 0, - 1, 0 ), float( 0.5 ) ).mul( 22 ); // the underside answers every fire
			const c = uMoon.mul( silver ).add( uSkyAmb.mul( 1.5 ) ).add( min( under, vec3( 0.55, 0.3, 0.12 ) ) );
			return vec4( fogged( c, P ).mul( a ), a );
		} )();
		const g = new THREE.PlaneGeometry( 16000, 9600 ); g.rotateX( Math.PI / 2 );
		const sheet = new THREE.Mesh( g, m ); sheet.position.set( W / 2, 1500, - 4900 ); sheet.frustumCulled = false; sheet.renderOrder = - 7; scene.add( sheet );
	}

	// ── terrain: one mesh, heights computed once. Flat in the basin, ridges beyond. ─────────────────────────────────────
	const scorch = uniformArray( Array.from( { length: 12 }, () => new THREE.Vector4( 0, 0, 0, - 1e5 ) ) ); // x, z, radius, born
	{
		const NX = HIGH ? 220 : 140, NZ = HIGH ? 170 : 110, X0 = - 6500, X1 = 7500, Z0 = 1400, Z1 = - 9600; // from under the camera to beyond the last ridge
		const vn = makeValueNoise( 9001 );
		const ridged = ( x, z ) => { let a = 1, f = 1 / 2400, h = 0, w = 0; for ( let o = 0; o < 5; o ++, a *= 0.5, f *= 2.03 ) { const n = 1 - Math.abs( vn( x * f + o * 17.3, z * f - o * 9.1 ) * 2 - 1 ); h += a * n * n; w += a; } return h / w; };
		const height = ( x, z ) => {
			const mask = smooth( - 2300, - 4600, z ), grow = 1 + smooth( - 3500, - 9000, z ) * 1.9;
			const dunes = ( vn( x / 310, z / 240 ) - 0.5 ) * 9 * smooth( - 60, - 500, z ) * ( 1 - mask );
			return ridged( x, z ) * 210 * grow * mask * mask + dunes * 0.6 - 0.5;
		};
		const pos = new Float32Array( NX * NZ * 3 ), idx = [];
		for ( let j = 0; j < NZ; j ++ ) for ( let i = 0; i < NX; i ++ ) {
			const u = i / ( NX - 1 ), v = j / ( NZ - 1 ), cu = u * 2 - 1;
			const x = W / 2 + Math.sign( cu ) * Math.pow( Math.abs( cu ), 1.7 ) * ( X1 - X0 ) / 2, z = Z0 + ( Z1 - Z0 ) * Math.pow( v, 1.9 ); // fine near the field, coarse at the ridges
			pos.set( [ x, z > - 40 ? 0 : height( x, z ), z ], ( j * NX + i ) * 3 );
		}
		for ( let j = 0; j < NZ - 1; j ++ ) for ( let i = 0; i < NX - 1; i ++ ) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx.push( a, b, c, b, d, c ); } // wound so the normals face the sky (j runs AWAY from the camera)
		const g = new THREE.BufferGeometry(); g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) ); g.setIndex( idx ); g.computeVertexNormals();
		const m = opaque( new THREE.MeshBasicNodeMaterial() );
		const nrm = attribute( 'normal', 'vec3' );
		m.colorNode = Fn( () => {
			const P = positionWorld, N = normalize( nrm );
			const grain = noise( P.xz.mul( 0.004 ) ).r, fine = noise( P.xz.mul( 0.031 ) ).g;
			// sand, a pale dry lakebed behind the cities (it catches the light and silhouettes the skyline), rock on the ridges
			const playa = smoothstep( - 120, - 320, P.z ).mul( smoothstep( - 2300, - 1500, P.z ) ).mul( smoothstep( - 1500, - 700, P.x ) ).mul( smoothstep( 2500, 1700, P.x ) ).mul( smoothstep( 0.30, 0.55, grain.add( fine.mul( 0.25 ) ) ) );
			let albedo = mix( vec3( 0.30, 0.24, 0.17 ), vec3( 0.46, 0.43, 0.37 ), playa ).mul( fine.mul( 0.5 ).add( 0.75 ) );
			albedo = mix( albedo, vec3( 0.12, 0.10, 0.09 ), smoothstep( 60, 260, P.y ) );
			// the foreground apron is a damp, oil-sheened hardstand: dark, and it mirrors every fire as a long streak
			const apron = smoothstep( - 10, 40, P.z );
			albedo = mix( albedo, vec3( 0.05, 0.05, 0.055 ), apron.mul( 0.85 ) );
			// scorch marks where warheads landed
			const burnt = float( 0 ).toVar(), ember = float( 0 ).toVar();
			Loop( { start: int( 0 ), end: int( 12 ), type: 'int', condition: '<' }, ( { i } ) => {
				const s = scorch.element( i ), d = length( P.xz.sub( s.xy ) ).div( s.z.max( 1 ) ), edge = d.add( fine.sub( 0.5 ).mul( 0.5 ) );
				const k = smoothstep( 1.0, 0.55, edge ); burnt.assign( max( burnt, k ) );
				ember.addAssign( k.mul( step( 0.78, noise( P.xz.mul( 0.11 ) ).b ) ).mul( exp( uTime.sub( s.w ).mul( - 0.12 ) ) ) );
			} );
			albedo = albedo.mul( mix( float( 1 ), float( 0.3 ), burnt ) );
			const lit = albedo.mul( uMoon.mul( max( dot( N, moonDir ), 0 ).add( 0.06 ) ).add( ambient( N ) ).add( blastLight( P, N, float( 0 ) ) ) );
			// sodium pools around the living cities
			let pools = vec3( 0 ); // (six cities: unrolled at build time)
			CITY_X.forEach( ( cx, i ) => { const c = uCity.element( i ), d2 = dot( P.xz.sub( vec2( cx, - 4 ) ), P.xz.sub( vec2( cx, - 4 ) ) ); pools = pools.add( vec3( 1.0, 0.55, 0.2 ).mul( c.x.mul( c.w ) ).mul( float( 46 ).div( d2.add( 900 ) ) ) ); } );
			// Wet streaks. A rough, damp surface seen at a grazing angle smears every light into a streak that runs straight
			// down the screen beneath it. A microfacet lobe cannot do that from 48 units up (the mirror point of a blast is
			// kilometres in front of it), so it is analytic: a gaussian in SCREEN x around each light, its width the source's
			// own width, broken by ripples and puddles, fading toward the viewer. Every fire is doubled in the ground.
			const sP = P.x.sub( cameraPosition.x ).div( cameraPosition.z.sub( P.z ) );
			const rip = noise( vec2( P.x.mul( 0.017 ), P.z.mul( 0.0035 ) ).add( vec2( 0, uTime.mul( 0.004 ) ) ) );
			const puddle = smoothstep( 0.28, 0.62, noise( P.xz.mul( 0.0042 ) ).b ).mul( 0.75 ).add( 0.25 );
			const spec = vec3( 0 ).toVar();
			Loop( { start: int( 0 ), end: int( NL ), type: 'int', condition: '<' }, ( { i } ) => {
				const lp = uLpos.element( i ), lc = uLcol.element( i ), depth = cameraPosition.z.sub( lp.z );
				const off = sP.sub( lp.x.sub( cameraPosition.x ).div( depth ) ).mul( depth ).add( rip.r.sub( 0.5 ).mul( lp.w ).mul( 0.9 ) ); // lateral miss, in world units at the light
				const sigma = lp.w.mul( 0.75 ).add( 3 );
				const lobe = exp( off.mul( off ).div( sigma.mul( sigma ).mul( 2 ) ).negate() );
				const reach = exp( P.z.div( lp.y.mul( 1.6 ).add( 120 ) ).negate() ); // a high light throws a longer streak
				spec.addAssign( lc.rgb.div( lp.w.mul( lp.w ).add( 80 ) ).mul( lobe ).mul( reach ) );
			} );
			const wet = min( spec.mul( apron ).mul( puddle ).mul( rip.g.mul( 0.7 ).add( 0.55 ) ).mul( 0.03 ), vec3( 3 ) );
			const c = lit.add( albedo.mul( pools ) ).add( wet ).add( vec3( 2.5, 0.5, 0.05 ).mul( ember.min( 1 ) ).mul( burnt ) );
			return vec4( fogged( c, P ), 1 );
		} )();
		const land = new THREE.Mesh( g, m ); land.frustumCulled = false; land.renderOrder = - 5; scene.add( land );
	}

	// ── cities: one instanced box for every building; windows are maths, not textures ─────────────────────────────────
	{
		const SKY = [ 12, 25, 19, 33, 16, 22 ]; // the 2D game's skyline, kept: each city wears it rotated by its id
		const rows = []; let s = 777; const rnd = () => ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
		CITY_X.forEach( ( cx, id ) => {
			for ( let i = 0; i < 6; i ++ ) rows.push( [ cx - 25 + i * 9 + 4, 0, ( rnd() - 0.5 ) * 4, 6.2 + rnd() * 1.4, SKY[ ( i + id ) % 6 ] * 1.12, 8 + rnd() * 3, id, rnd() ] );
			const nb = HIGH ? 10 : 6; for ( let i = 0; i < nb; i ++ ) rows.push( [ cx - 24 + rnd() * 48, 0, - 9 - rnd() * 15, 5 + rnd() * 6, 10 + rnd() * 28, 6 + rnd() * 6, id, rnd() ] );
			const nf = HIGH ? 8 : 4; for ( let i = 0; i < nf; i ++ ) rows.push( [ cx - 24 + rnd() * 48, 0, 9 + rnd() * 13, 5 + rnd() * 6, 3 + rnd() * 7, 6 + rnd() * 5, id, rnd() ] );
		} );
		const N = rows.length, a = new Float32Array( N * 4 ), b = new Float32Array( N * 4 );
		rows.forEach( ( r, i ) => { a.set( [ r[ 0 ], r[ 2 ], r[ 6 ], r[ 7 ] ], i * 4 ); b.set( [ r[ 3 ], r[ 4 ], r[ 5 ], 0 ], i * 4 ); } );
		const A = instancedBufferAttribute( new THREE.InstancedBufferAttribute( a, 4 ), 'vec4' ), B = instancedBufferAttribute( new THREE.InstancedBufferAttribute( b, 4 ), 'vec4' ); // x, z, cityId, seed · w, h, d
		const box = new THREE.BoxGeometry( 1, 1, 1 ); box.translate( 0, 0.5, 0 );
		const m = opaque( new THREE.MeshBasicNodeMaterial() );
		const city = uCity.element( int( A.z ) );
		// a dead city is rubble: every block drops to a stub of itself, and the stubs are uneven
		const hNow = B.y.mul( mix( float( 1 ), A.w.mul( 0.16 ).add( 0.05 ), city.y ) );
		m.positionNode = vec3( positionGeometry.x.mul( B.x ).add( A.x ), positionGeometry.y.mul( hNow ), positionGeometry.z.mul( B.z ).add( A.y ) );
		const dimV = vec3( B.x, hNow, B.z ).toVarying(), seedV = A.w.toVarying(), cityV = city.toVarying(), gN = normalGeometry.toVarying(), gP = positionGeometry.toVarying();
		m.colorNode = Fn( () => {
			const P = positionWorld, N = gN;
			const side = abs( N.z ).mul( gP.x ).add( abs( N.x ).mul( gP.z ) ).mul( mix( dimV.z, dimV.x, abs( N.z ) ) ); // metres along the facade
			const f = vec2( side.add( dimV.x.mul( 0.5 ) ), gP.y.mul( dimV.y ) ), cellSize = vec2( 1.9, 2.3 ), g = f.div( cellSize ), cell = floor( g ), q = fract( g );
			const wall = float( 1 ).sub( abs( N.y ) );
			const h1 = hash( cell.x.mul( 31.7 ).add( cell.y.mul( 113.3 ) ).add( seedV.mul( 977 ) ) ), h2 = hash( cell.x.mul( 7.1 ).add( cell.y.mul( 19.9 ) ).add( seedV.mul( 311 ) ) );
			const pane = smoothstep( 0.12, 0.2, q.x ).mul( smoothstep( 0.88, 0.8, q.x ) ).mul( smoothstep( 0.18, 0.3, q.y ) ).mul( smoothstep( 0.82, 0.7, q.y ) );
			const on = step( h1, float( 0.24 ) ).mul( step( 0.12, gP.y ) ); // a minority are lit; the ground floor is dark
			const tint = mix( vec3( 1.0, 0.60, 0.22 ).mul( 1.9 ), vec3( 0.72, 0.88, 1.0 ).mul( 2.0 ), step( 0.7, h2 ) ).mul( h2.mul( 0.7 ).add( 0.5 ) );
			// when a window is smaller than a couple of pixels, show the average instead of a shimmer
			const px = fwidth( g.x ).add( fwidth( g.y ) ), lod = smoothstep( 0.35, 1.1, px );
			const lights = mix( tint.mul( pane ).mul( on ), tint.mul( 0.24 * 0.4 ), lod ).mul( wall ).mul( abs( N.z ).mul( 0.75 ).add( 0.25 ) ).mul( cityV.x ).mul( cityV.w ).mul( float( 1 ).sub( cityV.y ) );
			const albedo = mix( vec3( 0.07, 0.075, 0.085 ), vec3( 0.04, 0.038, 0.035 ), seedV ).mul( mix( float( 1 ), float( 0.35 ), cityV.y ) );
			const lit = albedo.mul( uMoon.mul( max( dot( N, moonDir ), 0 ) ).add( ambient( N ) ).add( blastLight( P, N, float( 0.1 ) ) ) );
			const ember = vec3( 2.2, 0.45, 0.05 ).mul( cityV.z ).mul( step( 0.72, h1 ) ).mul( wall ).mul( sin( uTime.mul( 5 ).add( h2.mul( 40 ) ) ).mul( 0.4 ).add( 0.6 ) ); // a burning ruin glows in its gaps
			return vec4( fogged( lit.add( lights ).add( ember ), P ), 1 );
		} )();
		const mesh = new THREE.Mesh( box, m ); mesh.count = N; mesh.frustumCulled = false; mesh.renderOrder = - 2; scene.add( mesh );
	}

	// ── the three batteries: a sand-covered berm in the 2D mound's exact profile, a launcher, a mast ────────────────────
	{
		const parts = [];
		BASE_X.forEach( ( bx, id ) => {
			parts.push( prism( bx, 96, 58, 20, 60, id, 0 ) ); // berm: 96 wide at the foot, 58 at the top, 20 high, 60 deep
			parts.push( boxAt( bx, 20, 0, 14, 7, 12, id, 1 ) ); // launcher body at the 2D fire point
			for ( let k = - 1; k <= 1; k += 2 ) parts.push( boxAt( bx + k * 3.5, 27, 0, 2.2, id === 1 ? 13 : 9, 2.2, id, 1 ) ); // tubes (DELTA's are longer: it is the fast one)
			parts.push( boxAt( bx + 22, 20, - 8, 0.8, 18, 0.8, id, 2 ) ); // mast
		} );
		const g = mergeGeos( parts ), m = opaque( new THREE.MeshBasicNodeMaterial() );
		const kind = attribute( 'kind', 'vec2' ), nrm = attribute( 'normal', 'vec3' ); // baseId, part
		const kV = kind.toVarying();
		m.colorNode = Fn( () => {
			const P = positionWorld, N = normalize( nrm ), st = uBase.element( int( kV.x ) );
			const sand = vec3( 0.24, 0.20, 0.15 ).mul( noise( P.xz.mul( 0.05 ) ).r.mul( 0.5 ).add( 0.75 ) ), steel = vec3( 0.09, 0.10, 0.11 );
			const albedo = mix( sand, steel, step( 0.5, kV.y ) ).mul( mix( float( 0.3 ), float( 1 ), st.x ) );
			const lit = albedo.mul( uMoon.mul( max( dot( N, moonDir ), 0 ).add( 0.05 ) ).add( ambient( N ) ).add( blastLight( P, N, float( 0.05 ) ) ) );
			return vec4( fogged( lit, P ), 1 );
		} )();
		const mesh = new THREE.Mesh( g, m ); mesh.frustumCulled = false; mesh.renderOrder = - 2; scene.add( mesh );
	}

	return { NL, uLpos, uLcol, uCity, uBase, scorch, blastLight, ambient, fogged, moonDir, uMoon, uFog };

}

// ── small CPU helpers ─────────────────────────────────────────────────────────────────────────────────────────────
function smooth( a, b, x ) { const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); }
function makeValueNoise( seed ) {
	const p = new Uint8Array( 512 ); let s = seed >>> 0; for ( let i = 0; i < 256; i ++ ) p[ i ] = i;
	for ( let i = 255; i > 0; i -- ) { s = ( s * 1664525 + 1013904223 ) >>> 0; const j = s % ( i + 1 ); const t = p[ i ]; p[ i ] = p[ j ]; p[ j ] = t; }
	for ( let i = 0; i < 256; i ++ ) p[ 256 + i ] = p[ i ];
	return ( x, y ) => { const xi = Math.floor( x ), yi = Math.floor( y ), tx = x - xi, ty = y - yi, sx = tx * tx * ( 3 - 2 * tx ), sy = ty * ty * ( 3 - 2 * ty );
		const h = ( i, j ) => p[ p[ i & 255 ] + ( j & 255 ) ] / 255; const a = h( xi, yi ), b = h( xi + 1, yi ), c = h( xi, yi + 1 ), d = h( xi + 1, yi + 1 );
		return a + ( b - a ) * sx + ( c - a ) * sy + ( a - b - c + d ) * sx * sy; };
}
function tag( g, id, part ) { const n = g.attributes.position.count, k = new Float32Array( n * 2 ); for ( let i = 0; i < n; i ++ ) { k[ i * 2 ] = id; k[ i * 2 + 1 ] = part; } g.setAttribute( 'kind', new THREE.BufferAttribute( k, 2 ) ); return g; }
function boxAt( x, y, z, w, h, d, id, part ) { const g = new THREE.BoxGeometry( w, h, d ).toNonIndexed(); g.translate( x, y + h / 2, z ); g.deleteAttribute( 'uv' ); return tag( g, id, part ); }
function prism( x, wFoot, wTop, h, depth, id, part ) { // a trapezoid extruded along z
	const f = wFoot / 2, t = wTop / 2, d = depth / 2, v = [ [ - f, 0 ], [ f, 0 ], [ t, h ], [ - t, h ] ], tri = [];
	const P = ( i, z ) => [ x + v[ i ][ 0 ], v[ i ][ 1 ], z ], quad = ( a, b, c, e ) => tri.push( ...a, ...b, ...c, ...a, ...c, ...e );
	quad( P( 0, d ), P( 1, d ), P( 2, d ), P( 3, d ) ); quad( P( 1, - d ), P( 0, - d ), P( 3, - d ), P( 2, - d ) ); // front, back
	quad( P( 3, d ), P( 2, d ), P( 2, - d ), P( 3, - d ) ); quad( P( 1, d ), P( 1, - d ), P( 2, - d ), P( 2, d ) ); quad( P( 0, - d ), P( 0, d ), P( 3, d ), P( 3, - d ) ); // top, right, left
	const g = new THREE.BufferGeometry(); g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( tri ), 3 ) ); g.computeVertexNormals(); return tag( g, id, part );
}
function mergeGeos( list ) {
	const names = [ 'position', 'normal', 'kind' ], out = new THREE.BufferGeometry();
	for ( const n of names ) { const size = list[ 0 ].attributes[ n ].itemSize, total = list.reduce( ( s, g ) => s + g.attributes[ n ].count, 0 ), arr = new Float32Array( total * size ); let o = 0;
		for ( const g of list ) { arr.set( g.attributes[ n ].array, o ); o += g.attributes[ n ].array.length; } out.setAttribute( n, new THREE.BufferAttribute( arr, size ) ); }
	return out;
}
