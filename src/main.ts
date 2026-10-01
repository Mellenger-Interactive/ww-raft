/**
 * Waterslide Tube Preview - Proof of Concept
 *
 * A real-time water simulation showing single/double/triple inner tubes dropping
 * into a glass-walled pool of water, for previewing a waterslide company's tube
 * product lineup.
 *
 * Water physics/rendering (wave simulation, raytraced reflections/refractions,
 * caustics) are built on jeantimex's Three.js port of Evan Wallace's WebGL Water
 * demo: https://github.com/jeantimex/threejs-water
 *
 * See src/objects/TubeObject.ts for the inner-tube shape/physics, and
 * src/app/WaterApp.ts for how the pool/tube controls are wired up.
 */

import './styles.css';
import { WaterApp } from './app/WaterApp';

void new WaterApp().init();
