/** Switching gateways navigates a browser but rebuilds a phone's real bridge, never opening an external tab. */
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { GatewaysController } from "./gateways-controller.ts";
import { readGatewayHandoff } from "../lib/gateways/gateway-list.ts";
import { GatewayStore, type GatewayStorage } from "../lib/gateways/gateway-store.ts";
import { nativeShell, type NativeShell } from "../lib/native-shell.ts";

vi.mock("../lib/native-shell.ts", () => ({ nativeShell: vi.fn() }));

beforeEach(() => { vi.mocked(nativeShell).mockReset().mockReturnValue(null); });

function storage(): GatewayStorage {
  const saved: Record<string, string> = {};
  return { getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
}

function controller(entries: readonly { url: string; name: string; lastSeen: number }[] = []): GatewaysController {
  const host = {
    addController: () => undefined,
    removeController: () => undefined,
    requestUpdate: () => undefined,
    updateComplete: Promise.resolve(true),
  };
  const store = new GatewayStore({ current: "https://here.test", storage: storage() });
  for (const entry of entries) store.add(entry.url, entry.name);
  return new GatewaysController(host, store);
}

test("a browser opens the chosen gateway as a page navigation carrying this device's list", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  await controller([{ url: "https://loft.test", name: "Loft", lastSeen: 1 }]).switchTo("https://attic.test/");
  const [target] = assign.mock.calls[0] ?? [];
  assert.ok(typeof target === "string" && target.startsWith("https://attic.test/#hui-gateways="), target);
  // The page it leaves carries its own address, just reached, then every gateway this device saved.
  assert.deepEqual(readGatewayHandoff(new URL(target).hash).map((entry) => [entry.url, entry.name]), [
    ["https://here.test", "here.test"],
    ["https://loft.test", "Loft"],
  ]);
});

test("the phone hands the chosen address to its bridge, and a failed handoff never falls back to browser navigation", async () => {
  const assign = vi.fn();
  const connectGateway = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", { location: { assign } });
  vi.mocked(nativeShell).mockReturnValue({ connectGateway } as unknown as NativeShell);
  await controller().switchTo("https://loft.test/");
  assert.deepEqual(connectGateway.mock.calls, [["https://loft.test"]]);
  assert.equal(assign.mock.calls.length, 0);
  connectGateway.mockRejectedValueOnce(new Error("The bridge refused this gateway."));
  await assert.rejects(controller().switchTo("https://loft.test"), /bridge refused/u);
  assert.equal(assign.mock.calls.length, 0);
});

test("an invalid address is refused before either navigation path", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  await assert.rejects(controller().switchTo("file:///private"), /http:\/\/ or https:\/\//u);
  assert.equal(assign.mock.calls.length, 0);
});

test("a phone outranks HUI's desktop bridge: its shell rebuilds the bridge instead", async () => {
  const connectGateway = vi.fn().mockResolvedValue(undefined);
  const openGateway = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("huiDesktop", { openGateway });
  vi.mocked(nativeShell).mockReturnValue({ connectGateway } as unknown as NativeShell);
  await controller().switchTo("https://loft.test/");
  assert.deepEqual(connectGateway.mock.calls, [["https://loft.test"]]);
  assert.equal(openGateway.mock.calls.length, 0, "the desktop bridge is not asked on a phone");
});
