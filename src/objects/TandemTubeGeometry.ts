import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * One-piece double (tandem) tube body: a racetrack-shaped outer tube with
 * straight, fuller sides and rounded ends, split into two seats by a slimmer
 * cross-bar. Built as a signed-distance field and meshed with marching cubes,
 * so the cross-bar blends into the sides with a smooth fillet instead of two
 * rings intersecting.
 *
 * Coordinates: X runs front-to-back (seats at -X and +X), Z is across, Y up.
 */
export interface TandemTubeShape {
  /** Half length of the straight sides (distance from centre to each end-cap centre). */
  halfLength: number;
  /** Half width of the centreline (distance from the long axis to each side tube's centre). */
  halfWidth: number;
  /** Tube radius along the straight sides. */
  sideRadius: number;
  /** Tube radius around the rounded ends. */
  capRadius: number;
  /** Tube radius of the middle cross-bar. */
  dividerRadius: number;
  /** Fillet size where the cross-bar meets the sides. */
  blend?: number;
  /** Marching-cubes grid resolution (higher = smoother, slower to build). */
  resolution?: number;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth minimum: blends two distance fields with a fillet of size k. */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Signed distance from (x, y, z) to the tandem tube surface (negative inside). */
export function tandemTubeDistance(shape: TandemTubeShape, x: number, y: number, z: number) {
  const { halfLength: L, halfWidth: W, sideRadius: rs, capRadius: rc, dividerRadius: rd } = shape;
  const ax = Math.abs(x);
  const az = Math.abs(z);

  // Outer racetrack: distance in the XZ plane to its centreline.
  const outline = ax <= L ? Math.abs(az - W) : Math.abs(Math.hypot(ax - L, z) - W);
  // Fuller on the straight sides, easing down to the end-cap radius.
  const radius = rs + (rc - rs) * smoothstep(L - 0.5 * W, L + 0.5 * W, ax);
  const outer = Math.hypot(outline, y) - radius;

  // Cross-bar: segment along Z at x = 0, ending inside the side tubes.
  const bar = Math.hypot(Math.hypot(ax, Math.max(az - W, 0)), y) - rd;

  return smin(outer, bar, shape.blend ?? 0.05);
}

/** Builds the indexed body geometry (position + normal + placeholder uv). */
export function buildTandemTubeBody(shape: TandemTubeShape): THREE.BufferGeometry {
  const N = shape.resolution ?? 112;
  // Field cube spans [-S, S] on every axis; leave a margin around the tube.
  const S = shape.halfLength + shape.halfWidth + Math.max(shape.sideRadius, shape.capRadius) + 0.06;

  const mc = new MarchingCubes(N, new THREE.MeshBasicMaterial(), false, false, 90000);
  mc.isolation = 0;
  const half = N / 2;
  for (let k = 0; k < N; k++) {
    const z = ((k - half) / half) * S;
    for (let j = 0; j < N; j++) {
      const y = ((j - half) / half) * S;
      for (let i = 0; i < N; i++) {
        const x = ((i - half) / half) * S;
        // MarchingCubes treats field > isolation as inside, so flip the SDF sign.
        mc.field[k * N * N + j * N + i] = -tandemTubeDistance(shape, x, y, z);
      }
    }
  }
  mc.update();

  const count = mc.count;
  const positions = new Float32Array(count * 3);
  const src = mc.geometry.getAttribute('position').array as Float32Array;
  for (let i = 0; i < count * 3; i++) positions[i] = src[i] * S;

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry = mergeVertices(geometry, 1e-5);

  // Smooth normals straight from the distance field's gradient.
  const pos = geometry.getAttribute('position');
  const normals = new Float32Array(pos.count * 3);
  const e = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = new THREE.Vector3(
      tandemTubeDistance(shape, x + e, y, z) - tandemTubeDistance(shape, x - e, y, z),
      tandemTubeDistance(shape, x, y + e, z) - tandemTubeDistance(shape, x, y - e, z),
      tandemTubeDistance(shape, x, y, z + e) - tandemTubeDistance(shape, x, y, z - e)
    ).normalize();
    normals.set([n.x, n.y, n.z], i * 3);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  // Make triangle winding face outward (agree with the field normals).
  const index = geometry.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let agree = 0;
  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(pos, index.getX(t));
    b.fromBufferAttribute(pos, index.getX(t + 1));
    c.fromBufferAttribute(pos, index.getX(t + 2));
    const face = b.sub(a).cross(c.sub(a));
    const nx = normals[index.getX(t) * 3];
    const ny = normals[index.getX(t) * 3 + 1];
    const nz = normals[index.getX(t) * 3 + 2];
    agree += face.x * nx + face.y * ny + face.z * nz > 0 ? 1 : -1;
  }
  if (agree < 0) {
    for (let t = 0; t < index.count; t += 3) {
      const i1 = index.getX(t + 1);
      index.setX(t + 1, index.getX(t + 2));
      index.setX(t + 2, i1);
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  mc.geometry.dispose();
  return geometry;
}
