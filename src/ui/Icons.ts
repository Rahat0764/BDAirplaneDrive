export type IconName =
  | 'camera'
  | 'gear'
  | 'sun'
  | 'moon'
  | 'cloud'
  | 'cloud-sun'
  | 'rain'
  | 'wind'
  | 'mist'
  | 'eye'
  | 'reset'
  | 'fullscreen'
  | 'exit-fullscreen'
  | 'menu'
  | 'gamepad'
  | 'plane'
  | 'road'
  | 'runway'
  | 'download'
  | 'clock'
  | 'vibrate'
  | 'zoom'
  | 'volume'
  | 'sliders'
  | 'check';

const SVG_PATHS: Record<IconName, string> = {
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  gear:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  sun:
    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"/>',
  moon:
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  cloud:
    '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'cloud-sun':
    '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M17.66 6.34l1.41-1.41"/><path d="M16 12a4 4 0 0 0-7.5-1.9"/><path d="M17 19H7a5 5 0 0 1-.4-9.98A6 6 0 0 1 18.2 10.5 4.2 4.2 0 0 1 17 19Z"/>',
  rain:
    '<path d="M16 14H7a5 5 0 1 1 .9-9.92A6 6 0 0 1 19 8a4 4 0 0 1-3 6Z"/><path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4"/>',
  wind:
    '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
  mist:
    '<path d="M4 10h16M2 14h20M5 18h14M7 6h10"/>',
  eye:
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  reset:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  fullscreen:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  'exit-fullscreen':
    '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>',
  menu:
    '<path d="M4 7h16M4 12h16M4 17h16"/>',
  gamepad:
    '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="17.5" cy="13" r="1"/>',
  plane:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  road:
    '<path d="M4 20 8 4M20 20 16 4M12 6v3M12 12v3M12 18v2"/>',
  runway:
    '<path d="M5 20h14M8 4v16M16 4v16M12 6v2M12 11v2M12 16v2"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  clock:
    '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  vibrate:
    '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M3 8v8M21 8v8"/>',
  zoom:
    '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  volume:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>',
  check:
    '<polyline points="20 6 9 17 4 12"/>',
};

export function iconSvg(name: IconName, size = 14): string {
  return `<svg class="ui-svg-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG_PATHS[name]}</svg>`;
}
