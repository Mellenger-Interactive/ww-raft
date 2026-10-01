/** Demo entry for index.html (the home page) — mounts the TubePickerBlock page component. */
import { mountTubePicker } from './blocks/TubePickerBlock';

mountTubePicker(document.getElementById('tube-picker')!, {
  eyebrow: 'Ride vehicles',
  heading: 'Pick your ride: 1, 2 or 3 riders',
  intro:
    'From solo inner tubes to small group rafts, every vehicle is matched to the slides it runs on. Choose a size to drop it in the water.',
  mediaSide: 'left',
  cta: { label: 'See compatible slides', href: 'https://www.whitewaterwest.com/products/water-slides/' },
  onChange: (option) => console.log('[TubePicker] selected', option.title),
});
