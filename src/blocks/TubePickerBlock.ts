/**
 * TubePickerBlock — a self-contained page component.
 *
 * Side-by-side layout: a rounded media panel on one side running the live
 * tube/water loader, and a 1 / 2 / 3-rider picker on the other. Choosing an
 * option drops that tube into the water.
 *
 * Usage:
 *   import { mountTubePicker } from './blocks/TubePickerBlock';
 *   mountTubePicker(document.querySelector('#tube-picker')!, { mediaSide: 'left' });
 *
 * Copy below is placeholder text based on WhiteWater's public product pages
 * (Rattler, Giant AquaTube, Family Raft Ride, Master Blaster) — confirm with
 * the client before shipping.
 */
import { WaterApp } from '../app/WaterApp';
import './tube-picker-block.css';

export interface TubeOption {
  /** Must match a name in TUBE_CONFIGS (src/objects/CreateSimulationObjects.ts). */
  simName: string;
  title: string;
  riders: number;
  description: string;
  /** WhiteWater slide families this vehicle runs on. */
  rides: string[];
}

export interface TubePickerOptions {
  eyebrow?: string;
  heading?: string;
  intro?: string;
  options?: TubeOption[];
  /** Index of the option selected on load. */
  initialIndex?: number;
  /** Which side the media panel sits on at desktop widths. */
  mediaSide?: 'left' | 'right';
  cta?: { label: string; href: string };
  /** Fires whenever the rider count changes. */
  onChange?(option: TubeOption): void;
}

export const DEFAULT_TUBE_OPTIONS: TubeOption[] = [
  {
    simName: 'Single Tube',
    title: 'Single Tube',
    riders: 1,
    description: 'The classic solo inner tube. One rider, two handles, and the fastest line down the flume.',
    rides: ['Giant AquaTube', 'Master Blaster'],
  },
  {
    simName: 'Double Tube',
    title: 'Double Tube',
    riders: 2,
    description: 'A tandem tube for friends or a parent and child, riding front-to-back.',
    rides: ['Rattler', 'Giant AquaTube'],
  },
  {
    simName: 'Triple Tube',
    title: '3-Person Raft',
    riders: 3,
    description: 'A compact group raft so small families and friend groups can ride together.',
    rides: ['Rattler', 'Family Raft Ride'],
  },
];

let instanceCount = 0;

/** Small outline icon matching each vehicle's silhouette in the sim. */
function vehicleIcon(riders: number) {
  let body: string;
  if (riders === 1) {
    body = '<circle cx="20" cy="14" r="10" /><circle cx="20" cy="14" r="4" />';
  } else if (riders === 2) {
    // One-piece tandem: straight sides, rounded ends, a seat hole front and back.
    body =
      '<rect x="3" y="3" width="34" height="22" rx="11" />' +
      '<rect x="9" y="9" width="9.5" height="10" rx="4.5" /><rect x="21.5" y="9" width="9.5" height="10" rx="4.5" />';
  } else {
    const dots = [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return `<circle class="tp-icon-dot" cx="${(20 + 10 * Math.cos(a)).toFixed(1)}" cy="${(14 + 10 * Math.sin(a)).toFixed(1)}" r="1.2" />`;
      })
      .join('');
    body = `<circle cx="20" cy="14" r="12" /><circle cx="20" cy="14" r="7" />${dots}`;
  }
  return `<svg class="tp-icon" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true">${body}</svg>`;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function mountTubePicker(root: HTMLElement, opts: TubePickerOptions = {}) {
  const id = `tp-${++instanceCount}`;
  const options = opts.options ?? DEFAULT_TUBE_OPTIONS;
  let selected = Math.min(Math.max(opts.initialIndex ?? 0, 0), options.length - 1);

  root.classList.add('tube-picker');
  if (opts.mediaSide === 'right') root.classList.add('tube-picker--media-right');

  root.innerHTML = `
    <div class="tp-media">
      <div class="tp-media-inner">
        <div class="tp-canvas" aria-label="Interactive 3D preview of the selected tube floating in water" role="img"></div>
        <div class="tp-loading" aria-hidden="true"><span></span>Loading preview…</div>
        <p class="tp-hint">Drag to orbit</p>
      </div>
    </div>
    <div class="tp-content">
      ${opts.eyebrow ? `<p class="tp-eyebrow">${escape(opts.eyebrow)}</p>` : ''}
      <h2 class="tp-heading" id="${id}-heading">${escape(opts.heading ?? 'How many riders?')}</h2>
      ${opts.intro ? `<p class="tp-intro">${escape(opts.intro)}</p>` : ''}
      <fieldset class="tp-options" aria-labelledby="${id}-heading">
        ${options
          .map(
            (o, i) => `
          <label class="tp-option">
            <input type="radio" name="${id}-riders" value="${i}" ${i === selected ? 'checked' : ''} />
            <span class="tp-option-count" aria-hidden="true">${o.riders}</span>
            <span class="tp-option-body">
              <span class="tp-option-title">${escape(o.title)}
                <span class="tp-option-riders">${o.riders} ${o.riders === 1 ? 'rider' : 'riders'}</span>
              </span>
              <span class="tp-option-desc">${escape(o.description)}</span>
              ${
                o.rides.length
                  ? `<span class="tp-option-rides">Rides on: ${o.rides.map((r) => `<em>${escape(r)}</em>`).join('')}</span>`
                  : ''
              }
            </span>
            ${vehicleIcon(o.riders)}
          </label>`
          )
          .join('')}
      </fieldset>
      ${opts.cta ? `<a class="tp-cta" href="${escape(opts.cta.href)}">${escape(opts.cta.label)}</a>` : ''}
    </div>`;

  const media = root.querySelector<HTMLElement>('.tp-media')!;
  const canvasHost = root.querySelector<HTMLElement>('.tp-canvas')!;

  // Let the page scroll normally over the preview: stop wheel events in the
  // capture phase so the canvas's zoom handler never sees them.
  canvasHost.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });

  const app = new WaterApp({
    container: canvasHost,
    loading: null,
    hotkeys: false,
    waterRipples: false,
    environment: 'studio',
    initialTube: options[selected].simName,
  });

  const initialSim = options[selected].simName;
  let ready = false;
  app
    .init()
    .then(() => {
      ready = true;
      // Apply any choice made while the preview was still loading.
      if (options[selected].simName !== initialSim) app.selectTube(options[selected].simName);
      media.classList.add('is-ready');
    })
    .catch((err) => {
      console.error('[TubePicker] preview failed to start', err);
      media.classList.add('is-error');
    });

  root.querySelectorAll<HTMLInputElement>('.tp-options input').forEach((input) => {
    input.addEventListener('change', () => {
      selected = Number(input.value);
      const option = options[selected];
      if (ready) app.selectTube(option.simName);
      opts.onChange?.(option);
    });
  });

  return {
    app,
    get selected() {
      return options[selected];
    },
  };
}
