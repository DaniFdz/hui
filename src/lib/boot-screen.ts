/**
 * index.html's boot screen covers the page from the first paint until the app
 * has rendered: over a slow link that is seconds of downloading, and an empty
 * page in the meantime looks like a broken one.
 */
const BOOT_ID = "hui-boot";
/** Read by the inline script in index.html's head; keep the two in step. */
export const BOOT_LOOK_KEY = "hui.boot-look";

type BootColors = { bg: string; text: string; muted: string; accent: string };
/** The colours HUI showed in each mode on this device, and the mode preference. */
export type BootLook = { preference: string; light?: BootColors; dark?: BootColors };

/** Merges what is on screen now into what the boot screen remembers. */
export function nextBootLook(previous: unknown, preference: string, mode: string, colors: BootColors): BootLook {
  const kept = previous && typeof previous === "object" ? previous as Partial<BootLook> : {};
  const look: BootLook = { preference };
  for (const key of ["light", "dark"] as const) {
    const value = key === mode ? colors : kept[key];
    if (value && Object.values(value).every((color) => typeof color === "string" && color.length > 0 && color.length < 200)) look[key] = value;
  }
  return look;
}

/**
 * Remembers the theme on screen, so the next boot screen on this device paints
 * in it rather than in HUI's default palette. A cache: losing it costs nothing.
 */
export function rememberBootLook(root: HTMLElement = document.documentElement): void {
  const mode = root.dataset["themeMode"];
  if (mode !== "light" && mode !== "dark") return;
  // Tokens can be expressions (`light-dark(…)`, `color-mix(…)`) a browser
  // without them could not read back; a probe resolves each to its colour.
  const probe = document.createElement("span");
  probe.hidden = true;
  root.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const colors = { bg: read("--bg"), text: read("--text-strong"), muted: read("--muted"), accent: read("--accent") };
  probe.remove();
  try {
    const previous: unknown = JSON.parse(localStorage.getItem(BOOT_LOOK_KEY) ?? "null");
    localStorage.setItem(BOOT_LOOK_KEY, JSON.stringify(nextBootLook(previous, root.dataset["themePreference"] ?? "system", mode, colors)));
  } catch {
    // Private mode or a full quota: the default palette will do.
  }
}

/** Removes the boot screen once the app's first render has landed. */
export async function finishBoot(app: Element | null): Promise<void> {
  await (app as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
  document.getElementById(BOOT_ID)?.remove();
}

/** The app could not start (its code did not download): say so, and offer a reload. */
export function showBootFailure(error: unknown): void {
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  boot.dataset["state"] = "failed";
  const detail = boot.querySelector(".hui-boot__detail");
  if (detail) detail.textContent = bootFailureMessage(error);
  boot.querySelector(".hui-boot__failure button")?.addEventListener("click", () => location.reload(), { once: true });
}

export function bootFailureMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : "";
  // A chunk that did not arrive surfaces as a browser-specific import error.
  return /dynamically imported module|importing a module script|module script failed|failed to fetch/iu.test(reason)
    ? "HUI could not load over this connection."
    : "HUI could not start.";
}
