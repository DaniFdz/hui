/**
 * Operator-facing labels for the managed browser's status in Settings. Pure presentation over the gateway's
 * `BrowserStatus`; it never queries or controls the browser.
 */
import type { BrowserStatus } from "../../shared/browser.ts";

export type BrowserStatusKind = "ok" | "warn" | "danger" | "accent" | "muted";

/** One pill for the Browser section header; states are mutually exclusive and
 * checked in order of what the operator must act on first. */
export function browserStatusLabel(status: BrowserStatus | undefined): { kind: BrowserStatusKind; label: string } {
  if (!status) return { kind: "muted", label: "Checking…" };
  if (!status.enabled) return { kind: "muted", label: "Off" };
  if (status.state === "starting") return { kind: "accent", label: "Starting…" };
  if (status.state === "stopping") return { kind: "accent", label: "Stopping…" };
  if (status.state === "running") return { kind: "ok", label: status.mode === "windowed" ? "Running · visible window" : "Running · headless" };
  if (!status.executable) return { kind: "danger", label: "Browser not found" };
  if (status.lastError) return { kind: "warn", label: "Stopped after an error" };
  return { kind: "muted", label: "Stopped" };
}

/** "Brave · Chrome/153.0.8010.53" without repeating a name the version already carries. */
export function browserVersionLabel(status: BrowserStatus): string {
  const name = status.executable?.name ?? "Browser";
  if (!status.version) return name;
  return status.version.toLowerCase().startsWith(name.toLowerCase()) ? status.version : `${name} · ${status.version}`;
}
