export interface TubeControlCallbacks {
  /** Fired when the user picks a tube size button (even if it's already selected — always re-drops it). */
  onSelectTube(name: string): void;
  onPausedChange(paused: boolean): void;
}

// Weight slider (0..1) maps onto the buoyancy calculation's density ratio.
// Lighter tubes ride higher on the surface; heavier ones settle deeper.
const MIN_DENSITY = 0.1;
const MAX_DENSITY = 0.7;

/**
 * Minimal, customer-facing control bar for the tube-drop demo: a button per
 * product size (Single/Double/Triple), a play/pause toggle, and a small panel
 * of physics sliders for tuning the feel of the drop. Replaces the original
 * project's lil-gui developer panel (pool shape/dimensions/instance count
 * aren't relevant to this product preview).
 *
 * Also exposes the small set of fields/methods InteractionController expects
 * from a "controls" object (pool bounds are fixed for this demo).
 */
export class TubeControls {
  paused = false;
  physicsEnabled = true;
  densityEnabled = true;
  lightFollowsCamera = false;

  /** Gravity strength in units/sec². Gentle by default for a slow, calm drop. */
  gravity = 1.6;
  /** How strongly the water grabs a submerged tube, 0..1. Default is past critical damping. */
  surfaceTension = 0.55;
  /** Tube weight, 0..1 (light to heavy). */
  weight = 0.25;

  /** Density ratio relative to water, derived from the weight slider. */
  get density() {
    return MIN_DENSITY + this.weight * (MAX_DENSITY - MIN_DENSITY);
  }

  // Pool is a fixed 1x1x1 box for this demo (no resize controls).
  readonly poolShape = 'Box';
  readonly poolWidth = 1.0;
  readonly poolHeight = 1.0;
  readonly poolLength = 1.0;
  instanceCount = 1;

  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly pauseButton: HTMLButtonElement | null = null;

  constructor(
    tubeNames: string[],
    defaultName: string,
    private readonly callbacks: TubeControlCallbacks
  ) {
    const bar = document.getElementById('tube-controls');
    // Headless mode: when the host page has no control bar (e.g. the embedded
    // TubePickerBlock drives selection itself), skip building any UI.
    if (!bar) return;

    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'control-group';
    tubeNames.forEach((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tube-btn';
      button.textContent = name.replace(' Tube', '');
      button.addEventListener('click', () => {
        this.setActive(name);
        this.callbacks.onSelectTube(name);
      });
      sizeGroup.appendChild(button);
      this.buttons.set(name, button);
    });
    bar.appendChild(sizeGroup);

    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.className = 'pause-btn';
    this.pauseButton.textContent = 'Pause';
    this.pauseButton.addEventListener('click', () => this.togglePaused());
    bar.appendChild(this.pauseButton);

    this.setActive(defaultName);
    this.buildPhysicsPanel();
  }

  private buildPhysicsPanel() {
    const panel = document.getElementById('physics-controls');
    if (!panel) return;

    this.addSlider(panel, 'Gravity', 0.2, 6, 0.1, this.gravity, (value) => {
      this.gravity = value;
      return value.toFixed(1);
    });

    this.addSlider(panel, 'Surface tension', 0, 1, 0.01, this.surfaceTension, (value) => {
      this.surfaceTension = value;
      return `${Math.round(value * 100)}%`;
    });

    this.addSlider(panel, 'Tube weight', 0, 1, 0.01, this.weight, (value) => {
      this.weight = value;
      return `${Math.round(value * 100)}%`;
    });
  }

  /**
   * Appends a labelled range slider. `apply` stores the new value and returns
   * the text to show in the readout.
   */
  private addSlider(
    panel: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    apply: (value: number) => string
  ) {
    const wrapper = document.createElement('label');
    wrapper.className = 'slider';

    const caption = document.createElement('span');
    caption.className = 'slider-caption';
    caption.textContent = label;

    const readout = document.createElement('em');
    readout.textContent = apply(initial);
    caption.appendChild(readout);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.addEventListener('input', () => {
      readout.textContent = apply(Number(input.value));
    });

    wrapper.append(caption, input);
    panel.appendChild(wrapper);
  }

  private setActive(name: string) {
    this.buttons.forEach((button, key) => {
      button.classList.toggle('active', key === name);
    });
  }

  togglePaused() {
    this.paused = !this.paused;
    if (this.pauseButton) {
      this.pauseButton.textContent = this.paused ? 'Play' : 'Pause';
      this.pauseButton.classList.toggle('active', this.paused);
    }
    this.callbacks.onPausedChange(this.paused);
  }

  togglePhysics() {
    this.physicsEnabled = !this.physicsEnabled;
  }
}
