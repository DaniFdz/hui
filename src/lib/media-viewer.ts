/**
 * Pure geometry and naming rules for the image/diagram viewer. The viewer
 * applies `translate(x, y) scale(scale)` with a top-left transform origin, so
 * every point here is in stage (viewport) pixels.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 16;
/** Multiplicative step for buttons and keyboard zoom. */
export const ZOOM_STEP = 1.25;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Largest scale that shows the whole content inside the viewport minus a
 * margin. Raster images never upscale past their natural size by default;
 * vector diagrams may (`maxScale`).
 */
export function fitScale(content: Size, viewport: Size, options: { padding?: number; maxScale?: number } = {}): number {
  const padding = options.padding ?? 24;
  const maxScale = options.maxScale ?? 1;
  if (content.width <= 0 || content.height <= 0) return 1;
  const width = Math.max(1, viewport.width - padding * 2);
  const height = Math.max(1, viewport.height - padding * 2);
  return clampScale(Math.min(maxScale, width / content.width, height / content.height));
}

/** Transform that centres content at `scale` inside the viewport. */
export function centeredTransform(content: Size, viewport: Size, scale: number): ViewTransform {
  const next = clampScale(scale);
  return {
    scale: next,
    x: (viewport.width - content.width * next) / 2,
    y: (viewport.height - content.height * next) / 2,
  };
}

/** Rescales while keeping the content point under `anchor` fixed on screen. */
export function zoomAround(transform: ViewTransform, scale: number, anchor: Point): ViewTransform {
  const next = clampScale(scale);
  const ratio = next / transform.scale;
  return {
    scale: next,
    x: anchor.x - (anchor.x - transform.x) * ratio,
    y: anchor.y - (anchor.y - transform.y) * ratio,
  };
}

/** Converts one wheel event into a multiplicative zoom factor. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const bounded = Math.max(-120, Math.min(120, pixels));
  return Math.exp(-bounded * 0.0025);
}

/**
 * Keeps at least `margin` pixels of content visible so a fast drag or zoom
 * cannot lose the image entirely off-screen.
 */
export function constrainTransform(transform: ViewTransform, content: Size, viewport: Size, margin = 48): ViewTransform {
  const width = content.width * transform.scale;
  const height = content.height * transform.scale;
  const keepX = Math.min(margin, width);
  const keepY = Math.min(margin, height);
  return {
    scale: transform.scale,
    x: Math.min(viewport.width - keepX, Math.max(keepX - width, transform.x)),
    y: Math.min(viewport.height - keepY, Math.max(keepY - height, transform.y)),
  };
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export function extensionForMime(mimeType: string): string | undefined {
  return MIME_EXTENSIONS[mimeType.split(";")[0]?.trim().toLowerCase() ?? ""];
}

/** Mime type declared by a `data:` URL, if any. */
export function dataUrlMime(src: string): string | undefined {
  return /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/iu.exec(src)?.[1]?.toLowerCase();
}

/**
 * A safe download filename: strips path separators and control characters,
 * falls back to `fallback`, and guarantees the extension of `mimeType`.
 */
export function downloadFilename(name: string, mimeType: string | undefined, fallback = "image"): string {
  const base = (name.split(/[\\/]/u).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+/u, "")
    .slice(0, 120)
    .trim();
  const stem = base || fallback;
  const extension = mimeType ? extensionForMime(mimeType) : undefined;
  if (!extension) return stem;
  const current = /\.([a-z0-9]{1,5})$/iu.exec(stem)?.[1]?.toLowerCase();
  if (current === extension || (extension === "jpg" && current === "jpeg")) return stem;
  return `${stem}.${extension}`;
}

/**
 * Intrinsic size of a rendered SVG: the viewBox wins because diagram renderers
 * set `width="100%"`; numeric width/height attributes are the fallback.
 */
export function svgIntrinsicSize(viewBox: string | null, width: string | null, height: string | null): Size | undefined {
  const box = viewBox?.trim().split(/[\s,]+/u).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0) {
    return { width: box[2]!, height: box[3]! };
  }
  const numeric = (value: string | null) => (value && /^\s*[\d.]+(?:px)?\s*$/u.test(value) ? Number.parseFloat(value) : Number.NaN);
  const w = numeric(width);
  const h = numeric(height);
  return w > 0 && h > 0 ? { width: w, height: h } : undefined;
}
