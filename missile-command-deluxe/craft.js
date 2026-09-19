// craft.js — MISSILE COMMAND DELUXE: the bomber and the satellite, as objects. Built from primitives (no model files), a
// handful of pooled meshes made once; lit by the moon's rim, by the sky, and by every blast near them.
import * as THREE from 'three/webgpu';
import { Fn, attribute, positionWorld, normalWorld, cameraPosition, vec3, vec4, float, mix, step, max, pow, dot, normalize } from 'three/tsl';

export function buildCraft( ctx ) {

	const { scene, land } = ctx;
	const SLOTS = 5, park = ( m ) => { m.position.set( 0, - 1e5, 0 ); };

	function lit( albedoNode ) {
		const m = new THREE.MeshBasicNodeMaterial(); m.fog = false;
		m.colorNode = Fn( () => {
			const P = positionWorld, N = normalize( normalWorld ), V = normalize( cameraPosition.sub( P ) );
			const rim = pow( float( 1 ).sub( dot( N, V ).clamp( 0, 1 ) ), 2.5 ).mul( 1.1 ); // a cold edge of moonlight: the silhouette always reads against the sky
			const c = albedoNode.mul( land.uMoon.mul( max( dot( N, land.moonDir ), 0 ).mul( 2 ) ).add( land.ambient( N ).mul( 3 ) ).add( land.blastLight( P, N, float( 0.15 ) ) ) ).add( land.uMoon.mul( rim ) );
			return vec4( c, 1 );
		} )();
		return m;
	}
	const tint = attribute( 'tint', 'vec3' );
	const mat = lit( tint );

	// the bomber: a swept flying wing, nose toward +x
	const bomberGeo = merge( [
		part( new THREE.CylinderGeometry( 2.3, 1.1, 34, 10 ).rotateZ( - Math.PI / 2 ), [ 0.10, 0.11, 0.12 ] ),
		part( new THREE.ConeGeometry( 2.3, 7, 10 ).rotateZ( - Math.PI / 2 ).translate( 20.5, 0, 0 ), [ 0.10, 0.11, 0.12 ] ),
		part( new THREE.BoxGeometry( 13, 0.7, 19 ).rotateY( 0.5 ).translate( - 3, - 0.4, 10 ), [ 0.08, 0.09, 0.10 ] ),
		part( new THREE.BoxGeometry( 13, 0.7, 19 ).rotateY( - 0.5 ).translate( - 3, - 0.4, - 10 ), [ 0.08, 0.09, 0.10 ] ),
		part( new THREE.BoxGeometry( 7, 7, 0.6 ).translate( - 14, 4, 0 ), [ 0.09, 0.10, 0.11 ] ),
		part( new THREE.BoxGeometry( 4.5, 0.5, 11 ).translate( - 15, 1, 0 ), [ 0.08, 0.09, 0.10 ] ),
		part( new THREE.CylinderGeometry( 1.2, 1.2, 6, 8 ).rotateZ( - Math.PI / 2 ).translate( - 2, - 1.6, 6.5 ), [ 0.05, 0.05, 0.06 ] ),
		part( new THREE.CylinderGeometry( 1.2, 1.2, 6, 8 ).rotateZ( - Math.PI / 2 ).translate( - 2, - 1.6, - 6.5 ), [ 0.05, 0.05, 0.06 ] ),
	] );
	// the satellite: a gold-foil bus, two dark solar wings, a dish
	const satGeo = merge( [
		part( new THREE.BoxGeometry( 9, 9, 9 ), [ 0.55, 0.40, 0.12 ] ),
		part( new THREE.BoxGeometry( 15, 0.4, 8 ).translate( 13, 0, 0 ), [ 0.03, 0.05, 0.14 ] ),
		part( new THREE.BoxGeometry( 15, 0.4, 8 ).translate( - 13, 0, 0 ), [ 0.03, 0.05, 0.14 ] ),
		part( new THREE.BoxGeometry( 4, 0.6, 0.6 ).translate( 6.5, 0, 0 ), [ 0.2, 0.2, 0.2 ] ), part( new THREE.BoxGeometry( 4, 0.6, 0.6 ).translate( - 6.5, 0, 0 ), [ 0.2, 0.2, 0.2 ] ),
		part( new THREE.ConeGeometry( 4, 3, 12, 1, true ).rotateX( Math.PI ).translate( 0, - 6.5, 0 ), [ 0.5, 0.5, 0.52 ] ),
	] );
	const mk = ( geo ) => Array.from( { length: SLOTS }, () => { const m = new THREE.Mesh( geo, mat ); m.frustumCulled = false; m.renderOrder = - 1; park( m ); scene.add( m ); return { mesh: m, e: null }; } );
	const pools = { bomber: mk( bomberGeo ), satellite: mk( satGeo ) };

	return {
		sync( S, t, fy, dot, E ) {
			for ( const type of [ 'bomber', 'satellite' ] ) {
				const pool = pools[ type ], alive = new Set( S.enemies.filter( ( e ) => e.type === type ) );
				for ( const s of pool ) if ( s.e && ! alive.has( s.e ) ) { s.e = null; park( s.mesh ); }
				for ( const e of alive ) { let s = pool.find( ( k ) => k.e === e ) || pool.find( ( k ) => ! k.e ); if ( ! s ) continue; s.e = e;
					const m = s.mesh; m.position.set( e.x, fy( e.y ), 0 ); const K = 1.3; // a touch larger than life: they must read at arcade speed
					if ( type === 'bomber' ) { m.scale.set( e.direction * K, K, K ); m.rotation.set( Math.sin( t * 0.9 + e.y ) * 0.06, 0, e.direction * - 0.03 );
						dot( e.x - e.direction * 19, e.y + 1.5, 9, [ 1, 0.55, 0.2 ], 5 ); // the engines
						if ( ( t * 1.6 + e.y * 0.01 ) % 1 < 0.18 ) dot( e.x + e.direction * 2, e.y + 3, 8, E, 7 ); // the belly beacon, in the enemy's colour
					} else { m.scale.setScalar( K ); m.rotation.set( t * 0.35 + e.y, 0.4, 0.2 ); if ( ( t * 2 + e.y * 0.01 ) % 1 < 0.2 ) dot( e.x, e.y, 9, E, 7 ); }
				}
			}
		},
	};

}

function part( g, rgb ) { g = g.toNonIndexed(); g.deleteAttribute( 'uv' ); const n = g.attributes.position.count, c = new Float32Array( n * 3 ); for ( let i = 0; i < n; i ++ ) c.set( rgb, i * 3 ); g.setAttribute( 'tint', new THREE.BufferAttribute( c, 3 ) ); return g; }
function merge( list ) {
	const out = new THREE.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'tint' ] ) { const total = list.reduce( ( s, g ) => s + g.attributes[ name ].array.length, 0 ), arr = new Float32Array( total ); let o = 0;
		for ( const g of list ) { arr.set( g.attributes[ name ].array, o ); o += g.attributes[ name ].array.length; } out.setAttribute( name, new THREE.BufferAttribute( arr, 3 ) ); }
	return out;
}
