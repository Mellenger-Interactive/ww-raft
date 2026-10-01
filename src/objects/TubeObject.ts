import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimulationObjectRenderResources } from '../rendering/SimulationObjectRendering';
import tubeRenderVert from '../shaders/TubeRender.vert';
import tubeRenderFrag from '../shaders/TubeRender.frag';
import type { Water } from '../Water';
import { CompoundSphereWaterDisplacement } from '../water/WaterDisplacement';
import type { ObjectUpdateContext, SimulationObject } from './SimulationObject';
import { clampAndMoveObject, updatePhysics, type SurgeState } from './SimulationObjectUtils';
import { MeshWaterRayTracing } from '../water/MeshWaterRayTracing';
import { buildTandemTubeBody } from './TandemTubeGeometry';

/** Height above the waterline a tube is released from when a size is selected. */
const DROP_HEIGHT = 0.28;

/** Downward speed (units/sec) a tube must hit the water at to make a splash. */
const SPLASH_MIN_SPEED = 0.25;
/** Impact speed that counts as a "full" splash (strength 1). */
const SPLASH_FULL_SPEED = 0.55;
/** Ripple crown raised around the rim at full strength (wave-sim height units). */
const SPLASH_RIPPLE_STRENGTH = 0.027;
/** Number of splash points around the rim. */
const SPLASH_POINTS = 14;

/** Called when a tube lands on the water hard enough to splash. */
export type SplashHandler = (center: THREE.Vector3, edge: readonly THREE.Vector3[], strength: number) => void;

// Texture atlas layout (uv.y): body occupies [0, BODY_V_MAX), handle and
// floor each get a flat band above it. Body UVs come from the torus itself
// (u = around the ring, v = around the tube's cross-section), so a body can
// carry a printed pattern; everything else samples one flat texel.
const ATLAS_WIDTH = 96;
const ATLAS_HEIGHT = 64;
const BODY_V_MAX = 0.74;
const BODY_FLAT_UV = new THREE.Vector2(0.5, 0.37);
const HANDLE_UV = new THREE.Vector2(0.5, 0.8125);
const FLOOR_UV = new THREE.Vector2(0.5, 0.9375);

/** Floor height (centre), in tube radii relative to the tube's middle (negative = lower). */
const FLOOR_CENTER_Y = -0.35;
/** Floor thickness, in tube radii. */
const FLOOR_THICKNESS = 0.3;

/**
 * Vehicle silhouettes, modelled on WhiteWater's ride photos:
 * - 'ring':   classic single-rider donut with two grab handles.
 * - 'tandem': one-piece double tube: straight, full sides, rounded ends and a
 *             cross-bar making one seat per rider (front and back).
 * - 'raft':   round family raft: fat outer ring, flat floor, handles all round.
 */
export type TubeShape = 'ring' | 'tandem' | 'raft';

/**
 * Printed band around the top of a ring, like the round raft's alternating
 * colour blocks. The rest of the tube (sides, underside) uses `baseColor`.
 */
export interface TubePattern {
  /** Number of colour blocks around the ring. */
  segments: number;
  /** Block colours, cycled around the ring. */
  colors: string[];
  /** Thin divider line between blocks. Omit for none. */
  dividerColor?: string;
}

/** Visual/physical configuration for one ride-vehicle product size. */
export interface TubeConfig {
  /** Display name, also used as the SimulationObject registry key (e.g. 'Single Tube'). */
  name: string;
  shape: TubeShape;
  /** Ring radius (ring/raft); for the tandem, the half width of its centreline (= end-cap radius). */
  ringRadius: number;
  /** Radius of the tube's circular cross-section (tandem: along the straight sides). */
  tubeRadius: number;
  /** Tandem only: half the length of the straight sides. */
  straightHalfLength?: number;
  /** Tandem only: tube radius around the rounded ends. Defaults to tubeRadius. */
  capTubeRadius?: number;
  /** Tandem only: tube radius of the middle cross-bar between the seats. */
  dividerRadius?: number;
  /** Number of grab handles (ring: 2, tandem: 4, raft: any). */
  handleCount?: number;
  /** Inflatable vinyl color (CSS color string). With a pattern, the color of the sides/underside. */
  bodyColor: string;
  /** Optional printed band on top of the ring (raft/ring shapes). */
  pattern?: TubePattern;
  /** Grab-handle color (CSS color string). */
  handleColor: string;
  /** Give the vehicle an inflated floor inside each ring (rafts, tandem tube). */
  floor?: boolean;
  /** Floor color (CSS color string). Defaults to bodyColor. */
  floorColor?: string;
}

