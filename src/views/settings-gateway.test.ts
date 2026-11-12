import assert from "node:assert/strict";
import { test } from "vitest";
import type { PowerStatus } from "../api/schema/power.ts";
import { lidAwakeNoticeShown } from "./power-notice.ts";
import { renderConnectionPage, type SettingsProps } from "./settings.ts";

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const health: SettingsProps["health"] = {
  status: "online", transport: "HTTP + SSE", access: "Full Access", uptimeSeconds: 183840, name: "build-box",
  sessions: { registered: 12, running: 2, starting: 0, idle: 10, waiting: 0, error: 0, reconnecting: 0, disconnected: 0, processes: 2 },
};
const settings = { power: { keepAwake: true }, name: "" } as SettingsProps["settings"];
const named = (name: string) => ({ ...settings, name });
const gateways: NonNullable<SettingsProps["gateways"]> = [
  { url: "http://127.0.0.1:8787", name: "build-box", state: "current" },
  { url: "http://loft.local:8787", name: "Loft", state: "known", lastSeen: Date.now() - 3 * 60_000 },
  { url: "http://attic.local:8787", name: "Attic", state: "offline", lastSeen: Date.now() - 86_400_000 },
];
const idleAdd: NonNullable<SettingsProps["gatewayAdd"]> = { address: "", busy: false, error: "" };
const render = (overrides: Partial<SettingsProps>) => text(renderConnectionPage({
  healthError: "", settings, gateways, gatewayAdd: idleAdd, ...overrides,
} as SettingsProps));

test("gateway health renders independently of PI configuration", () => {
  const result = render({ health });
  assert.match(result, /gateway-status--ok/);
  assert.match(result, /Connected/);
  assert.match(result, /2d 3h 4m/);
  assert.match(result, /2 active/);
});

test("failed health never presents cached data as connected or live", () => {
  const result = render({ health, healthError: "Network unavailable" });
  assert.match(result, /gateway-status--danger/);
  assert.match(result, /Disconnected/);
  assert.match(result, /Last known values/);
  assert.match(result, /Retry connection/);
  assert.doesNotMatch(result, /gateway-status--ok|>Connected|Live process state/);
});

test("initial loading, initial failure and idle are distinct", () => {
  assert.match(render({}), /Connecting…/);
  const failed = render({ healthError: "Network unavailable" });
  assert.match(failed, /Disconnected/);
  assert.doesNotMatch(failed, /Uptime/);
  assert.match(render({ health: { ...health, sessions: { ...health.sessions, running: 0 } } }), /Idle/);
});

const power: PowerStatus = {
  keepAwake: { state: "active", detail: "" },
  lidAwake: { state: "error", detail: "Administrator approval was cancelled." },
  lidOn: false,
};

test("the Gateway page names the gateway, and shows the hostname it falls back to while it has none", () => {
  const unnamed = render({ health });
  assert.match(unnamed, /Gateway name/);
  assert.match(unnamed, /Leave it empty to use this machine's hostname, build-box\./);

  const saved = render({ health, settings: named("Studio Mac"), gateways: [{ url: "http://127.0.0.1:8787", name: "Studio Mac", state: "current" }] });
  assert.match(saved, /Shown to every client that connects, and on About\./);
  assert.match(saved, /Studio Mac/);
  assert.doesNotMatch(saved, /build-box/);

  // Health has not answered yet: the section is still there, without a fallback to show.
  const loading = render({ gateways: [] });
  assert.match(loading, /Gateway name/);
  assert.doesNotMatch(loading, /build-box/);
});

test("the Gateways list marks the current gateway and shows when the others were last seen", () => {
  const result = render({ health });
  // The gateway serving this page leads, and is never offered a Switch or a Remove.
  assert.match(result, /data-state=current[\s\S]{0,900}?>\s*Current\s*</u);
  assert.match(result, /data-state=known[\s\S]{0,900}?>\s*last seen 3 min ago\s*</u);
  assert.match(result, /data-state=offline[\s\S]{0,900}?>\s*Offline\s*</u);
  assert.match(result, /aria-label=Switch to Loft/u);
  assert.match(result, /aria-label=Retry Attic/u);
  assert.match(result, /aria-label=Remove Attic/u);
  assert.doesNotMatch(result, /aria-label=Remove build-box|aria-label=Switch to build-box/u);
  // The add field sits under the list, with the refusal HUI words itself.
  assert.match(result, /Gateway address/);
  assert.match(result, /HUI asks it to identify itself before adding it\./u);
  const refused = render({ gatewayAdd: { address: "http://nope.local:8787", busy: false, error: "This address doesn't answer as a HUI gateway." } });
  assert.match(refused, /role="alert"[^>]*>This address doesn't answer as a HUI gateway\./u);
  assert.match(refused, /This address doesn't answer as a HUI gateway\./u);
  assert.match(refused, /value=http:\/\/nope\.local:8787/u, "a refusal leaves the address in the field");
});

test("macOS power shows each choice beside what the gateway holds", () => {
  const result = render({ health, power, settings });
  assert.match(result, /Keep Mac awake/);
  assert.match(result, /settings-status--ok[^>]*>.*Active/s);
  assert.match(result, /settings-status--danger[^>]*>.*Failed/s);
  assert.match(result, /Administrator approval was cancelled\./);
  assert.match(result, /Requires administrator permission/);
  // Not on macOS, or not known yet: no Power section.
  assert.doesNotMatch(render({ health, power: null, settings }), /Keep Mac awake/);
  assert.doesNotMatch(render({ health, power: undefined, settings }), /Keep Mac awake/);
});

test("the top notice shows only while the Mac is actually held awake with the lid closed", () => {
  const lid = (state: PowerStatus["lidAwake"]["state"], lidOn: boolean) => ({ ...power, lidAwake: { state, detail: "" }, lidOn });
  assert.equal(lidAwakeNoticeShown(lid("active", true)), true);
  assert.equal(lidAwakeNoticeShown(lid("pending", true)), false);
  assert.equal(lidAwakeNoticeShown(lid("active", false)), false);
  assert.equal(lidAwakeNoticeShown(null), false);
});
