// Selected verbatim icon bodies from OpenClaw v2026.9.5 (ec9c1a13).
// ui/src/components/icons.ts and icons-tools.ts, MIT License.
// HUI aliases: chevron → chevronRight, grid → layoutGrid,
// filter → listFilter, close → x. Geometry stays upstream-owned.
import { html, svg, type SVGTemplateResult, type TemplateResult } from "lit";

function strokeIcon(body: SVGTemplateResult): TemplateResult {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const icons = {
  messageSquare: strokeIcon(svg`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />`),
  columns2: strokeIcon(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" />`),
  panelRightOpen: strokeIcon(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18M10 10l-3 2 3 2" />`),
  panelBottomOpen: strokeIcon(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15h18M10 8l2 3 2-3" />`),
  eye: strokeIcon(svg`<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />`),
  globe: strokeIcon(svg` <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />`),
  arrowLeft: strokeIcon(svg` <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />`),
  arrowDown: strokeIcon(svg`<path d="M12 5v14m7-7-7 7-7-7" />`),
  externalLink: strokeIcon(
    svg`<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />`,
  ),
  download: strokeIcon(svg` <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />`),
  check: strokeIcon(svg`<path d="M20 6 9 17l-5-5" />`),
  circleX: strokeIcon(svg`<circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />`),
  pin: strokeIcon(svg` <line x1="12" x2="12" y1="17" y2="22" />
    <path
      d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
    />`),
  rotateCcw: strokeIcon(
    svg`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />`,
  ),
  chevron: strokeIcon(svg`<path d="M9 18l6-6-6-6" />`),
  home: strokeIcon(svg` <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />`),
  grid: strokeIcon(svg` <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />`),
  calendarClock: strokeIcon(svg` <path
      d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"
    />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h5" />
    <path d="M17.5 17.5 16 16.3V14" />
    <circle cx="16" cy="16" r="6" />`),
  plug: strokeIcon(
    svg`<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />`,
  ),
  palette: strokeIcon(svg` <path
      d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
    />
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />`),
  pipette: strokeIcon(svg` <path
      d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"
    />
    <path
      d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"
    />
    <path d="m2 22 .414-.414" />`),
  radio: strokeIcon(svg` <circle cx="12" cy="12" r="2" />
    <path
      d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"
    />`),
  fileText: strokeIcon(svg` <path
      d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
    />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" x2="8" y1="13" y2="13" />
    <line x1="16" x2="8" y1="17" y2="17" />
    <line x1="10" x2="8" y1="9" y2="9" />`),
  box: strokeIcon(svg` <path
      d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
    />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />`),
  zap: strokeIcon(svg`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />`),
  wrench: strokeIcon(svg` <path
    d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
  />`),
  book: strokeIcon(
    svg` <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />`,
  ),
  terminal: strokeIcon(svg` <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />`),
  shieldCheck: strokeIcon(
    svg`<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3zM9 12l2 2 4-4" />`,
  ),
  bug: strokeIcon(svg` <path d="m8 2 1.88 1.88" />
    <path d="M14.12 3.88 16 2" />
    <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
    <path d="M12 20v-9" />
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
    <path d="M6 13H2" />
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
    <path d="M22 13h-4" />
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />`),
  menu: strokeIcon(svg` <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />`),
  moreHorizontal: strokeIcon(svg` <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />`),
  hand: strokeIcon(svg` <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M6 14v-2a2 2 0 0 0-4 0v4c0 4.4 3.6 8 8 8h2c4.4 0 8-3.6 8-8v-5a2 2 0 0 0-4 0v2" />`),
  alertTriangle: strokeIcon(svg` <path
      d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
    />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />`),
  search: strokeIcon(svg` <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />`),
  refresh: strokeIcon(
    svg`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" />`,
  ),
  filter: strokeIcon(svg` <path d="M3 6h18" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />`),
  panelLeftClose: strokeIcon(svg` <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M16 10l-3 2 3 2" />`),
  panelLeftOpen: strokeIcon(svg` <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M14 10l3 2-3 2" />`),
  plus: strokeIcon(svg`<path d="M5 12h14M12 5v14" />`),
  camera: strokeIcon(svg` <path
      d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z"
    />
    <circle cx="12" cy="13" r="3" />`),
  image: strokeIcon(svg` <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`),
  paperclip: strokeIcon(svg` <path
    d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
  />`),
  settings: strokeIcon(svg` <path
      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
    />
    <circle cx="12" cy="12" r="3" />`),
  edit: strokeIcon(
    svg`<path
      d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
    />`,
  ),
  folder: strokeIcon(svg` <path
    d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
  />`),
  gitBranch: strokeIcon(svg` <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="6" cy="19" r="2" />
    <path d="M6 7v10M8 9h5a5 5 0 0 0 5-5" />`),
  trash: strokeIcon(
    svg`<path
      d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"
    />`,
  ),
  close: strokeIcon(svg` <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />`),
  arrowUp: strokeIcon(svg`<path d="M12 19V5m-7 7 7-7 7 7" />`),
  chevronUp: strokeIcon(svg`<path d="m18 15-6-6-6 6" />`),
  chevronDown: strokeIcon(svg`<path d="M6 9l6 6 6-6" />`),
  circle: strokeIcon(svg`<circle cx="12" cy="12" r="10" />`),
  copy: strokeIcon(svg` <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`),
  stop: strokeIcon(svg`<rect width="14" height="14" x="5" y="5" rx="1" />`),
  squareTerminal: strokeIcon(svg` <path d="m7 11 2-2-2-2M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />`),
};