/**
 * Builds the texture atlas (see ATLAS_* above). Sampled with nearest filtering
 * both by the tube's own material and by the water surface shader's mesh ray
 * tracing, so reflections show the same colors and pattern as the tube.
 */
function createTubeTexture(config: TubeConfig): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Canvas row 0 is the top, which maps to uv.y = 1 (flipY).
  const fillV = (v0: number, v1: number, color: string, x0 = 0, x1 = ATLAS_WIDTH) => {
    const y0 = Math.floor((1 - v1) * ATLAS_HEIGHT);
    const y1 = Math.ceil((1 - v0) * ATLAS_HEIGHT);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };

  fillV(0, 1, config.bodyColor);
  fillV(0.75, 0.875, config.handleColor);
  fillV(0.875, 1, config.floorColor ?? config.bodyColor);

  const pattern = config.pattern;
  if (pattern) {
    // Body rows: uv.y / BODY_V_MAX = torus cross-section angle / 2PI, where
    // 0 = outer equator, 0.25 = underside, 0.5 = inner equator, 0.75 = top.
    // The printed band covers the top of the tube, leaving a rim of base colour.
    const bandStart = 0.53;
    const bandEnd = 0.95;
    const columnsPerSegment = ATLAS_WIDTH / pattern.segments;
    for (let i = 0; i < pattern.segments; i++) {
      const x0 = Math.round(i * columnsPerSegment);
      const x1 = Math.round((i + 1) * columnsPerSegment);
      fillV(bandStart * BODY_V_MAX, bandEnd * BODY_V_MAX, pattern.colors[i % pattern.colors.length], x0, x1);
      if (pattern.dividerColor) fillV(bandStart * BODY_V_MAX, bandEnd * BODY_V_MAX, pattern.dividerColor, x0, x0 + 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Points every vertex of a part at one flat atlas texel. */
function setFlatUv(geometry: THREE.BufferGeometry, uvPoint: THREE.Vector2) {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uvPoint.x, uvPoint.y);
  uv.needsUpdate = true;
}

/** Squeezes a torus's own UVs into the atlas's body region (keeps the pattern mapping). */
function setBodyUv(geometry: THREE.BufferGeometry, patterned: boolean) {
  if (!patterned) return setFlatUv(geometry, BODY_FLAT_UV);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    // Keep u just inside [0, 1) so the seam doesn't wrap onto the next block.
    uv.setXY(i, Math.min(uv.getX(i), 0.9999), uv.getY(i) * BODY_V_MAX);
  }
  uv.needsUpdate = true;
}

/** Seat centres in the XZ plane: one for ring/raft, two (front/back) for the tandem. */
function ringCenters(config: TubeConfig): THREE.Vector3[] {
  if (config.shape !== 'tandem') return [new THREE.Vector3()];
  const L = config.straightHalfLength ?? 0;
  const capR = config.capTubeRadius ?? config.tubeRadius;
  const barR = config.dividerRadius ?? config.tubeRadius;
  // Midway between the cross-bar and the inside of the end cap.
  const x = (barR + (L + config.ringRadius - capR)) / 2;
  return [new THREE.Vector3(-x, 0, 0), new THREE.Vector3(x, 0, 0)];
}

/**
 * Points along the tube's outer centreline in the XZ plane (used for physics
 * sampling and splash placement): a circle for ring/raft, a racetrack for the
 * tandem (straight sides of length 2*straightHalfLength, rounded ends).
 */
function centerlinePoints(config: TubeConfig, count: number): THREE.Vector3[] {
  const R = config.ringRadius;
  const L = config.shape === 'tandem' ? (config.straightHalfLength ?? 0) : 0;
  const straight = 2 * L;
  const arc = Math.PI * R;
  const total = 2 * straight + 2 * arc;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    let d = (i / count) * total;
    if (d < straight) {
      points.push(new THREE.Vector3(-L + d, 0, R));
      continue;
    }
    d -= straight;
    if (d < arc) {
      const a = Math.PI / 2 - d / R;
      points.push(new THREE.Vector3(L + R * Math.cos(a), 0, R * Math.sin(a)));
      continue;
    }
    d -= arc;
    if (d < straight) {
      points.push(new THREE.Vector3(L - d, 0, -R));
      continue;
    }
    d -= straight;
    const a = -Math.PI / 2 - d / R;
    points.push(new THREE.Vector3(-L + R * Math.cos(a), 0, R * Math.sin(a)));
  }
  return points;
}

