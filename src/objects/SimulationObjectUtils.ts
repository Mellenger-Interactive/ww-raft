import * as THREE from 'three';
import type { ObjectUpdateContext } from './SimulationObject';

/**
 * Linear water drag at full surface tension and full submersion, in 1/sec.
 * Sized so the default surface tension lands past critical damping for the
 * buoyancy spring: a tube that hits the water settles instead of oscillating.
 */
const MAX_WATER_DRAG = 80;

/** Upward speed cap for an object right at the surface, in units/sec. */
const RISE_SPEED_AT_SURFACE = 0.12;
/** Extra upward speed allowed per unit of depth below the surface. */
const RISE_SPEED_PER_DEPTH = 1.2;

/**
 * Terminal rise speed during a "surge" (units/sec): an air-filled tube
 * released fully underwater shoots up at about this speed and pops roughly
 * 0.15-0.2 units clear of its float height. The surge drag is derived from it
 * (buoyant accel / speed), so the pop is about the same at any tube weight.
 * Raise for a bigger jump, lower for a gentler one.
 */
const SURGE_RISE_SPEED = 0.5;

/**
 * Per-object surge state. A surge starts whenever the object is fully
 * submerged and not being dragged, and ends once it has breached and starts
 * falling back — from then on the normal heavy damping settles it calmly.
 */
export interface SurgeState {
  active: boolean;
}

/**
 * Updates the physics state (buoyancy, gravity, drag/friction, and pool floor collision)
 * for a simulation object.
 *
 * How the physics simulation works:
 * 1. Drag / Velocity Reset during interaction:
 *    If the object is being dragged by the cursor, its velocity is forced to 0 so it doesn't
 *    accrue kinetic energy while under manual control.
 *
 * 2. Buoyancy:
 *    We calculate the fraction of the object that is submerged in the water.
 *    The water surface is located at y = 0.
 *    For a sphere of radius R, the vertical boundaries are [y - R, y + R].
 *    - If the top of the object (y + R) is below y = 0, the object is completely submerged (percent = 1).
 *    - If the bottom of the object (y - R) is above y = 0, the object is completely out of water (percent = 0).
 *    - Otherwise, it is partially submerged, calculated as a linear interpolation:
 *      percent = clamp((R - position.y) / (2 * R), 0, 1)
 *
 *    The net acceleration vector is:
 *      acceleration = gravity * (1.0 - buoyancyScale * percentSubmerged)
 *    Where buoyancyScale is derived from the liquid density. If density is high, the buoyancy force is strong,
 *    causing lighter objects to float back to the surface.
 *
 * 3. Drag / Water Friction:
 *    Water resistance decays velocity exponentially, scaled by the surface tension setting and
 *    by the submergence percentage (objects experience no water drag when completely in the air).
 *
 * 4. Rebound Cap:
 *    Buoyancy alone is a spring, and a spring overshoots — it would fling a light object back out
 *    of the water to splash down again. The upward speed of a submerged object is therefore capped,
 *    tightening as it nears the surface, so it rises into place and stops.
 *
 * 4b. Surge (optional, pass a SurgeState):
 *    A fully submerged object instead rises with light drag and no cap, so it
 *    pops up and slightly out of the water like an air-filled tube. Once it
 *    starts falling back the surge ends and steps 3-4 settle it as usual.
 *
 * 5. Euler Integration:
 *    Position is updated using the standard forward Euler step: position += velocity * dt.
 *
 * 6. Pool Bottom Collision:
 *    If the object's bottom boundary drops below the pool floor (floorY = clearance - poolHeight),
 *    we clamp its vertical position to the floor and zero its vertical velocity so it settles there.
 */
export function updatePhysics(
  seconds: number,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  context: ObjectUpdateContext,
  buoyancyRadius: number,
  floorClearance: number,
  surge?: SurgeState
) {
  // Reset velocity when manually dragging the object
  if (context.dragging) {
    velocity.set(0, 0, 0);
    return;
  }

  // If physics is disabled, the object stays static (except for user drags)
  if (!context.physicsEnabled) return;

  // Calculate buoyancy scale factor (relative density ratio of water vs object)
  const buoyancyScale = context.densityEnabled ? 1 / context.density : 1.1;

  // Compute submerged portion: 0 = completely above water surface (y=0), 1 = completely submerged
  const percentUnderWater = THREE.MathUtils.clamp(
    (buoyancyRadius - position.y) / (2 * buoyancyRadius),
    0,
    1
  );

  if (surge) {
    if (percentUnderWater >= 1) surge.active = true;
    else if (surge.active && velocity.y <= 0) surge.active = false;
  }
  const surging = surge?.active ?? false;

  // Accumulate velocity: net force = gravity (downward) - buoyancy (upward, scaled by submergence)
  velocity.addScaledVector(context.gravity, seconds - buoyancyScale * seconds * percentUnderWater);

  /**
   * Apply fluid drag. Exponential decay is stable at any frame rate and, unlike
   * a velocity-squared term, still bites at low speeds — which is what actually
   * kills the buoyancy spring's oscillation.
   */
  const buoyantAccel = context.gravity.length() * Math.max(buoyancyScale - 1, 0);
  const surgeDrag = Math.max(buoyantAccel / SURGE_RISE_SPEED, 1);
  const drag = surging
    ? surgeDrag * percentUnderWater
    : MAX_WATER_DRAG * context.surfaceTension * percentUnderWater;
  if (drag > 0) {
    velocity.multiplyScalar(Math.exp(-drag * seconds));
  }

  /**
   * The surface never launches a floating object back out of the water. The
   * closer it is to the surface the harder its rebound is capped, so it eases
   * up to its float height and stops rather than popping out and splashing
   * down a second time.
   */
  if (!surging && percentUnderWater > 0 && velocity.y > 0) {
    const depth = Math.max(0, -position.y);
    velocity.y = Math.min(velocity.y, RISE_SPEED_AT_SURFACE + depth * RISE_SPEED_PER_DEPTH);
  }

  // Integrate position: translate the object by its current velocity
  position.addScaledVector(velocity, seconds);

  // Floor collision resolution: come to rest on the bottom, no bounce
  const floor = floorClearance - context.poolHeight;
  if (position.y < floor) {
    position.y = floor;
    velocity.y = 0;
  }
}

/**
 * Moves the object by delta and clamps its position inside the pool boundaries.
 *
 * Boundary rules:
 * 1. X bounds (Width): position.x is clamped between [-limitX, limitX], where limitX = poolWidth - xLimitRadius.
 * 2. Z bounds (Length): position.z is clamped between [-limitZ, limitZ], where limitZ = poolLength - zLimitRadius.
 * 3. Y bounds (Height/Depth): position.y is clamped to be at least floorClearance - poolHeight to stay above the floor,
 *    and up to an arbitrary ceiling height of 10 to keep it from flying away during drag interactions.
 */
export function clampAndMoveObject(
  position: THREE.Vector3,
  delta: THREE.Vector3,
  poolWidth: number,
  poolHeight: number,
  poolLength: number,
  xLimitRadius: number,
  zLimitRadius: number,
  floorClearance: number
) {
  const limitX = poolWidth - xLimitRadius;
  const limitZ = poolLength - zLimitRadius;

  // Apply translation offset
  position.add(delta);

  // Constrain coordinates within pool dimensions
  position.x = THREE.MathUtils.clamp(position.x, -limitX, limitX);
  position.y = THREE.MathUtils.clamp(position.y, floorClearance - poolHeight, 10);
  position.z = THREE.MathUtils.clamp(position.z, -limitZ, limitZ);
}
