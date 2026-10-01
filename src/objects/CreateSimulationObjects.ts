import type * as THREE from 'three';
import type { SimulationObjectRenderResources } from '../rendering/SimulationObjectRendering';
import { SimulationObjectRegistry } from './SimulationObjectRegistry';
import { TubeObject, type SplashHandler, type TubeConfig } from './TubeObject';

/*
 * Product lineup: 1, 2 and 3-rider vehicles, modelled on WhiteWater's ride
 * photos (Rattler, Giant AquaTube, Family Raft Ride):
 *   Single Tube  - classic donut, yellow, two handles.
 *   Double Tube  - one-piece tandem tube, straight sides, cross-bar between two seats; green, blue handles.
 *   Triple Tube  - round family raft with a floor, royal blue, handles all round.
 *
 * Sizes are in pool units (the pool interior spans -1..1 on X and Z). The raft
 * is the largest, at ~0.67 half-width, so it still sits as a snug product shot.
 */
export const TUBE_CONFIGS: TubeConfig[] = [
  {
    name: 'Single Tube',
    shape: 'ring',
    ringRadius: 0.26,
    tubeRadius: 0.12,
    handleCount: 2,
    bodyColor: '#f7c51e',
    handleColor: '#26313f',
  },
  {
    name: 'Double Tube',
    shape: 'tandem',
    ringRadius: 0.24, // half width of the centreline
    tubeRadius: 0.12, // fuller straight sides
    capTubeRadius: 0.105, // rounded ends
    dividerRadius: 0.085, // cross-bar between the two seats
    straightHalfLength: 0.24,
    handleCount: 4,
    floor: true,
    bodyColor: '#6cc644', // lime green
    handleColor: '#1f5fd6', // blue
    floorColor: '#58ad36',
  },
  {
    name: 'Triple Tube',
    shape: 'raft',
    ringRadius: 0.5,
    tubeRadius: 0.14,
    handleCount: 6,
    floor: true,
    bodyColor: '#1f5fbf',
    handleColor: '#e3e7ec',
    floorColor: '#a7b2c1',
  },
];

/**
 * Factory function that instantiates the three tube product-size variants
 * (Single, Double, Triple), registers them inside a new SimulationObjectRegistry,
 * and returns the registry instance. The Single Tube is active by default.
 */
export function createSimulationObjects(
  scene: THREE.Scene,
  resources: SimulationObjectRenderResources,
  onSplash?: SplashHandler
) {
  const registry = new SimulationObjectRegistry(scene);
  TUBE_CONFIGS.forEach((config, index) => {
    registry.register(new TubeObject(resources, config, onSplash), index === 0);
  });
  return registry;
}
