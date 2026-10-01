# Waterslide Tube Preview

A proof-of-concept product viewer for a waterslide company: drop a Single,
Double, or Triple inner tube into a glass-walled cube of water and watch it
splash and float, with real-time raytraced reflections/refractions and
caustics.

Water simulation and rendering are built on [jeantimex/threejs-water](https://github.com/jeantimex/threejs-water),
a Three.js port of Evan Wallace's classic [WebGL Water](http://madebyevan.com/webgl-water/) demo.

## Running it

```bash
npm install
npm run dev
```

Then open the printed local URL. Drag to orbit the camera, click the water to
add ripples, and use the Single/Double/Triple buttons to drop a different
tube size in. The physics panel tunes the feel of the drop:

- **Gravity** — how fast a released tube falls.
- **Surface tension** — how strongly the water grabs a submerged tube. The
  default sits past critical damping for the buoyancy spring, so a tube stops
  dead on contact; lower it and the tube plunges deeper and eases back up.
- **Tube weight** — how deep a tube rides. Heavier tubes settle lower and push
  more water aside.

No setting makes a tube bounce back out of the water: a submerged tube's
upward speed is capped, tightening as it nears the surface, so it always rises
into place and stops instead of springing out for a second splash.

## What's custom here

- `src/objects/TubeObject.ts` — a procedural inner tube built from `ringCount`
  welded rings plus molded grab handles, so a single is one ring, a double a
  figure eight, and a triple a three-hole raft. Buoyant, splashes on entry,
  and parametrized so one class serves all three product variants
  (`src/objects/CreateSimulationObjects.ts`). Reflections/refractions use the
  engine's generic BVH mesh ray-tracing path (`kind: 'mesh'`), so any tube
  shape gets accurate optics without touching the water shaders.
- Pacing is tuned for a product loadout feel: the wave equation advances on a
  slow fixed cadence (`WAVE_STEP_INTERVAL` in `WaterApp.ts`) instead of twice
  per frame, gravity is gentle, and tubes are released from just above the
  surface.
- `src/shaders/Cube.vert`/`Cube.frag` — the pool walls are alpha-blended
  (`wallOpacity`) so the tank reads as a transparent glass cube; the floor
  stays opaque so caustics still show clearly at the bottom.
- `src/app/WaterApp.ts` — a translucent tinted "water volume" fill gives the
  tank a believable body of water when viewed through the glass sides, and
  the sky cubemap is set as the scene background.
- `src/app/TubeControls.ts` — a minimal product-facing control bar (replaces
  the original project's lil-gui developer panel).

## License

MIT — see [LICENSE](LICENSE). Original WebGL Water work Copyright (c) 2011
Evan Wallace; Three.js port Copyright (c) 2026 Yong Su (jeantimex).
