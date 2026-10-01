import * as THREE from 'three';
import { CameraController } from '../camera/CameraController';
import { Renderer } from '../Renderer';
import type { SimulationObjectRegistry } from '../objects/SimulationObjectRegistry';
import { createSimulationObjects, TUBE_CONFIGS } from '../objects/CreateSimulationObjects';
import { Water } from '../Water';
import { InteractionController } from './InteractionController';
import { loadSceneAssets } from './LoadSceneAssets';
import { TubeControls } from './TubeControls';
import { SplashEffect } from '../water/SplashEffect';
import { createPoolDeckEnvironment, createStudioEnvironment } from '../scene/PoolDeckEnvironment';

// Fixed pool bounds for this demo (no resize controls).
const POOL_WIDTH = 1.0;
const POOL_HEIGHT = 1.0;
const POOL_LENGTH = 1.0;

// Wave propagation cadence. The original demo advances the wave equation twice
// per frame (~120 steps/sec); stepping far less often gives the slow, calm
// water of a product loadout screen instead of a choppy pool.
const WAVE_STEP_INTERVAL = 1 / 30;
const MAX_WAVE_STEPS_PER_FRAME = 2;

/**
 * Main application coordinator class for the tube-drop proof of concept.
 * Sets up the Three.js canvas, boots the water simulation, wires up the
 * Single/Double/Triple tube controls, and runs the render loop.
 */
export interface WaterAppOptions {
  /** Element to mount the canvas into. Defaults to #app, sized to the window. */
  container?: HTMLElement;
  /** Element whose text is cleared once assets load. Defaults to #loading. */
  loading?: HTMLElement | null;
  /** Global keyboard shortcuts (Space/G/L). Default true; turn off when embedded. */
  hotkeys?: boolean;
  /** Tapping the water makes ripples. Default true; when false a tap/drag there just orbits. */
  waterRipples?: boolean;
  /** Tube to show first. Defaults to the first entry in TUBE_CONFIGS. */
  initialTube?: string;
  /**
   * What surrounds the tank. 'sky' (default) shows the sky cubemap all round;
   * 'studio' stands it on a floor in front of a navy backdrop; 'deck' stands
   * it on a pool deck under a pale sky. Reflections use the cubemap in every
   * case, so the lighting is the same.
   */
  environment?: 'sky' | 'studio' | 'deck';
}

export class WaterApp {
  // Gravity vector, refreshed each tick from the gravity slider.
  private readonly gravity = new THREE.Vector3();
  private readonly cameraController = new CameraController();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

  private webglRenderer!: THREE.WebGLRenderer;
  private renderer!: Renderer;
  private water!: Water;
  private objects!: SimulationObjectRegistry;
  private controls!: TubeControls;
  private interaction!: InteractionController;
  private previousTime = performance.now();
  private waveAccumulator = 0;
  private readonly splash = new SplashEffect();
  private container!: HTMLElement;
  /** True when mounted into a caller-supplied element (sized to it, not the window). */
  private readonly embedded: boolean;

  constructor(private readonly options: WaterAppOptions = {}) {
    this.embedded = Boolean(options.container);
  }

  async init() {
    const container = (this.container = this.options.container ?? document.getElementById('app')!);
    const loading =
      this.options.loading !== undefined ? this.options.loading : document.getElementById('loading');

    this.webglRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webglRenderer.setPixelRatio(window.devicePixelRatio);
    this.webglRenderer.setClearColor(0x000000);
    container.appendChild(this.webglRenderer.domElement);

    const { tileTexture, cubemap } = await loadSceneAssets();

    this.water = new Water(this.webglRenderer);
    this.renderer = new Renderer(this.webglRenderer, tileTexture, cubemap);

    const environment = this.options.environment ?? 'sky';
    if (environment !== 'sky') {
      this.scene.add(
        environment === 'deck'
          ? createPoolDeckEnvironment({ groundY: -POOL_HEIGHT })
          : createStudioEnvironment({ groundY: -POOL_HEIGHT })
      );
      // Keep the camera above the floor (negative pitch = looking down).
      this.cameraController.maxAngleX = -3;
    } else {
      // Sky visible through the glass tank walls above the waterline.
      this.scene.background = cubemap;
    }

    this.scene.add(
      this.renderer.getPoolMesh(),
      this.renderer.getWaterMesh(),
      this.renderer.getWaterMeshBack(),
      this.createWaterVolumeFill()
    );
    this.renderer.markWaterOpticsHidden();

    this.scene.add(this.splash.points);
    this.objects = createSimulationObjects(this.scene, this.renderer.objectRenderResources, (center, edge, strength) =>
      this.splash.spawn(center, edge, strength)
    );
    this.renderer.setWaterOptics(this.objects.optics);
    // The default active tube starts enabled (visible + floating) immediately.
    this.objects.active?.setEnabled(true, this.water);
    this.renderer.setWaterOptics(this.objects.optics);

    this.controls = new TubeControls(
      TUBE_CONFIGS.map((c) => c.name),
      this.options.initialTube ?? TUBE_CONFIGS[0].name,
      {
        onSelectTube: this.selectTube,
        onPausedChange: (paused) => {
          if (paused) this.draw();
        },
      }
    );

    this.interaction = new InteractionController({
      canvas: this.webglRenderer.domElement,
      camera: this.camera,
      cameraController: this.cameraController,
      water: this.water,
      renderer: this.renderer,
      objects: this.objects,
      controls: this.controls,
      draw: this.draw,
      hotkeys: this.options.hotkeys,
      waterRipples: this.options.waterRipples,
    });
    this.interaction.connect();

    this.seedWater();
    if (loading) loading.innerHTML = '';

    if (this.options.initialTube && this.options.initialTube !== TUBE_CONFIGS[0].name) {
      this.selectTube(this.options.initialTube);
    }

    this.resize();
    if (this.embedded && 'ResizeObserver' in window) {
      new ResizeObserver(this.resize).observe(container);
    } else {
      window.addEventListener('resize', this.resize);
    }

    this.previousTime = performance.now();
    requestAnimationFrame(this.animate);
  }