/** A molded grab handle lying on top of the tube, running along `tangent`. */
function buildHandle(position: THREE.Vector3, tangentAngle: number, tubeRadius: number, length: number) {
  const handle = new THREE.CapsuleGeometry(tubeRadius * 0.22, length, 4, 10);
  handle.rotateZ(Math.PI / 2); // capsule axis along X
  handle.rotateY(tangentAngle);
  handle.translate(position.x, position.y, position.z);
  setFlatUv(handle, HANDLE_UV);
  return handle;
}

/**
 * Inflated floor filling the inside of the tube, low down like the real
 * rafts. Its edge tucks inside the tube wall.
 */
function buildFloor(config: TubeConfig): THREE.BufferGeometry {
  const { ringRadius: R, tubeRadius: r } = config;
  // Floor sits low in the tube, like the real rafts: centred FLOOR_CENTER_Y
  // tube-radii below the tube's middle. Raise it (towards 0) if it ends up
  // hidden under the water surface.
  const thickness = r * FLOOR_THICKNESS;
  const L = config.shape === 'tandem' ? (config.straightHalfLength ?? 0) : 0;
  // A racetrack slab (a plain disc when L = 0) whose edge tucks into the tube wall.
  const shape = new THREE.Shape();
  shape.moveTo(-L, -R);
  shape.lineTo(L, -R);
  shape.absarc(L, 0, R, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-L, R);
  shape.absarc(-L, 0, R, Math.PI / 2, (3 * Math.PI) / 2, false);
  let floor: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 32,
  });
  floor.rotateX(-Math.PI / 2); // drawn in XY, extruded along +Z: lay it flat
  floor.translate(0, r * FLOOR_CENTER_Y - thickness / 2, 0);
  // ExtrudeGeometry is non-indexed; the other parts are indexed.
  floor = mergeVertices(floor);
  setFlatUv(floor, FLOOR_UV);
  return floor;
}

/**
 * Builds the vehicle geometry for one product size (see TubeShape).
 */
function buildTubeGeometry(config: TubeConfig): THREE.BufferGeometry {
  const { ringRadius: R, tubeRadius: r } = config;
  const parts: THREE.BufferGeometry[] = [];
  const handleY = r * 0.92;
  const centers = ringCenters(config);

  if (config.shape === 'tandem') {
    const body = buildTandemTubeBody({
      halfLength: config.straightHalfLength ?? 0,
      halfWidth: R,
      sideRadius: r,
      capRadius: config.capTubeRadius ?? r,
      dividerRadius: config.dividerRadius ?? r,
    });
    setFlatUv(body, BODY_FLAT_UV);
    parts.push(body);

    // One pair of handles per seat, on top of the straight sides.
    for (const c of centers) {
      for (const side of [-1, 1]) {
        parts.push(buildHandle(new THREE.Vector3(c.x, handleY, side * R), 0, r, R * 0.75));
      }
    }
  } else {
    const ring = new THREE.TorusGeometry(R, r, 24, 64);
    ring.rotateX(Math.PI / 2); // Lay the ring flat on the water
    setBodyUv(ring, Boolean(config.pattern));
    parts.push(ring);

    // Handles spaced evenly around the top of the ring, running tangentially.
    // Rotating the X-aligned capsule by -(theta + PI/2) points it along the
    // circle's tangent (-sin(theta), 0, cos(theta)) at angle theta.
    const count = config.handleCount ?? 2;
    const offset = config.shape === 'ring' ? Math.PI / 2 : 0; // ring: handles on the ±Z sides
    const length = config.shape === 'raft' ? R * 0.42 : R * 0.8;
    for (let i = 0; i < count; i++) {
      const theta = offset + (i / count) * Math.PI * 2;
      const position = new THREE.Vector3(R * Math.cos(theta), handleY, R * Math.sin(theta));
      parts.push(buildHandle(position, -(theta + Math.PI / 2), r, length));
    }
  }

  if (config.floor) parts.push(buildFloor(config));

  // Every part carries position/normal/uv (extras are stripped), so they merge cleanly.
  for (const part of parts) {
    for (const name of Object.keys(part.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) part.deleteAttribute(name);
    }
  }
  return mergeGeometries(parts, false)!;
}

