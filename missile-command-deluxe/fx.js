// fx.js — MISSILE COMMAND DELUXE: everything that flies, burns and drifts.
// Stateless GPU particles: the CPU writes one spawn record per particle into a ring buffer (where, how fast, when, how
// long) and never touches it again — position, size, heat and fade are closed-form functions of (world time − birth) in
// the vertex stage. No compute shaders, so the WebGL2 backend runs the same code. One draw call per pool.
import * as THREE from 'three/webgpu';
import {
	Fn, instancedDynamicBufferAttribute, instanceIndex, positionGeometry, uv, vec2, vec3, vec4, float, mix, smoothstep, step, clamp, sin, cos, abs, max, min, pow, exp, sqrt, atan, length, normalize, hash, rotateUV,
} from 'three/tsl';

export function buildFx( ctx ) {

	const { scene, HIGH, uTime, noise, land, reduceMotion } = ctx;
	const SMOKE_GAIN = reduceMotion ? 0.5 : 1; // the clarity profile: half the smoke
	const Q = HIGH ? 1 : 0.4; // how many particles a phone gets

	function ring( n, sizes ) {
		const attrs = sizes.map( ( s ) => { const a = new THREE.InstancedBufferAttribute( new Float32Array( n * s ), s ); a.setUsage( THREE.DynamicDrawUsage ); return a; } );
		attrs[ 0 ].array.fill( - 1e6 ); // born long ago = dead (birth lives in slot 0's w)
		return { n, head: 0, dirty: false, attrs, nodes: attrs.map( ( a ) => instancedDynamicBufferAttribute( a, 'vec' + a.itemSize ) ),
			put( ...vals ) { const i = this.head; this.head = ( i + 1 ) % n; for ( let k = 0; k < attrs.length; k ++ ) attrs[ k ].array.set( vals[ k ], i * attrs[ k ].itemSize ); this.dirty = true; },
			flush() { if ( this.dirty ) { for ( const a of attrs ) a.needsUpdate = true; this.dirty = false; } } };
	}

	// ── SPARKS: embers, shrapnel, tracer sparks. Hot, additive, stretched along their flight. ───────────────────────────
	//   a = x, y, z, birth · b = vx, vy, vz, life · c = size, heat (0..1), gravity, drag
	const SP = ring( HIGH ? 7000 : 2400, [ 4, 4, 4 ] );
	{
		const [ a, b, c ] = SP.nodes;
		const age = uTime.sub( a.w ), life = b.w.max( 0.01 ), t = age.div( life ).clamp( 0, 1 ), alive = step( 0, age ).mul( step( age, life ) );
		const k = c.w.max( 0.01 ), tau = float( 1 ).sub( exp( age.mul( k ).negate() ) ).div( k ); // distance covered under drag
		const vNow = b.xyz.mul( exp( age.mul( k ).negate() ) ).add( vec3( 0, c.z.negate(), 0 ).mul( age ) );
		const y = a.y.add( b.y.mul( tau ) ).sub( c.z.mul( age ).mul( age ).mul( 0.5 ) );
		const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false } );
		m.positionNode = vec3( a.x.add( b.x.mul( tau ) ), abs( y ).mul( mix( float( 1 ), float( 0.35 ), step( y, 0 ) ) ), a.z.add( b.z.mul( tau ) ) ); // one skip off the desert floor
		const speed = length( vNow.xy );
		m.scaleNode = vec2( c.x.mul( speed.mul( 0.045 ).add( 1 ) ), c.x ).mul( alive ).mul( float( 1 ).sub( t.mul( t ) ) );
		m.rotationNode = atan( vNow.y, vNow.x );
		const tV = t.toVarying(), heatV = c.y.toVarying(), seedV = hash( instanceIndex ).toVarying();
		m.colorNode = Fn( () => {
			const p = uv().sub( 0.5 ).mul( 2 ), g = exp( p.x.mul( p.x ).mul( - 2.2 ).add( p.y.mul( p.y ).mul( - 7 ) ) );
			const T = heatV.mul( float( 1 ).sub( tV ).pow( 1.4 ) ).mul( seedV.mul( 0.5 ).add( 0.75 ) );
			const hot = mix( mix( vec3( 1.6, 0.16, 0.01 ), vec3( 9, 3.2, 0.45 ), smoothstep( 0.15, 0.6, T ) ), vec3( 20, 15, 9 ), smoothstep( 0.6, 1.0, T ) );
			return vec4( hot.mul( g ).mul( smoothstep( 0.0, 0.06, T ) ), g );
		} )();
		const s = new THREE.Sprite( m ); s.count = SP.n; s.frustumCulled = false; s.renderOrder = 45; scene.add( s );
	}

	// ── SMOKE + DUST: soft, noise-eroded puffs that rise and drift, lit by the moon's rim and by every fire near them. ──────
	//   a = x, y, z, birth · b = vx, vy, vz, life · c = r0, r1, alpha, albedo
	const SM = ring( HIGH ? 2000 : 800, [ 4, 4, 4 ] ); // sized for the worst ten seconds (a panic volley, a chain, every site burning): a ring that wraps early pops long-lived smoke out mid-life
	{
		const [ a, b, c ] = SM.nodes;
		const age = uTime.sub( a.w ), life = b.w.max( 0.01 ), t = age.div( life ).clamp( 0, 1 ), alive = step( 0, age ).mul( step( age, life ) );
		const centre = a.xyz.add( b.xyz.mul( age ).mul( float( 1 ).sub( t.mul( 0.35 ) ) ) ).add( vec3( age.mul( 7 ), 0, 0 ) ); // slowing as it cools; a light wind from the left
		const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, depthTest: false, fog: false } );
		m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
		m.positionNode = centre;
		m.scaleNode = mix( c.x, c.y, sqrt( t ) ).mul( 2 ).mul( alive );
		const seed = hash( instanceIndex ); m.rotationNode = seed.mul( 6.283 ).add( age.mul( seed.sub( 0.5 ) ).mul( 0.5 ) );
		const tV = t.toVarying(), cV = c.toVarying(), seedV = seed.toVarying(), PV = centre.toVarying();
		m.colorNode = Fn( () => {
			const p = uv().sub( 0.5 ).mul( 2 ), d = p.length();
			const n = noise( uv().mul( 0.55 ).add( vec2( seedV.mul( 9.1 ), seedV.mul( 4.3 ) ) ).add( vec2( 0, tV.mul( - 0.12 ) ) ) );
			const body = smoothstep( 1.0, 0.2, d.add( n.r.sub( 0.5 ).mul( 0.9 ) ) ).mul( n.g.mul( 0.5 ).add( 0.6 ) );
			const fade = smoothstep( 0.0, 0.12, tV ).mul( float( 1 ).sub( smoothstep( 0.45, 1.0, tV ) ) );
			const alpha = body.mul( fade ).mul( cV.z ).clamp( 0, 0.9 );
			// lit from inside by whatever burns nearby (wrap), rimmed by the moon on the side facing it
			const N = normalize( vec3( p.x, p.y, 0.6 ) );
			const lightIn = land.blastLight( PV, N, float( 0.6 ) ).add( land.ambient( N ).mul( 2.2 ) ).add( land.uMoon.mul( max( N.x.mul( 0.5 ).add( N.y.mul( 0.5 ) ), 0 ).mul( 0.9 ) ) );
			return vec4( vec3( cV.w ).mul( min( lightIn, vec3( 2.2, 1.5, 1.0 ) ) ).mul( alpha ), alpha ); // soot and dust absorb: lit hard by the fire beside them, never to white
		} )();
		const s = new THREE.Sprite( m ); s.count = SM.n; s.frustumCulled = false; s.renderOrder = 30; scene.add( s );
	}

	// ── FLAMES: the fires that stay. Rewritten each frame from the few sites that burn.  a = x, y, z, size · b = seed, power ─
	const NF = 60, fA = new THREE.InstancedBufferAttribute( new Float32Array( NF * 4 ), 4 ), fB = new THREE.InstancedBufferAttribute( new Float32Array( NF * 4 ), 4 );
	fA.setUsage( THREE.DynamicDrawUsage ); fB.setUsage( THREE.DynamicDrawUsage );
	{
		const a = instancedDynamicBufferAttribute( fA, 'vec4' ), b = instancedDynamicBufferAttribute( fB, 'vec4' );
		const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false } );
		m.positionNode = vec3( a.x, a.y.add( a.w.mul( 0.5 ) ), a.z ); m.scaleNode = vec2( a.w.mul( 0.62 ), a.w );
		const bV = b.toVarying();
		m.colorNode = Fn( () => {
			const q = uv(), seed = bV.x, tt = uTime.mul( 1.35 ).add( seed.mul( 17 ) );
			// tongues: noise scrolling upward bends the column; the mask narrows and tears toward the top
			const w1 = noise( vec2( q.x.mul( 0.33 ).add( seed ), q.y.mul( 0.25 ).sub( tt.mul( 0.42 ) ) ) ).r, w2 = noise( vec2( q.x.mul( 0.9 ).add( seed.mul( 3 ) ), q.y.mul( 0.7 ).sub( tt.mul( 0.9 ) ) ) ).g;
			const x = q.x.sub( 0.5 ).add( w1.sub( 0.5 ).mul( q.y ).mul( 0.55 ) ).mul( 2 );
			const width = float( 1 ).sub( q.y ).pow( 0.6 ).mul( 0.9 ).mul( w2.mul( 0.5 ).add( 0.75 ) );
			const shape = smoothstep( width, width.mul( 0.1 ), abs( x ) ).mul( smoothstep( 0.0, 0.1, q.y ) );
			const tear = smoothstep( 0.2, 0.75, w2.add( float( 1 ).sub( q.y ).mul( 0.75 ) ) );
			const f = shape.mul( tear ), T = f.mul( float( 1.1 ).sub( q.y.mul( 0.7 ) ) ).mul( bV.y );
			const col = mix( mix( vec3( 0.9, 0.06, 0.0 ), vec3( 4.2, 1.0, 0.07 ), smoothstep( 0.1, 0.5, T ) ), vec3( 8.5, 4.6, 1.1 ), smoothstep( 0.62, 1.0, T ) );
			return vec4( col.mul( f ).mul( 0.7 ), f );
		} )();
		const s = new THREE.Sprite( m ); s.count = NF; s.frustumCulled = false; s.renderOrder = 35; scene.add( s );
	}

	// ── emitters ─────────────────────────────────────────────────────────────────────────────────────────────────
	const R = Math.random, now = () => uTime.value;
	const clocks = new WeakMap(), due = ( o, dt, every ) => { const t = ( clocks.get( o ) || 0 ) + dt; if ( t > every ) { clocks.set( o, 0 ); return true; } clocks.set( o, t ); return false; }; // per-object emit timers, kept HERE: the simulation's objects are never written to
	function sparks( x, y, z, n, o = {} ) {
		n = Math.max( 1, Math.round( n * Q ) ); const { speed = [ 40, 160 ], life = [ 0.5, 1.4 ], size = [ 1.6, 3.4 ], heat = [ 0.75, 0.95 ], g = 110, drag = 1.4, up = 0.3, cone = null, spread = 3 } = o;
		for ( let i = 0; i < n; i ++ ) {
			const ang = cone ? cone[ 0 ] + R() * ( cone[ 1 ] - cone[ 0 ] ) : R() * Math.PI * 2, sp = speed[ 0 ] + Math.pow( R(), 1.6 ) * ( speed[ 1 ] - speed[ 0 ] );
			SP.put( [ x + ( R() - 0.5 ) * spread, y + ( R() - 0.5 ) * spread, z + ( R() - 0.5 ) * 6, now() - R() * 0.03 ], [ Math.cos( ang ) * sp, Math.sin( ang ) * sp + up * sp, ( R() - 0.5 ) * sp * 0.5, life[ 0 ] + R() * ( life[ 1 ] - life[ 0 ] ) ],
				[ size[ 0 ] + R() * ( size[ 1 ] - size[ 0 ] ), heat[ 0 ] + R() * ( heat[ 1 ] - heat[ 0 ] ), g, drag ] );
		}
	}
	function smoke( x, y, z, o = {} ) {
		const { v = [ 0, 9, 0 ], life = 5, r0 = 10, r1 = 40, alpha = 0.22, albedo = 0.08, jitter = 0, delay = 0 } = o;
		SM.put( [ x + ( R() - 0.5 ) * jitter, y + ( R() - 0.5 ) * jitter, z + ( R() - 0.5 ) * 8, now() + delay ], [ v[ 0 ] + ( R() - 0.5 ) * 6, v[ 1 ] + ( R() - 0.5 ) * 4, v[ 2 ], life * ( 0.8 + R() * 0.4 ) ], [ r0, r1, alpha * SMOKE_GAIN, albedo ] );
	}

	// what each event looks like
	const calm = ( S ) => S.blasts.length > 8; // late-wave chains: drop the cosmetic layers before they turn the field to mud
	const api = {
		blast( b, fyv, S ) { // an interceptor going off, or an enemy dying in one
			const k = b.max / 49;
			sparks( b.x, fyv, 1, b.hostile ? 120 : 90, { speed: [ 50 * k, 190 * k ], heat: [ 0.8, 1 ], life: [ 0.5, 1.5 ] } );
			if ( ! calm( S ) ) for ( let i = 0, n = HIGH ? 9 : 4; i < n; i ++ ) { const a = R() * 6.283, d = R() * b.max * 0.7; // the after-image: smoke where the fire was, once it cools
				smoke( b.x + Math.cos( a ) * d, fyv + Math.sin( a ) * d, - 2, { delay: b.life * ( 0.45 + R() * 0.3 ), v: [ 0, 8 + R() * 6, 0 ], life: 5, r0: b.max * 0.45, r1: Math.min( 55, b.max * 1.05 ), alpha: 0.2, albedo: 0.09 } ); }
		},
		impact( e, destroyed ) { // a warhead reaching the ground: dirt fingers, a dust skirt along the floor, burning fragments
			sparks( e.x, 2, 1, 140, { speed: [ 60, 210 ], cone: [ 0.55, 2.6 ], up: 0.2, heat: [ 0.7, 1 ], life: [ 0.7, 1.9 ], g: 150, spread: 8 } );
			for ( let i = 0, n = HIGH ? 12 : 6; i < n; i ++ ) { const dir = i % 2 ? 1 : - 1; smoke( e.x + dir * R() * 14, 5 + R() * 5, 4, { v: [ dir * ( 25 + R() * 55 ), 2 + R() * 5, 0 ], life: 2.4, r0: 6, r1: 18 + R() * 10, alpha: 0.24, albedo: 0.22 } ); }
			for ( let i = 0, n = HIGH ? 7 : 4; i < n; i ++ ) smoke( e.x + ( R() - 0.5 ) * 24, 8 + R() * 20, 2, { v: [ ( R() - 0.5 ) * 18, 26 + R() * 30, 0 ], life: 3.2, r0: 7, r1: 26, alpha: 0.26, albedo: 0.13, delay: R() * 0.15 } );
			if ( destroyed ) api.ruin( e.x, 'ammo' in e.target );
		},
		ruin( x, isBase ) { // a city, or a battery, coming apart
			sparks( x, 12, 1, 260, { speed: [ 40, 260 ], cone: [ 0.3, 2.85 ], up: 0.35, heat: [ 0.6, 1 ], life: [ 1.0, 2.6 ], g: 130, size: [ 2, 4.5 ], spread: 40 } );
			for ( let i = 0, n = HIGH ? 14 : 7; i < n; i ++ ) smoke( x + ( R() - 0.5 ) * 60, 6 + R() * 26, ( R() - 0.5 ) * 30, { v: [ ( R() - 0.5 ) * 30, 12 + R() * 22, 0 ], life: 4.5, r0: 11, r1: 40, alpha: 0.3, albedo: isBase ? 0.09 : 0.15, delay: R() * 0.5 } );
		},
		kill( e, fyv ) { sparks( e.x, fyv, 1, e.type === 'missile' ? 30 : 110, { speed: [ 60, 240 ], heat: [ 0.85, 1 ], life: [ 0.4, 1.2 ], size: [ 1.4, 3 ] } ); },
		split( e, fyv ) { sparks( e.x, fyv, 1, 26, { speed: [ 30, 120 ], heat: [ 0.9, 1 ], life: [ 0.25, 0.6 ], g: 40, size: [ 1.2, 2.4 ] } ); },
		launch( shot, fyv ) { // the tube coughs: a flash of sparks up the bore, a roll of exhaust at the foot of the battery
			const a = Math.atan2( fyv( shot.ty ) - fyv( shot.oy ), shot.tx - shot.ox );
			sparks( shot.ox, fyv( shot.oy ) + 6, 1, 26, { speed: [ 40, 170 ], cone: [ a - 0.35, a + 0.35 ], up: 0, heat: [ 0.85, 1 ], life: [ 0.2, 0.5 ], g: 30, size: [ 1.4, 2.6 ] } );
			for ( let i = 0; i < ( HIGH ? 4 : 2 ); i ++ ) smoke( shot.ox + ( R() - 0.5 ) * 12, fyv( shot.oy ) + 2, 6, { v: [ ( R() - 0.5 ) * 30, 6 + R() * 8, 0 ], life: 2.2, r0: 5, r1: 20, alpha: 0.3, albedo: 0.3 } );
		},
		// what runs every frame: exhaust behind each interceptor, a shimmer of sparks off each warhead, the fires that stay
		update( S, dt, t, fyv, cities, bases ) {
			for ( const s of S.shots ) { if ( due( s, dt, HIGH ? 0.016 : 0.04 ) ) { smoke( s.x, fyv( s.y ), - 1, { v: [ 0, 2, 0 ], life: 1.2, r0: 1.6, r1: 6.5, alpha: 0.13, albedo: 0.42, jitter: 1.5 } );
				const dx = s.tx - s.x, dy = fyv( s.ty ) - fyv( s.y ), d = Math.hypot( dx, dy ) || 1; sparks( s.x, fyv( s.y ), 1, 2, { speed: [ 20, 90 ], cone: [ Math.atan2( - dy, - dx ) - 0.3, Math.atan2( - dy, - dx ) + 0.3 ], up: 0, heat: [ 0.8, 1 ], life: [ 0.12, 0.3 ], g: 10, size: [ 1.2, 2.2 ], spread: 1 } ); } }
			for ( const e of S.enemies ) if ( e.type === 'missile' || e.type === 'smart' ) { if ( due( e, dt, HIGH ? 0.05 : 0.11 ) ) { // ablation: the warhead sheds glowing flakes as it comes down
				sparks( e.x, fyv( e.y ), 1, 1, { speed: [ 5, 30 ], heat: [ 0.55, 0.85 ], life: [ 0.25, 0.7 ], g: - 8, drag: 3, size: [ 1, 2 ], spread: 1.5 } ); } }
			let f = 0; const flame = ( x, y, z, size, power ) => { if ( f < NF ) { fA.array.set( [ x, y, z, size ], f * 4 ); fB.array.set( [ ( x * 0.137 + f * 0.31 ) % 1, power, 0, 0 ], f * 4 ); f ++; } };
			const burnAt = ( x, k, wide, i ) => { if ( k.burn <= 0.02 ) return;
				const n = HIGH ? 5 : 3; for ( let j = 0; j < n; j ++ ) { const u = ( j + 0.5 ) / n - 0.5, h = ( 16 + 14 * ( ( j * 7 + i * 3 ) % 5 ) / 4 ) * ( 0.55 + 0.45 * k.burn ); flame( x + u * wide, 1, 3 - j, h, 0.75 + 0.25 * k.burn ); }
				if ( due( k, dt, HIGH ? 0.16 : 0.34 ) ) { smoke( x + ( R() - 0.5 ) * wide * 0.7, 18 + R() * 10, - 6, { v: [ 4 + R() * 6, 17 + R() * 9, 0 ], life: 9, r0: 8, r1: 42, alpha: 0.24 * ( 0.5 + 0.5 * k.burn ), albedo: 0.06 } );
					if ( R() < 0.5 ) sparks( x + ( R() - 0.5 ) * wide * 0.6, 8 + R() * 8, 1, 2, { speed: [ 8, 40 ], cone: [ 1.1, 2.0 ], up: 0.6, heat: [ 0.6, 0.9 ], life: [ 1.0, 2.8 ], g: - 14, drag: 0.8, size: [ 1, 2 ] } ); } };
			S.cities.forEach( ( c, i ) => burnAt( c.x, cities[ i ], 44, i ) ); S.bases.forEach( ( b, i ) => burnAt( b.x, bases[ i ], 40, i + 6 ) );
			fA.array.fill( 0, f * 4 ); fB.array.fill( 0, f * 4 ); fA.needsUpdate = true; fB.needsUpdate = true;
			SP.flush(); SM.flush();
		},
		reset() { SP.attrs[ 0 ].array.fill( - 1e6 ); SM.attrs[ 0 ].array.fill( - 1e6 ); SP.dirty = SM.dirty = true; },
	};
	return api;

}
