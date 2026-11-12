/** The gateways controller: the Add/Edit dialog's rules, the probe they depend on, and the current gateway's own name. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { GatewayProbe } from "../api/gateways.ts";
import { GATEWAY_ALREADY_SAVED, GATEWAY_IS_CURRENT, GATEWAY_LIST_KEY, GATEWAY_NAME_UNSAVED, GATEWAY_NOT_AN_ADDRESS, GATEWAY_REFUSED, writeGatewayList, type GatewayEntry } from "../lib/gateways/gateway-list.ts";
import { GatewayStore, type GatewayStorage } from "../lib/gateways/gateway-store.ts";
import { GatewaysController } from "./gateways-controller.ts";

const CURRENT = "http://127.0.0.1:8787";

function memoryStorage(initial: Record<string, string> = {}): GatewayStorage & { saved: Record<string, string> } {
  const saved = { ...initial };
  return { saved, getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
}

function setup(options: { probe?: (url: string) => Promise<GatewayProbe>; saveCurrentName?: (name: string) => Promise<boolean>; entries?: readonly GatewayEntry[] } = {}) {
  const host = { updates: 0, requestUpdate() { this.updates += 1; }, addController() {}, removeController() {}, updateComplete: Promise.resolve(true) };
  const probes: string[] = [];
  const closes: number[] = [];
  const storage = memoryStorage(options.entries ? { [GATEWAY_LIST_KEY]: writeGatewayList(options.entries) } : {});
  const store = new GatewayStore({ storage, current: CURRENT, now: () => 1_000 });
  const controller = new GatewaysController(host, store, {
    saveCurrentName: options.saveCurrentName ?? (async () => true),
    probe: (url) => {
      probes.push(url);
      return options.probe?.(url) ?? Promise.resolve({ ok: true, name: "Answered" });
    },
    closeRenderedDialog: () => { closes.push(1); },
  });
  return { controller, store, probes, closes, host };
}

test("adding a gateway stores the name chosen in the dialog and closes it", async () => {
  const { controller, store, probes, closes } = setup();
  controller.openAddGateway();
  assert.deepEqual(controller.dialog, { mode: "add", originalUrl: "", name: "", address: "", addressFixed: false, busy: false, error: "" });
  controller.setDialogName("Loft");
  controller.setDialogAddress("loft.local:8787");
  await controller.submitGatewayDialog();
  assert.deepEqual(probes, ["http://loft.local:8787"]);
  assert.deepEqual(store.list(), [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 1_000 }]);
  assert.equal(controller.dialog, null);
  assert.equal(closes.length, 1, "the rendered dialog is closed before its state goes");
});

test("an unnamed gateway is stored under the name it answers with, and a refusal keeps the values", async () => {
  const { controller, store } = setup({ probe: async () => ({ ok: true, name: "Loft Studio" }) });
  controller.openAddGateway();
  controller.setDialogName("   ");
  controller.setDialogAddress("http://loft.local:8787/");
  await controller.submitGatewayDialog();
  assert.equal(store.list()[0]?.name, "Loft Studio");
  assert.equal(store.list()[0]?.url, "http://loft.local:8787");

  const refused = setup({ probe: async () => ({ ok: false }) });
  refused.controller.openAddGateway();
  refused.controller.setDialogName("Loft");
  refused.controller.setDialogAddress("http://nope.local:8787");
  await refused.controller.submitGatewayDialog();
  assert.equal(refused.controller.dialog?.error, GATEWAY_REFUSED);
  assert.equal(refused.controller.dialog?.name, "Loft");
  assert.equal(refused.controller.dialog?.address, "http://nope.local:8787");
  assert.equal(refused.controller.dialog?.busy, false);
  assert.deepEqual(refused.store.list(), []);
});

test("the dialog refuses a non-address, this page's gateway and one already in the list without probing", async () => {
  const { controller, probes } = setup({ entries: [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 900 }] });
  controller.openAddGateway();
  controller.setDialogAddress("not an address");
  await controller.submitGatewayDialog();
  assert.equal(controller.dialog?.error, GATEWAY_NOT_AN_ADDRESS);

  controller.setDialogAddress(CURRENT);
  await controller.submitGatewayDialog();
  assert.equal(controller.dialog?.error, GATEWAY_IS_CURRENT);

  controller.setDialogAddress("http://loft.local:8787");
  await controller.submitGatewayDialog();
  assert.equal(controller.dialog?.error, GATEWAY_ALREADY_SAVED);
  assert.deepEqual(probes, [], "none of the three needs a handshake");
});

test("editing a saved gateway renames it without a probe, or moves it to an address that answers", async () => {
  const { controller, store, probes } = setup({ entries: [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 900 }] });
  const [, loft] = controller.views();
  controller.openEditGateway(loft!);
  assert.equal(controller.dialog?.addressFixed, false);
  assert.equal(controller.dialog?.name, "Loft");
  controller.setDialogName("Loft Studio");
  await controller.submitGatewayDialog();
  assert.deepEqual(probes, [], "a gateway renamed in place need not be up");
  assert.deepEqual(store.list(), [{ url: "http://loft.local:8787", name: "Loft Studio", lastSeen: 900 }]);

  controller.openEditGateway(controller.views()[1]!);
  controller.setDialogAddress("attic.local:8787");
  controller.setDialogName("Attic");
  await controller.submitGatewayDialog();
  assert.deepEqual(probes, ["http://attic.local:8787"]);
  assert.deepEqual(store.list(), [{ url: "http://attic.local:8787", name: "Attic", lastSeen: 1_000 }]);
});

test("reaching a saved gateway again keeps the name this device chose for it", async () => {
  const { controller, store } = setup({
    entries: [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 100 }],
    probe: async () => ({ ok: true, name: "Renamed upstream" }),
  });
  await controller.checkKnown();
  assert.deepEqual(store.list(), [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 1_000 }]);
});

test("editing the gateway serving this page fixes its address and saves only its name", async () => {
  const saved: string[] = [];
  const { controller, closes } = setup({ saveCurrentName: async (name) => { saved.push(name); return true; } });
  const current = controller.views("Studio Mac")[0]!;
  controller.openEditGateway(current);
  assert.equal(controller.dialog?.addressFixed, true);
  assert.equal(controller.dialog?.address, CURRENT);
  controller.setDialogName("Studio");
  await controller.submitGatewayDialog();
  assert.deepEqual(saved, ["Studio"]);
  assert.equal(controller.dialog, null);
  assert.equal(closes.length, 1);
});

test("a name that does not save keeps the dialog open with HUI's wording", async () => {
  const { controller, closes } = setup({ saveCurrentName: async () => false });
  controller.openEditGateway(controller.views("Studio Mac")[0]!);
  controller.setDialogName("Studio");
  await controller.submitGatewayDialog();
  assert.equal(controller.dialog?.error, GATEWAY_NAME_UNSAVED);
  assert.equal(controller.dialog?.busy, false);
  assert.equal(closes.length, 0);
});

test("a running save cannot be dismissed, and a late answer does not redraw a closed dialog", async () => {
  let resolveProbe: (answer: GatewayProbe) => void = () => undefined;
  const { controller, store } = setup({ probe: () => new Promise((resolve) => { resolveProbe = resolve; }) });
  controller.openAddGateway();
  controller.setDialogAddress("http://loft.local:8787");
  const saving = controller.submitGatewayDialog();
  assert.equal(controller.dialog?.busy, true);
  controller.closeGatewayDialog();
  assert.equal(controller.dialog?.busy, true, "Escape and Cancel do nothing while the probe runs");
  resolveProbe({ ok: true, name: "Loft" });
  await saving;
  assert.equal(controller.dialog, null);
  assert.equal(store.list()[0]?.name, "Loft");
});
