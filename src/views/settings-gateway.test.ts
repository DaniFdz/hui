import assert from "node:assert/strict";
import test from "node:test";
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
  status: "online", transport: "HTTP + SSE", access: "Full Access", uptimeSeconds: 183840,
  sessions: { registered: 12, running: 2, starting: 0, idle: 10, error: 0, processes: 2 },
};
const render = (overrides: Partial<SettingsProps>) => text(renderConnectionPage({
  healthError: "", ...overrides,
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
