/**
 * The terminal's colors from HUI's active theme: background and text from the pane, the accent for the cursor and
 * selection, and an ANSI palette readable on that background (Gespenst's default dark palette on dark themes, a
 * light one on light themes). The terminal pane resolves the CSS colors and reapplies this whenever the theme,
 * mode or accent changes, so open terminals recolor live.
 */
export type Rgb = { r: number; g: number; b: number };
export type TerminalThemeColors = { background: Rgb; foreground: Rgb; accent: Rgb };

/** ANSI colors for light backgrounds: every normal color stays legible on white (GitHub Light's terminal palette). */
const LIGHT_ANSI = {
  black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
  brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
} as const;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mix(top: Rgb, bottom: Rgb, amount: number): Rgb {
  const blend = (a: number, b: number) => Math.round(a * amount + b * (1 - amount));
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b) };
}

/** A complete Gespenst theme (setTheme replaces the previous one, so a dark theme drops the light palette). */
export function terminalTheme({ background, foreground, accent }: TerminalThemeColors) {
  const light = luminance(background) > 0.4;
  return {
    appearance: light ? "light" as const : "dark" as const,
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: mix(accent, background, light ? 0.28 : 0.4),
    selectionInactiveBackground: mix(accent, background, 0.18),
    ...(light ? LIGHT_ANSI : {}),
  };
}

/** Reads `rgb(…)`/`rgba(…)` (as getImageData or computed styles report sRGB) into channels; undefined otherwise. */
export function parseRgb(value: string): Rgb | undefined {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/u.exec(value.trim());
  if (!match) return undefined;
  const [r, g, b] = match.slice(1, 4).map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return { r: r!, g: g!, b: b! };
}
