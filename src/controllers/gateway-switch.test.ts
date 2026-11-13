/** Switching gateways navigates a browser but rebuilds a phone's real bridge, never opening an external tab. */
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { GatewaysController } from "./gateways-controller.ts";
import { GatewayStore } from "../lib/gateways/gateway-store.ts";
import { nativeShell, type NativeShell } from "../lib/native-shell.ts";

vi.mock("../lib/native-shell.ts", () => ({ nativeShell: vi.fn() }));

beforeEach(() => { vi.mocked(nativeShell).mockReset().mockReturnValue(null); });

function controller(): GatewaysController {
  const host = {
    addController: () => undefined,
    removeController: () => undefined,
    requestUpdate: () => undefined,
    updateComplete: Promise.resolve(true),
  };
  return new GatewaysController(host, new GatewayStore({ current: "https://here.test", storage: null }));
}

test("a browser opens the chosen gateway as a page navigation", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  await controller().switchTo("https://loft.test/");
  assert.deepEqual(assign.mock.calls, [["https://loft.test"]]);
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