/**
 * Represents a single floating inner tube in the water simulation.
 * Implements SimulationObject, and only ever renders one instance at a time
 * (one tube is dropped into the pool at once for this product demo).
 *
 * Water optics use the generic 'mesh' ray-tracing path (three-mesh-bvh) rather
 * than an analytic shape formula, since the water surface shaders only
 * special-case sphere/box/torus-knot geometry. That gives accurate
 * reflections/refractions for any vehicle shape without touching the water
 * shaders.
 */
export class TubeObject implements SimulationObject {
  readonly name: string;
  /** Half-thickness of the tube; also its resting height above the pool floor. */
  readonly floorClearance: number;
  /** Half extent along the row of rings. */
  readonly halfLengthX: number;
  /** Half extent across the row of rings. */
  readonly halfWidthZ: number;
  /** Vertical half extent used for the buoyancy/submersion curve. */
  private readonly buoyancyRadius: number;
  /** Radius used for the soft contact shadow this tube casts on the pool. */
  private readonly shadowRadius: number;

  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();

  // Only a single tube is ever active for this demo.
  instanceCount = 1;
  readonly maxTubes = 1;

  readonly positions: THREE.Vector3[];
  readonly velocities: THREE.Vector3[];
  private readonly previousPositions: THREE.Vector3[];

  private dragging = false;
  /** Points just outside the rim (relative to center) where splashes start. */
  private readonly splashEdge: THREE.Vector3[];
  /** Set while the tube is shooting up after being held underwater. */
  private readonly surge: SurgeState = { active: false };

  floorY(poolHeight: number) {
    return this.floorClearance - poolHeight;
  }

  readonly displacement: CompoundSphereWaterDisplacement;

  get optics() {
    return {
      kind: 'mesh' as const,
      center: this.position,
      boundingRadius: this.halfLengthX,
      shadowRadius: this.shadowRadius,
      centers: this.positions,
      count: this.instanceCount,
      rayTracing: this.rayTracing,
    };
  }

  readonly mesh: THREE.InstancedMesh;
  enabled = false;

  private readonly material: THREE.ShaderMaterial;
  private readonly raycaster = new THREE.Raycaster();
  private readonly rayTracing: MeshWaterRayTracing;