  /**
   * Builds a translucent tinted box filling the interior of the tank below the
   * waterline, so the glass side walls reveal a believable "body of water"
   * rather than empty space. Only its far inner faces are drawn (BackSide),
   * layering behind the actual floor/caustics without occluding them.
   */
  private createWaterVolumeFill(): THREE.Mesh {
    const inset = 0.02;
    const geometry = new THREE.BoxGeometry(2 - inset, POOL_HEIGHT - inset, 2 - inset);
    const material = new THREE.MeshBasicMaterial({
      color: 0x2f9fd6,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, -POOL_HEIGHT / 2, 0);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** A few faint ripples so the surface has some life on load, without chop. */
  private seedWater() {
    for (let i = 0; i < 8; i++) {
      this.water.addDrop(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        0.06,
        i % 2 === 0 ? -0.004 : 0.004,
        POOL_WIDTH,
        POOL_LENGTH
      );
    }
  }

  private animate = (time: number) => {
    if (!this.controls.paused) {
      this.update((time - this.previousTime) / 1000);
      this.draw();
    }
    this.previousTime = time;
    requestAnimationFrame(this.animate);
  };

  private update(seconds: number) {
    if (seconds > 1) return; // Avoid physics explosion on long inactive tabs

    this.interaction.update(seconds);
    this.splash.update(seconds);
    this.gravity.set(0, -this.controls.gravity, 0);

    this.objects.update(
      seconds,
      {
        dragging: this.interaction.draggingObject,
        physicsEnabled: this.controls.physicsEnabled,
        densityEnabled: this.controls.densityEnabled,
        density: this.controls.density,
        surfaceTension: this.controls.surfaceTension,
        gravity: this.gravity,
        poolWidth: POOL_WIDTH,
        poolHeight: POOL_HEIGHT,
        poolLength: POOL_LENGTH,
      },
      this.water
    );

    // Advance the wave equation on a fixed slow cadence rather than every frame.
    this.waveAccumulator += seconds;
    let steps = 0;
    while (this.waveAccumulator >= WAVE_STEP_INTERVAL && steps < MAX_WAVE_STEPS_PER_FRAME) {
      this.water.stepSimulation(POOL_WIDTH, POOL_LENGTH);
      this.waveAccumulator -= WAVE_STEP_INTERVAL;
      steps += 1;
    }
    if (steps === MAX_WAVE_STEPS_PER_FRAME) this.waveAccumulator = 0;

    // Normals are recomputed every frame: the tube writes into the heightmap
    // continuously, even on frames where the simulation itself doesn't step.
    this.water.updateNormals(POOL_WIDTH, POOL_LENGTH);

    this.renderer.setWaterOptics(this.objects.optics);
  }

  private draw = () => {
    this.interaction.preparePausedDraw();
    this.cameraController.apply(this.camera);

    this.objects.prepareRender(this.water, POOL_WIDTH, POOL_HEIGHT, POOL_LENGTH);
    this.renderer.updateObjectTextures(this.scene, this.camera, this.objects.active?.mesh ?? null);
    this.renderer.updateCaustics(this.water);
    this.renderer.renderPool(this.water);
    this.renderer.renderWater(this.water, this.camera);
    this.webglRenderer.render(this.scene, this.camera);
  };

  private resize = () => {
    const width = this.embedded ? this.container.clientWidth : window.innerWidth;
    const height = this.embedded ? this.container.clientHeight : window.innerHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(width, height);
    this.renderer.setSize(width, height);
    this.draw();
  };

  /**
   * Switches to the requested tube size (if not already active) and drops it
   * back in from above, so every button press replays the "tube hits the water" moment.
   */
  selectTube = (name: string) => {
    if (this.objects.active?.name !== name) {
      this.objects.select(name, this.water, 1, POOL_WIDTH, POOL_HEIGHT, POOL_LENGTH);
    }
    this.objects.active?.dropFromAbove?.(this.water);
    this.renderer.setWaterOptics(this.objects.optics);

    this.water.updateNormals(POOL_WIDTH, POOL_LENGTH);
    this.renderer.updateCaustics(this.water);
    if (this.controls.paused) this.draw();
  };
}
