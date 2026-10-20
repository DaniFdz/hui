/** Server-owned widget sandbox path, reserved messages and content security policy. */

export const WIDGET_SANDBOX_PATH = "/__hui/widget-sandbox";
export const WIDGET_SANDBOX_METHOD_PREFIX = "ui/notifications/sandbox-";

/** Public CDNs a widget may load scripts from. Pinned here and never a
 * `connect-src`: a widget can load these libraries but cannot fetch data. */
export const WIDGET_SCRIPT_ORIGINS = [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://esm.sh",
  "https://unpkg.com",
] as const;
export const WIDGET_STYLE_ORIGINS = [...WIDGET_SCRIPT_ORIGINS, "https://fonts.googleapis.com", "https://fonts.bunny.net"] as const;
export const WIDGET_FONT_ORIGINS = [...WIDGET_SCRIPT_ORIGINS, "https://fonts.gstatic.com", "https://fonts.bunny.net"] as const;

/**
 * The policy every widget document runs under. The sandbox page sends it as a
 * header (`frame: true`), which also names HUI as the only embedder and
 * forces an opaque origin; the widget document repeats it in a meta tag.
 * Images and media come only from `data:` and `blob:`; no connection is allowed.
 */
export function widgetContentSecurityPolicy(options: { frame?: boolean } = {}): string {
  const directives = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${WIDGET_SCRIPT_ORIGINS.join(" ")}`,
    `style-src 'unsafe-inline' ${WIDGET_STYLE_ORIGINS.join(" ")}`,
    `font-src data: ${WIDGET_FONT_ORIGINS.join(" ")}`,
    "img-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (options.frame) directives.push("frame-ancestors 'self'", "sandbox allow-scripts allow-forms");
  return directives.join("; ");
}

