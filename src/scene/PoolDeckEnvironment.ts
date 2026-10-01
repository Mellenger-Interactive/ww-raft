import * as THREE from 'three';

/*
 * Environments: createPoolDeckEnvironment and createStudioEnvironment below.
 */

/**
 * Visible surroundings for the tank: a light concrete pool deck it stands on,
 * fading into a pale sky-blue horizon. Purely visual — water reflections and
 * refractions still sample the original sky cubemap, so the lighting on the
 * water and tubes is unchanged.
 *
 * Colours are raw sRGB values, like the project's other ShaderMaterials.
 */
export interface PoolDeckOptions {
  /** Y of the tank's base (the pool floor). The deck sits just below it. */
  groundY: number;
  /** Half-size of the tank footprint on X/Z, used for the contact shadow. */
  tankHalfWidth?: number;
  tankHalfLength?: number;
  deckColor?: string;
  groutColor?: string;
  horizonColor?: string;
  zenithColor?: string;
  /** Paver size in world units (the tank is 2 units wide). */
  paverSize?: number;
}

const color = (c: string) => new THREE.Color().setStyle(c, THREE.NoColorSpace);

export function createPoolDeckEnvironment(options: PoolDeckOptions): THREE.Group {
  const {
    groundY,
    tankHalfWidth = 1,
    tankHalfLength = 1,
    deckColor = '#e8e3d9',
    groutColor = '#cfc8bb',
    horizonColor = '#e4eff5',
    zenithColor = '#9fd3ee',
    paverSize = 0.5,
  } = options;

  const group = new THREE.Group();
  group.name = 'PoolDeckEnvironment';

  // --- Sky dome: vertical gradient, horizon colour at and below eye level ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        horizon: { value: color(horizonColor) },
        zenith: { value: color(zenithColor) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 horizon;
        uniform vec3 zenith;
        varying vec3 vDir;
        void main() {
          float t = smoothstep(0.0, 0.55, vDir.y);
          gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        }`,
    })
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  group.add(sky);

  // --- Deck: square pavers, soft contact shadow, fades into the horizon ---
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        deckColor: { value: color(deckColor) },
        groutColor: { value: color(groutColor) },
        horizon: { value: color(horizonColor) },
        paverSize: { value: paverSize },
        tankHalf: { value: new THREE.Vector2(tankHalfWidth, tankHalfLength) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 deckColor;
        uniform vec3 groutColor;
        uniform vec3 horizon;
        uniform float paverSize;
        uniform vec2 tankHalf;
        varying vec3 vWorld;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec2 p = vWorld.xz;

          // Pavers with thin grout lines; each paver gets a tiny tone shift.
          vec2 cell = p / paverSize;
          vec2 f = abs(fract(cell) - 0.5);
          float edge = max(f.x, f.y);
          float grout = smoothstep(0.47, 0.49, edge);
          vec3 base = deckColor * (0.97 + 0.05 * hash(floor(cell)));
          // Fine speckle so it reads as concrete rather than flat paint.
          base *= 0.985 + 0.03 * hash(floor(p * 90.0));
          vec3 col = mix(base, groutColor, grout);

          // Soft contact shadow hugging the tank footprint.
          vec2 d = abs(p) - tankHalf;
          float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
          float shadow = 1.0 - 0.38 * (1.0 - smoothstep(-0.05, 0.55, dist));
          col *= shadow;

          // Distance fade into the horizon colour (cheap aerial perspective).
          float fade = smoothstep(4.0, 22.0, length(p));
          col = mix(col, horizon, fade);

          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  deck.position.y = groundY - 0.002; // just under the pool floor to avoid z-fighting
  deck.renderOrder = -1;
  deck.frustumCulled = false;
  group.add(deck);

  return group;
}

/**
 * Studio product-shot surroundings: a seamless WhiteWater-navy backdrop and a
 * matte floor that fades into it (like a photo cyclorama), with a soft contact
 * shadow under the tank. Visual only — reflections still use the sky cubemap.
 */
export interface StudioOptions {
  groundY: number;
  tankHalfWidth?: number;
  tankHalfLength?: number;
  /** Floor colour right around the tank. */
  floorColor?: string;
  /** Backdrop colour at the horizon; the floor fades into this. */
  horizonColor?: string;
  /** Backdrop colour overhead. */
  zenithColor?: string;
}

export function createStudioEnvironment(options: StudioOptions): THREE.Group {
  const {
    groundY,
    tankHalfWidth = 1,
    tankHalfLength = 1,
    floorColor = '#a4b9d0',
    horizonColor = '#5c7b9f',
    zenithColor = '#1c355e', // WhiteWater navy (--color-blue-800)
  } = options;

  const group = new THREE.Group();
  group.name = 'StudioEnvironment';

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        horizon: { value: color(horizonColor) },
        zenith: { value: color(zenithColor) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 horizon;
        uniform vec3 zenith;
        varying vec3 vDir;
        void main() {
          float t = smoothstep(-0.05, 0.6, vDir.y);
          gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        }`,
    })
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  group.add(sky);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        floorColor: { value: color(floorColor) },
        horizon: { value: color(horizonColor) },
        tankHalf: { value: new THREE.Vector2(tankHalfWidth, tankHalfLength) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 floorColor;
        uniform vec3 horizon;
        uniform vec2 tankHalf;
        varying vec3 vWorld;

        void main() {
          vec2 p = vWorld.xz;
          vec3 col = floorColor;

          // Soft contact shadow hugging the tank footprint, plus a wider,
          // fainter ambient-occlusion falloff.
          vec2 d = abs(p) - tankHalf;
          float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
          col *= 1.0 - 0.45 * (1.0 - smoothstep(-0.05, 0.35, dist));
          col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.6, dist));

          // Seamless fade into the backdrop, so there's no visible horizon line.
          col = mix(col, horizon, smoothstep(2.5, 9.0, length(p)));

          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  floor.position.y = groundY - 0.002;
  floor.renderOrder = -1;
  floor.frustumCulled = false;
  group.add(floor);

  return group;
}
