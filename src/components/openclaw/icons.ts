// OpenClaw 2026.9.5, MIT: exact SVG definitions used by the session hovercard.
import {html, svg, type SVGTemplateResult, type TemplateResult} from "lit";
export function strokeIcon(body: SVGTemplateResult): TemplateResult {
  return html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${body}
    </svg>
  `;
}
export const icons = {
layoutDashboard: strokeIcon(svg` <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />`),
clock: strokeIcon(svg` <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />`),
server: strokeIcon(svg` <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <line x1="6" x2="6.01" y1="6" y2="6" />
    <line x1="6" x2="6.01" y1="18" y2="18" />`),
folder: strokeIcon(svg` <path
    d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
  />`),
chevronRight: strokeIcon(svg`<path d="M9 18l6-6-6-6" />`),
gitBranch: strokeIcon(svg` <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="6" cy="19" r="2" />
    <path d="M6 7v10M8 9h5a5 5 0 0 0 5-5" />`),
gitPullRequest: strokeIcon(svg` <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12" />`),
gitPullRequestDraft: strokeIcon(svg` <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M6 9v12" />
    <path d="M18 6v.01" />
    <path d="M18 11v.01" />`),
gitPullRequestClosed: strokeIcon(svg` <circle cx="6" cy="6" r="3" />
    <path d="M6 9v12" />
    <path d="m15 9 6 6" />
    <path d="m21 9-6 6" />`),
gitMerge: strokeIcon(svg` <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />`)
};
