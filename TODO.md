# Tube Loader — What I'd Improve Next

Ordered by what I think buys the most, soonest. Rough effort: **S** = an hour or
two, **M** = half a day, **L** = a day or more.

---

## 1. Make it presentable to a customer

**Ground the scene. (M)** The tank currently floats in an open sky, which reads
as a magic cube hovering over the ocean. It needs something underneath it — a
pool deck, a plinth, or a clean studio gradient backdrop. This is the single
biggest gap between "tech demo" and "product page," and it's mostly scene
dressing rather than engine work.

**Label the sizes with real numbers. (S)** Right now the buttons say Single /
Double / Triple. A waterslide buyer wants "42in · 1 rider · 18 lb". Put actual
diameters, rider capacity and weight next to each size, and scale the geometry
to true relative dimensions so the comparison is honest. Needs the real spec
sheet as input.

**Fix the camera feel. (S–M)** Orbit sensitivity is far too high — a short drag
swings the view from three-quarter to straight-down, and the pitch isn't
clamped, so it's easy to end up underneath the pool looking up. Add sensitivity
scaling and pitch limits, a "reset view" affordance, and a slow idle auto-orbit
so the thing is alive when nobody's touching it. Consider a default framing per
size so the triple isn't cropped.

**Make it shareable. (S)** Today it only runs via `npm run dev`. Setting
`base: './'` in `vite.config.ts` makes `npm run build` produce a `dist/` that
works from any static host or subfolder, so colleagues can open it from a link
instead of a terminal. Pair with encoding the current size and slider values
into the URL, so a specific configuration can be sent to someone.

---

## 2. Make the tubes look more like the product

**Blend the welds between rings. (M)** The double and triple are overlapping
tori, so where rings meet there's a visible intersection crease rather than a
smooth weld. It reads acceptably at the current camera distance and is close to
the seam in the product photos, but it won't survive a close-up. Options: a
metaball/SDF surface for a true blend, or a modeled collar over the junction.

**Detail pass. (M)** Valve stem, a slight flattening where the tube meets the
water, subtle vinyl texture and wear, and a properly molded handle recess
instead of a capsule sunk into the surface.

**Cover the other product shapes. (M–L)** The reference set also includes the
floored raft (mesh bottom, taller side walls, a rider well). That's a different
geometry generator, and its mesh floor would want its own displacement
footprint.

**Color and branding options. (S)** Per-size colorways and a decal slot on the
top surface. Cheap to add — the palette texture is already the seam between
geometry and color, so this is mostly UI.

---

## 3. Physics realism

**Sample the wave height under the tube. (M) — biggest realism win.** Buoyancy
currently measures against a flat waterline at y=0, so the tube ignores the
waves it's floating on; a large enough swell washes over it instead of lifting
it. Reading the simulation heightmap at the tube's position (a small GPU
readback, or a CPU mirror of the coarse heights) would let it bob on its own
ripples and on the wake of a drop. It would also let the no-bounce rise cap be
relaxed from a hard clamp to something more physical, and it would remove the
current ceiling on splash size.

**Let the tube rotate. (M)** It never tilts or spins. A little torque on entry —
tipping toward the side that hits first, then settling — plus slow drift
rotation on the surface would add a lot of life for modest effort. Needs a
rotation term in the instance matrix and the displacement offsets.

**Multiple tubes at once. (M)** The engine already supports up to 5 instances
per object. Dropping several would allow a lazy-river scene, or a side-by-side
size comparison in one shot, which is a better sales image than one tube at a
time. Watch the displacement sphere budget — the cap is 120 and a triple already
uses 42.

**A resizable pool / flume. (L)** Blocked on the Box pool's walls being
hardcoded at ±1 in the vertex shader. Either teach that shader about pool
dimensions or move to the rounded-box path, which already resizes. Worth it if
customers want to see a tube in *their* flume width rather than a generic tank.

---

## 4. Housekeeping

**Put it in version control. (S)** It isn't a git repo. Everything so far is
loose files, and the tuning work in particular would benefit from a history —
several of the current constants are the third or fourth value tried.

**A smoke test or two. (S)** Nothing automated exists. Worth having: the app
boots without console errors, and each tube's computed extents stay within the
pool. That second one would have caught the geometry overshooting the walls
during the resize work.

**Bundle size. (S)** 770 kB, no code splitting, and the BVH for all three sizes
is built eagerly at startup. Fine on desktop, less so on a phone on a trade show
floor. Build the BVH for a size the first time it's selected.

**Accessibility. (S)** The size buttons need `aria-pressed` and visible focus
styles, and the whole thing should respect `prefers-reduced-motion` — it's a
screen full of continuous animation.

---

## Known rough edges (not yet worth fixing)

- On load the first physics tick can be oversized, so the starting tube
  sometimes twitches once before settling. Self-corrects within a second.
- Near/far glass walls are one mesh in a single draw call, so alpha blending
  between them isn't depth-sorted. Invisible at the default angle; could show if
  the camera goes edge-on to a corner.
- The rounded-box pool shader set is dead code, kept because it's entangled with
  the caustics and water-surface passes.
