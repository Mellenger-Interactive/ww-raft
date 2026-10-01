# Tube Loader — Design & Engineering Notes

Exploration build: drop a single / double / triple inner tube into a
glass-walled cube of water, to preview the tube product line. Real-time water
simulation with raytraced reflections, refractions and caustics.

Status: working proof of concept, verified in browser on desktop and phone
widths. Not under version control, not deployed anywhere.

---

## Running it

```bash
npm install
npm run dev
```

`node_modules` is deliberately not in this folder — it's 122 MB of regenerable
files and would hammer Drive sync. `npm install` recreates it from
`package-lock.json`.

Controls: click Single / Double / Triple to drop that size (clicking the
already-selected size re-drops it). Drag to orbit, scroll to zoom, click the
water to make ripples. Spacebar pauses; `G` toggles gravity; hold `L` to aim
the sun where the camera is looking.

---

## What it's built on

[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water) — a
Three.js port of Evan Wallace's 2011 WebGL Water demo. MIT licensed; the
attribution is in `LICENSE` and `README.md`. The source was copied in without
its `.git`, so there's no upstream remote to pull from — future upstream fixes
would have to be merged by hand.

Inherited from it: the wave simulation (`Water.ts`), the multi-pass renderer
(caustics, reflection/refraction, pool, water surface), the orbit camera and
pointer interaction, and the sky/tile assets.

Written for this project: the tube geometry and physics, the glass pool, the
control bar and physics panel, and the pacing.

---

## Decisions worth knowing

**Tubes use the generic BVH mesh path for water optics, not an analytic shape.**
This is the most important one. The water surface shaders special-case each
object "kind" — `sphere`, `box` and `torusknot` each have their own hand-written
GLSL intersection function, and the torus-knot one has that specific knot's
`p`/`q`/radius baked into it. Reusing it for a plain ring would have produced
wrong reflections, and adding an analytic ray-vs-torus test means solving a
quartic in GLSL. Instead the tubes declare `kind: 'mesh'`, which routes through
`three-mesh-bvh` and raytraces the actual triangles. That's why any tube shape,
at any size, gets correct reflections without touching a single water shader.

**A tube is N welded rings, not N scaled-up rings.** Like the real product line,
all three sizes share one ring dimension; single/double/triple differ only in
how many rings are joined. Rings are spaced exactly one tube width apart, which
leaves a single wall of material between holes and reads as the figure-eight /
three-hole silhouette from the product photos.

**Ring size is derived, not hand-picked.** `CreateSimulationObjects.ts`
computes it from the pool span and a `POOL_MARGIN` constant so the largest tube
always fills the pool to within 20%. Change the margin (or add a fourth size)
and the geometry re-derives itself.

**Colors come from a 2-pixel palette texture, not vertex colors.** Every vertex
of the body points at one texel and every vertex of the handles at the other,
with nearest filtering. This looks like a strange way to store two flat colors,
and it is — but the water's reflection shader samples the mesh's UVs against a
texture, so this is the only way the tube's own material and its reflection in
the water agree on the colors. Vertex colors would be invisible to the water.

**The glass pool is wall-only alpha.** `Cube.vert` flags side-wall vertices,
`Cube.frag` blends only those toward transparent (`wallOpacity` in
`PoolPass.ts`). The floor stays fully opaque so the caustics still read. Behind
the glass sits a translucent tinted box (`WaterApp.createWaterVolumeFill`) so
the tank shows a believable body of water rather than empty space, and the sky
cubemap is set as the scene background so there's something to see through it.

**The tube can't bounce out of the water, by construction.** Buoyancy here is a
spring, and springs overshoot — the original code paired it with a
velocity-squared drag that barely bites at low speed, so a light tube got flung
back out to splash a second time. Two changes: drag is now exponential decay
(stable at any frame rate, and it actually damps slow motion), and a submerged
object's upward speed is capped, tightening as it nears the surface. The cap is
a hard guarantee independent of the sliders — verified at max gravity, lightest
tube and zero surface tension, the worst case.

---

## Gotchas

- **The Box pool is a fixed 2×2 world units.** `Cube.vert` hardcodes its walls
  at ±1 and nothing scales the mesh, so `poolWidth`/`poolLength` only affect
  shader UV mapping and the physics clamps — not the visible pool. That's why
  the tubes were scaled up to hit the 20% margin instead of the pool being
  shrunk. The Rounded Box path *does* resize properly, if a resizable pool is
  ever needed.
- **Buoyancy measures against a flat waterline at y=0, not the local wave
  height.** A tube therefore doesn't ride passing swells — a big enough wave
  washes over it instead. This is the main reason the displacement amplitude is
  kept low; an early version with a stronger splash had the triple tube
  disappearing under its own rebound a few seconds after landing.
- **Don't delete `Sphere.vert/frag`, `BoxDisplacement.frag` or
  `CompoundSphereDisplacement.frag`.** They look like leftovers from the deleted
  demo objects, but they're `Water.ts`'s GPU displacement kernels. Ditto
  `DuckShading.glsl`, which `WaterAbove/Below.frag` still `#include` for generic
  mesh shading even though the duck model is gone.
- **The rounded-box pool shaders are dead code** — the pool shape is fixed to
  `Box`. Left in place rather than surgically removed, since they're entangled
  with the caustics and water-surface passes.
- Displacement spheres are unioned (`max`, not summed) in the shader, capped at
  120. The triple tube uses 42, batched into one GPU pass per frame.
- On page load the first physics tick can be oversized (asset loading delays the
  first frame), which occasionally makes the starting tube twitch once before
  settling. Cosmetic, self-correcting.

---

## Where the numbers live

| What | Constant | File |
|---|---|---|
| Tube size / pool margin | `POOL_MARGIN`, `RING_RADIUS` | `src/objects/CreateSimulationObjects.ts` |
| Tube colors | `BODY_COLOR`, `HANDLE_COLOR` | `src/objects/CreateSimulationObjects.ts` |
| Drop height & jitter | `DROP_HEIGHT`, `dropFromAbove` | `src/objects/TubeObject.ts` |
| Splash size | `CompoundSphereWaterDisplacement(spheres, 0.05)` | `src/objects/TubeObject.ts` |
| Water damping & no-bounce cap | `MAX_WATER_DRAG`, `RISE_SPEED_*` | `src/objects/SimulationObjectUtils.ts` |
| Wave speed | `WAVE_STEP_INTERVAL` | `src/app/WaterApp.ts` |
| Glass transparency | `wallOpacity` | `src/rendering/PoolPass.ts` |
| Water tint | `createWaterVolumeFill` | `src/app/WaterApp.ts` |
| Slider ranges & defaults | `gravity`, `surfaceTension`, `weight` | `src/app/TubeControls.ts` |
| Camera start position | `angleX`, `angleY`, `distance` | `src/camera/CameraController.ts` |
