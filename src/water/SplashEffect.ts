import * as THREE from 'three';

/** Max droplets alive at once; spawns past this recycle the oldest. */
const MAX_DROPLETS = 200;
/** Droplet gravity (units/sec²). Stronger than the tube sim's for a snappy, small arc. */
const DROPLET_GRAVITY = 3.2;
/** World-space droplet size. */
const DROPLET_SIZE = 0.04;

/** Soft round sprite so droplets read as beads of water rather than squares. */
function createDropletTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(235,248,255,0.9)');
  g.addColorStop(1, 'rgba(235,248,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A light spray of droplets thrown up when a tube lands on the water.
 * Droplets arc outward and vanish as they fall back below the surface.
 * Purely visual: the ripples themselves are injected into the wave
 * simulation by the tube (see TubeObject's splash handling).
 */
export class SplashEffect {
  readonly points: THREE.Points;

  private readonly positions = new Float32Array(MAX_DROPLETS * 3);
  private readonly colors = new Float32Array(MAX_DROPLETS * 4);
  private readonly velocities = new Float32Array(MAX_DROPLETS * 3);
  private readonly life = new Float32Array(MAX_DROPLETS);
  private readonly maxLife = new Float32Array(MAX_DROPLETS);
  private next = 0;
  private alive = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

    const material = new THREE.PointsMaterial({
      size: DROPLET_SIZE,
      map: createDropletTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /**
   * Throws droplets up from points around the tube's outer edge.
   * @param center Tube center (world space).
   * @param edge Points just outside the tube's rim, relative to center.
   * @param strength 0..~1.5, from impact speed.
   */
  spawn(center: THREE.Vector3, edge: readonly THREE.Vector3[], strength: number) {
    const perPoint = Math.max(1, Math.round(3 * strength));
    for (const offset of edge) {
      const out = new THREE.Vector3(offset.x, 0, offset.z).normalize();
      for (let k = 0; k < perPoint; k++) {
        const i = this.next;
        this.next = (this.next + 1) % MAX_DROPLETS;
        if (this.life[i] <= 0) this.alive++;

        const jitter = 0.04;
        this.positions[i * 3] = center.x + offset.x + (Math.random() - 0.5) * jitter;
        this.positions[i * 3 + 1] = 0.01;
        this.positions[i * 3 + 2] = center.z + offset.z + (Math.random() - 0.5) * jitter;

        const outSpeed = (0.25 + Math.random() * 0.45) * strength;
        const upSpeed = (0.55 + Math.random() * 0.6) * strength;
        // A little sideways scatter so the spray isn't a perfect crown.
        const side = (Math.random() - 0.5) * 0.3 * strength;
        this.velocities[i * 3] = out.x * outSpeed - out.z * side;
        this.velocities[i * 3 + 1] = upSpeed;
        this.velocities[i * 3 + 2] = out.z * outSpeed + out.x * side;

        this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 0.4;
      }
    }
  }

  update(seconds: number) {
    if (this.alive === 0) return;
    const dt = Math.min(seconds, 1 / 20);

    for (let i = 0; i < MAX_DROPLETS; i++) {
      if (this.life[i] <= 0) continue;

      this.life[i] -= dt;
      this.velocities[i * 3 + 1] -= DROPLET_GRAVITY * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Gone once it falls back into the water or runs out of time.
      if (this.life[i] <= 0 || (this.positions[i * 3 + 1] < 0 && this.velocities[i * 3 + 1] < 0)) {
        this.life[i] = 0;
        this.alive--;
        this.colors[i * 4 + 3] = 0;
        continue;
      }

      const t = this.life[i] / this.maxLife[i];
      this.colors[i * 4] = 1;
      this.colors[i * 4 + 1] = 1;
      this.colors[i * 4 + 2] = 1;
      this.colors[i * 4 + 3] = 0.85 * Math.min(1, t * 2.5);
    }

    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }
}