  constructor(
    private readonly resources: SimulationObjectRenderResources,
    config: TubeConfig,
    private readonly onSplash?: SplashHandler
  ) {
    const { ringRadius, tubeRadius } = config;
    const straight = config.shape === 'tandem' ? (config.straightHalfLength ?? 0) : 0;

    this.name = config.name;
    this.floorClearance = tubeRadius;
    this.halfLengthX = straight + ringRadius + tubeRadius;
    this.halfWidthZ = ringRadius + tubeRadius;
    this.buoyancyRadius = tubeRadius * 1.6;
    this.shadowRadius = ringRadius + tubeRadius;

    this.position = new THREE.Vector3(0, this.floorClearance, 0);
    this.positions = [this.position];
    this.velocities = [this.velocity];
    this.previousPositions = [this.position.clone()];

    const texture = createTubeTexture(config);
    const geometry = buildTubeGeometry(config);

    this.material = new THREE.ShaderMaterial({
      vertexShader: tubeRenderVert,
      fragmentShader: tubeRenderFrag,
      uniforms: {
        light: { value: resources.lightDirection.clone() },
        map: { value: texture },
        shadowRadius: { value: this.shadowRadius },
        poolWidth: { value: 1.0 },
        poolHeight: { value: 1.0 },
        poolLength: { value: 1.0 },
        water: { value: null },
        causticTex: { value: resources.causticTexture },
        texturePassMode: { value: 0 },
      },
      depthTest: true,
      depthWrite: true,
    });

    // Expand bounds to cover the pool so InstancedMesh raycasting/culling succeeds.
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-2, -2, -2),
      new THREE.Vector3(2, 2, 2)
    );
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4.0);

    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.maxTubes);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.count = this.instanceCount;

    // Static local-space triangle BVH used by the water shaders for accurate
    // reflection/refraction ray intersection against the exact tube shape.
    this.rayTracing = new MeshWaterRayTracing(geometry.clone(), texture);

    // Approximate the body's volume with overlapping spheres along its
    // centerline so the whole footprint of the vehicle pushes water aside.
    // Sphere count scales with the centerline length to keep spacing even.
    const perimeter = 4 * straight + 2 * Math.PI * ringRadius;
    const segments = Math.max(12, Math.round(perimeter / (tubeRadius * 1.1)));
    const sphereRadius = Math.min(tubeRadius * 1.6, 0.2);
    const spheres = centerlinePoints(config, segments).map((offset) => ({
      offset,
      radius: sphereRadius,
    }));
    if (config.floor && config.shape === 'tandem') {
      // The floor and cross-bar displace water too: one soft sphere under each
      // seat, plus the bar in the middle.
      for (const c of ringCenters(config)) {
        spheres.push({ offset: new THREE.Vector3(c.x, -tubeRadius * 0.4, 0), radius: ringRadius * 0.6 });
      }
      spheres.push({ offset: new THREE.Vector3(0, 0, 0), radius: sphereRadius });
    } else if (config.floor) {
      // A soft ring of spheres plus the center.
      const inner = ringRadius * 0.5;
      spheres.push({ offset: new THREE.Vector3(0, -tubeRadius * 0.4, 0), radius: inner * 0.8 });
      for (let i = 0; i < 6; i++) {
        const theta = (i / 6) * Math.PI * 2;
        spheres.push({
          offset: new THREE.Vector3(inner * Math.cos(theta), -tubeRadius * 0.4, inner * Math.sin(theta)),
          radius: inner * 0.6,
        });
      }
    }
    // Broad, shallow displacement: the tube pushes a wide soft swell instead of
    // a sharp dent, whose collapse would otherwise rebound over a big tube.
    this.displacement = new CompoundSphereWaterDisplacement(spheres, 0.05);

    // Splash ring: centerline points pushed outward to just beyond the tube wall.
    this.splashEdge = centerlinePoints(config, SPLASH_POINTS).map((p) => {
      const axis = new THREE.Vector3(THREE.MathUtils.clamp(p.x, -straight, straight), 0, 0);
      const out = p.clone().sub(axis).normalize();
      return axis.addScaledVector(out, ringRadius + tubeRadius * 1.3);
    });
  }

  setEnabled(enabled: boolean, water: Water) {
    if (!enabled) {
      if (this.enabled) {
        this.displaceTo(water, this.getInactivePosition());
        this.velocity.set(0, 0, 0);
        this.dragging = false;
        this.enabled = false;
        this.mesh.visible = false;
      }
      return;
    }

    if (this.position.y >= 5.0) {
      this.position.set(0, this.floorClearance, 0);
    }
    this.clampInsidePool();
    this.velocity.set(0, 0, 0);
    this.displaceTo(water, this.position.clone());

    this.mesh.count = 1;
    this.mesh.visible = true;
    this.enabled = true;
  }

  syncPreviousPosition() {
    this.previousPositions[0].copy(this.position);
  }

  update(seconds: number, context: ObjectUpdateContext, water: Water) {
    if (!this.enabled) return;

    // hitTest marks the tube as grabbed; the release only shows up as
    // context.dragging going false, so clear the flag here once let go.
    // Otherwise a tube the user had picked up would never splash again.
    if (!context.dragging) this.dragging = false;

    // "Touching the water" uses the same radius the buoyancy physics does, so
    // the splash fires at the moment the water starts pushing back.
    const wasAboveWater = this.position.y - this.buoyancyRadius > 0;
    const impactSpeed = -this.velocity.y;

    updatePhysics(
      seconds,
      this.position,
      this.velocity,
      { ...context, dragging: this.dragging && context.dragging },
      this.buoyancyRadius,
      this.floorClearance,
      this.surge
    );

    this.displacement.moveBatch(
      water,
      this.previousPositions,
      this.positions,
      1,
      context.poolWidth,
      context.poolLength
    );
    this.syncPreviousPosition();

    // Splash when the tube's underside hits the surface moving fast enough.
    const nowInWater = this.position.y - this.buoyancyRadius <= 0;
    if (wasAboveWater && nowInWater && impactSpeed > SPLASH_MIN_SPEED && !this.dragging) {
      this.splash(water, Math.min(impactSpeed / SPLASH_FULL_SPEED, 1.5), context.poolWidth, context.poolLength);
    }
  }

  /** Raises a ring of ripples around the rim and asks for a droplet spray. */
  private splash(water: Water, strength: number, poolWidth: number, poolLength: number) {
    for (const offset of this.splashEdge) {
      const x = this.position.x + offset.x;
      const z = this.position.z + offset.z;
      if (Math.abs(x) > poolWidth || Math.abs(z) > poolLength) continue;
      water.addDrop(x / poolWidth, z / poolLength, 0.05, SPLASH_RIPPLE_STRENGTH * strength, poolWidth, poolLength);
    }
    this.onSplash?.(this.position, this.splashEdge, strength);
  }

  hitTest(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | null {
    if (!this.enabled) return null;

    this.mesh.updateMatrixWorld(true);
    this.raycaster.set(origin, direction);
    const intersects = this.raycaster.intersectObject(this.mesh);
    if (intersects.length > 0) {
      this.dragging = true;
      return intersects[0].point;
    }
    return null;
  }

  moveBy(delta: THREE.Vector3, poolWidth = 1.0, poolHeight = 1.0, poolLength = 1.0) {
    clampAndMoveObject(
      this.position,
      delta,
      poolWidth,
      poolHeight,
      poolLength,
      this.halfLengthX,
      this.halfWidthZ,
      this.floorClearance
    );
  }

  prepareRender(water: Water, poolWidth = 1.0, poolHeight = 1.0, poolLength = 1.0) {
    this.material.uniforms.water.value = water.textureA.texture;
    this.material.uniforms.light.value.copy(this.resources.lightDirection);
    this.material.uniforms.poolWidth.value = poolWidth;
    this.material.uniforms.poolHeight.value = poolHeight;
    this.material.uniforms.poolLength.value = poolLength;
    this.material.uniformsNeedUpdate = true;

    this.mesh.setMatrixAt(
      0,
      new THREE.Matrix4().makeTranslation(this.position.x, this.position.y, this.position.z)
    );
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Releases the tube from just above the water, so it plops in and settles. */
  dropFromAbove(water: Water) {
    const jitter = () => (Math.random() - 0.5) * 0.14;

    if (!this.enabled) {
      this.mesh.count = 1;
      this.mesh.visible = true;
      this.enabled = true;
    }
    this.displaceTo(water, new THREE.Vector3(jitter(), DROP_HEIGHT, jitter()));
    this.velocity.set(0, 0, 0);
    this.dragging = false;
    this.surge.active = false;
  }

  /**
   * Teleports the tube, handing the water the before/after footprints so the
   * dent it was sitting in is released as it leaves.
   */
  private displaceTo(water: Water, destination: THREE.Vector3) {
    this.displacement.moveBatch(water, [this.position.clone()], [destination], 1);
    this.position.copy(destination);
    this.syncPreviousPosition();
  }

  private clampInsidePool() {
    this.position.x = THREE.MathUtils.clamp(this.position.x, -1 + this.halfLengthX, 1 - this.halfLengthX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -1 + this.halfWidthZ, 1 - this.halfWidthZ);
    this.position.y = Math.max(this.position.y, this.floorY(1.0));
  }

  private getInactivePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, 10.0, this.position.z);
  }
}
