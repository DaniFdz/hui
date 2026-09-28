/** A single local font family, not a CSS declaration or a font stack. */
export const DEFAULT_TERMINAL_FONT = "JetBrains Mono";
export const TERMINAL_FONTS = [DEFAULT_TERMINAL_FONT, "MesloLGS NF", "MesloLGS Nerd Font Mono", "JetBrainsMono Nerd Font Mono", "FiraCode Nerd Font Mono", "Hack Nerd Font Mono", "CaskaydiaCove Nerd Font Mono", "Menlo", "Consolas"] as const;

export function normalizeTerminalFont(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_TERMINAL_FONT;
  const name = value.trim();
  return name.length > 0 && name.length <= 128 && !/[\p{Cc}"'\\;,{}<>]/u.test(name)
    ? name : DEFAULT_TERMINAL_FONT;
}

/** Bundled icon face (public/fonts/symbols-nerd-font-mono.css), limited to Nerd Font code points. */
export const NERD_FONT_SYMBOLS = "HUI Nerd Font Symbols";

export function terminalFontStack(value: unknown): string {
  return `"${normalizeTerminalFont(value)}", "${NERD_FONT_SYMBOLS}", "JetBrains Mono", ui-monospace, monospace`;
}

/**
 * Load the faces a terminal canvas draws with before it renders. Canvas text
 * does not trigger or await web-font loads, and a unicode-range face is only
 * fetched for matching text, so a Nerd Font sample is included.
 */
export async function loadTerminalFont(value: unknown, fonts: Pick<FontFaceSet, "load"> = document.fonts): Promise<void> {
  await fonts.load(`13px ${terminalFontStack(value)}`, "M\u{E0B0}\u{F0001}").catch(() => []);
}
