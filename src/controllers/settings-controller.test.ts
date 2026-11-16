import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { ReactiveController } from "lit";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "../lib/settings/settings.ts";
import type { PiResourceDocument } from "../lib/pi.ts";
import type { PushSubscribeRequest } from "../api/schema/notifications.ts";
import type { PushRegistrationLike } from "../lib/notifications/web-push.ts";
import { PUSH_SUBSCRIBE_ERRORS } from "../lib/notifications/web-push.ts";
import { SETTINGS_COPY, describePushTest } from "../lib/settings/pages.ts";
import { SettingsController, type PushBrowser } from "./settings-controller.ts";

type Power = NonNullable<SettingsController["power"]>;

const fake = vi.hoisted(() => ({
  settings: undefined as unknown as Settings,
  patches: [] as Array<Partial<Settings>>,
  writes: [] as Array<(saved: boolean) => void>,
  power: [] as Array<(power: unknown) => void>,
  copied: true,
}));

/** The push routes as the controller calls them: what each one was asked, and what it answers. */
const pushApi = vi.hoisted(() => ({
  status: { publicKey: "public-key", devices: [] as Array<{ id: string; createdAt: string }> },
  statusError: "",
  statusReads: 0,
  subscribed: [] as PushSubscribeRequest[],
  unsubscribed: [] as string[],
  unsubscribeError: "",
  test: { sent: 0, devices: 0 },
  testError: "",
}));

vi.mock("../lib/settings/settings-store.ts", () => ({
  currentSettings: () => fake.settings,
  patchSettings: (patch: Partial<Settings>) => {
    fake.patches.push(patch);
    fake.settings = { ...fake.settings, ...patch };
    return new Promise<boolean>((resolve) => fake.writes.push(resolve));
  },
}));
vi.mock("../api/control-surfaces.ts", () => ({
  loadPower: () => new Promise((resolve) => fake.power.push(resolve)),
}));
vi.mock("../api/pi.ts", () => ({
  loadPiResource: async (_kind: string, id: string): Promise<PiResourceDocument> =>
    ({ id, kind: "skill", title: "Review", fileName: "SKILL.md", format: "markdown", content: "# Review", truncated: false }),
}));
vi.mock("../lib/clipboard.ts", () => ({ writeClipboardText: async () => fake.copied }));
vi.mock("../api/notifications.ts", () => ({
  fetchPushStatus: async () => {
    pushApi.statusReads += 1;
    if (pushApi.statusError) throw new Error(pushApi.statusError);
    return pushApi.status;
  },
  subscribePushDevice: async (request: PushSubscribeRequest) => { pushApi.subscribed.push(request); return { subscribed: true, id: "device-id" }; },
  unsubscribePushDevice: async (endpoint: string) => {
    pushApi.unsubscribed.push(endpoint);
    if (pushApi.unsubscribeError) throw new Error(pushApi.unsubscribeError);
    return { removed: true };
  },
  sendPushTest: async () => {
    if (pushApi.testError) throw new Error(pushApi.testError);
    return pushApi.test;
  },
  sendTestNotification: async () => undefined,
}));

beforeEach(() => {
  fake.settings = DEFAULT_SETTINGS;
  fake.patches = [];
  fake.writes = [];
  fake.power = [];
  fake.copied = true;
  pushApi.status = { publicKey: "public-key", devices: [] };
  pushApi.statusError = "";
  pushApi.statusReads = 0;
  pushApi.subscribed = [];
  pushApi.unsubscribed = [];
  pushApi.unsubscribeError = "";
  pushApi.test = { sent: 0, devices: 0 };
  pushApi.testError = "";
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(push: PushBrowser = pushBrowser()) {
  const controllers: ReactiveController[] = [];
  const failures: string[] = [];
  const notices: { message: string; failed: boolean }[] = [];
  const host = {
    updates: 0,
    addController: (controller: ReactiveController) => { controllers.push(controller); },
    removeController: () => {},
    requestUpdate() { this.updates += 1; },
    updateComplete: Promise.resolve(true),
    renderRoot: { querySelector: () => null } as unknown as ParentNode,
  };
  const controller = new SettingsController(host, {
    piLoaded: () => {},
    copyFailed: (message) => failures.push(message),
    notified: (message, failed) => notices.push({ message, failed }),
  }, push);
  return { controller, host, controllers, failures, notices };
}

/** A desktop Chrome that can subscribe: the environment every push test starts from unless it says otherwise. */
const DESKTOP_CHROME = "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0.0.0";

/** This browser behind the push actions, with the state a real one keeps: it remembers its subscription. */
function pushBrowser(overrides: Partial<PushBrowser> = {}): PushBrowser {
  let endpoint: string | undefined;
  const registration: PushRegistrationLike = {
    pushManager: {
      subscribe: async () => ({ endpoint: "https://push.example.net/device", getKey: () => new ArrayBuffer(16) }),
      getSubscription: async () => null,
    },
  };
  return {
    environment: () => ({ secure: true, pushManager: true, userAgent: DESKTOP_CHROME, standalone: false }),
    registration: async () => registration,
    permission: async () => "granted",
    subscription: async () => endpoint,
    subscribe: async () => {
      endpoint = "https://push.example.net/device";
      return { ok: true, endpoint, p256dh: "point", auth: "auth" };
    },
    unsubscribe: async () => {
      endpoint = undefined;
      return true;
    },
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function power(lidOn: boolean): Power {
  const off = { state: "off" as const, detail: "" };
  return { keepAwake: off, lidAwake: off, lidOn };
}

test("a save sends only its patch and renders the store's snapshot before the write lands", async () => {
  const { controller, controllers, host } = setup();
  assert.deepEqual(controllers, [controller]);
  const saving = controller.save({ branchPrefix: "dani/" });
  assert.deepEqual(fake.patches, [{ branchPrefix: "dani/" }], "never the whole settings merged with the patch");
  assert.equal(controller.settings.branchPrefix, "dani/", "the optimistic snapshot, before the write");
  assert.ok(host.updates > 0);
  fake.settings = normalizeSettings({ branchPrefix: "confirmed/" });
  fake.writes[0]!(false);
  await saving;
  assert.equal(controller.saveFailed, true);
  assert.equal(controller.settings.branchPrefix, "confirmed/", "the store's answer once the write settles");

  controller.patchOwnedSettings({ labs: { ...DEFAULT_SETTINGS.labs, detailedDebug: true } });
  assert.deepEqual(fake.patches[1], { labs: { ...DEFAULT_SETTINGS.labs, detailedDebug: true } });
});

test("only the newest save reports whether it landed", async () => {
  const { controller } = setup();
  const first = controller.save({ branchPrefix: "a/" });
  const second = controller.save({ branchPrefix: "b/" });
  fake.writes[1]!(true);
  await second;
  fake.writes[0]!(false);
  await first;
  assert.equal(controller.saveFailed, false);
});

test("the newest power read wins, and a lid turned off brings its notice back", async () => {
  const { controller, host } = setup();
  const older = controller.refreshPower();
  const newer = controller.refreshPower();
  fake.power[1]!(power(true));
  await newer;
  fake.power[0]!(power(false));
  await older;
  assert.equal(controller.power?.lidOn, true, "an older poll never undoes a click");
  controller.dismissPowerNotice();
  assert.equal(controller.powerNoticeDismissed, true);
  const off = controller.refreshPower();
  fake.power[2]!(power(false));
  await off;
  assert.equal(controller.powerNoticeDismissed, false);
  const updates = host.updates;
  const same = controller.refreshPower();
  fake.power[3]!(power(false));
  await same;
  assert.equal(host.updates, updates, "a poll that changes nothing redraws nothing");
});

test("the power poll asks again only once the gateway answered its last read", async () => {
  const { controller } = setup();
  controller.pollPower();
  controller.pollPower();
  assert.equal(fake.power.length, 1, "a slow gateway is not asked twice");
  fake.power[0]!(power(true));
  await settle();
  assert.equal(controller.power?.lidOn, true);
  controller.pollPower();
  assert.equal(fake.power.length, 2);
});

test("the resource reader's Copied mark clears after 1.5 s, and closing returns the focus", async () => {
  vi.stubGlobal("window", globalThis);
  const Element = class {};
  vi.stubGlobal("HTMLElement", Element);
  const focused: string[] = [];
  const trigger = Object.assign(new Element(), { focus: () => focused.push("trigger") });
  vi.stubGlobal("document", { activeElement: trigger });
  const { controller, failures } = setup();
  controller.readPiResource("skill", { id: "review", name: "Review" });
  assert.deepEqual(controller.piResourceReader, { title: "Review", status: "loading" });
  await settle();
  assert.equal(controller.piResourceReader?.status, "ready");

  vi.useFakeTimers();
  controller.copyPiResource();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(controller.piResourceReader?.copied, true);
  await vi.advanceTimersByTimeAsync(1_499);
  assert.equal(controller.piResourceReader?.copied, true);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(controller.piResourceReader?.copied, false);

  fake.copied = false;
  controller.copyPiResource();
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(failures, ["Could not copy the resource to the clipboard."]);

  controller.closePiResourceReader();
  assert.equal(controller.piResourceReader, undefined);
  assert.deepEqual(focused, ["trigger"]);
});

test("enabling this device subscribes it, registers it, then turns the switch on", async () => {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1" });
  const { controller, notices } = setup();
  assert.equal(controller.pushDevice, "ready", "the injected environment is a secure browser with a push manager");
  assert.equal(controller.settings.notifications.push.enabled, false);

  const running = controller.enablePushOnThisDevice();
  await settle();
  assert.equal(pushApi.statusReads, 1, "the public key comes from the gateway");
  assert.deepEqual(pushApi.subscribed, [{
    endpoint: "https://push.example.net/device",
    keys: { p256dh: "point", auth: "auth" },
    device: "iPhone",
  }]);
  fake.writes.at(-1)?.(true);
  await running;
  assert.deepEqual(fake.patches.at(-1), { notifications: { ...DEFAULT_SETTINGS.notifications, push: { enabled: true, subject: "" } } }, "only the push switch changes");
  assert.equal(controller.pushSubscribed, true);
  assert.deepEqual(notices, [{ message: SETTINGS_COPY.push.enabled, failed: false }]);
  vi.unstubAllGlobals();
});

test("a refused permission or a browser without a push service is a sentence, never a raw error", async () => {
  const denied = setup(pushBrowser({ permission: async () => "denied" }));
  await denied.controller.enablePushOnThisDevice();
  assert.equal(denied.notices.length, 1, "one refusal, one report");
  assert.equal(denied.notices[0]?.failed, true);
  assert.match(denied.notices[0]?.message ?? "", /blocked for HUI in this browser's site settings/u);
  assert.deepEqual(pushApi.subscribed, [], "a blocked permission registers nothing");
  assert.deepEqual(fake.patches, [], "and turns no switch");

  const noService = setup(pushBrowser({
    subscribe: async () => ({ ok: false, reason: "no-push-service", error: "This browser has no push service to deliver through." }),
  }));
  await noService.controller.enablePushOnThisDevice();
  assert.deepEqual(noService.notices, [{ message: "This browser has no push service to deliver through.", failed: true }]);
  assert.deepEqual(pushApi.subscribed, []);
  assert.deepEqual(fake.patches, []);

  let asked = 0;
  const noWorker = setup(pushBrowser({ registration: async () => undefined, permission: async () => { asked += 1; return "granted"; } }));
  await noWorker.controller.enablePushOnThisDevice();
  assert.deepEqual(noWorker.notices, [{ message: PUSH_SUBSCRIBE_ERRORS["no-service-worker"], failed: true }]);
  assert.equal(asked, 0, "a page with no service worker never asks for permission it could not use");
});

test("a page that cannot subscribe says why instead of pretending to enable", async () => {
  const { controller, notices } = setup(pushBrowser({
    environment: () => ({ secure: true, pushManager: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", standalone: false }),
  }));
  assert.equal(controller.pushDevice, "ios-not-installed");
  await controller.enablePushOnThisDevice();
  assert.deepEqual(notices, [{ message: SETTINGS_COPY.push.states["ios-not-installed"], failed: true }]);
  assert.equal(pushApi.statusReads, 0, "nothing is asked of the gateway for a page that cannot subscribe");
  assert.deepEqual(fake.patches, []);
});

test("a browser whose operator blocked notifications says so instead of offering a click that can only fail", async () => {
  const { controller, notices } = setup(pushBrowser({
    environment: () => ({ secure: true, pushManager: true, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0.0.0", standalone: false, permission: "denied" }),
  }));
  assert.equal(controller.pushDevice, "blocked");
  await controller.enablePushOnThisDevice();
  assert.deepEqual(notices, [{ message: SETTINGS_COPY.push.states.blocked, failed: true }]);
  assert.equal(pushApi.statusReads, 0, "a blocked permission asks the gateway for nothing");
  assert.deepEqual(pushApi.subscribed, []);
  assert.deepEqual(fake.patches, []);
});

test("a permission the operator just blocked shows on the row at once, without a reload", async () => {
  let permission: NotificationPermission = "default";
  const { controller, host } = setup(pushBrowser({
    // What `Notification.permission` says, read whenever the page asks: the prompt below is what changes it.
    environment: () => ({ secure: true, pushManager: true, userAgent: DESKTOP_CHROME, standalone: false, permission }),
    permission: async () => {
      permission = "denied";
      return permission;
    },
  }));
  assert.equal(controller.pushDevice, "ready", "nothing is blocked until the prompt is answered");
  const updates = host.updates;

  await controller.enablePushOnThisDevice();

  assert.equal(controller.pushDevice, "blocked", "the browser's own permission, never a guess from the refusal");
  assert.ok(host.updates > updates, "the row and its button redraw with it");
  assert.deepEqual(pushApi.subscribed, [], "a blocked permission registers nothing");
  assert.deepEqual(fake.patches, [], "and turns no switch");

  await controller.enablePushOnThisDevice();
  assert.equal(pushApi.statusReads, 1, "the now blocked row asks the gateway for nothing else");
  assert.deepEqual(pushApi.subscribed, [], "and a second click still cannot subscribe this browser");
});

test("a refusal that leaves the permission alone keeps the row ready and its button usable", async () => {
  const { controller, host } = setup(pushBrowser({
    // A browser that refuses the click for another reason than permission: `Notification.permission` stays `default`.
    environment: () => ({ secure: true, pushManager: true, userAgent: DESKTOP_CHROME, standalone: false, permission: "default" }),
    permission: async () => "default",
  }));
  assert.equal(controller.pushDevice, "ready");
  const updates = host.updates;

  await controller.enablePushOnThisDevice();

  assert.equal(controller.pushDevice, "ready", "nothing about the permission changed, so neither does the row");
  assert.equal(host.updates, updates, "and an unchanged answer redraws nothing");
  await controller.enablePushOnThisDevice();
  assert.equal(pushApi.statusReads, 2, "the button still asks, instead of blaming a permission that was never blocked");
  assert.deepEqual(pushApi.subscribed, [], "nothing subscribed this browser");
});

test("a successful enable re-reads the environment, so the row and the button follow it", async () => {
  let permission: NotificationPermission = "default";
  let reads = 0;
  const { controller } = setup(pushBrowser({
    environment: () => {
      reads += 1;
      return { secure: true, pushManager: true, userAgent: DESKTOP_CHROME, standalone: false, permission };
    },
    permission: async () => {
      permission = "granted";
      return permission;
    },
  }));
  assert.equal(reads, 1, "the page reads the environment once when it loads");
  assert.equal(controller.pushDevice, "ready");

  const running = controller.enablePushOnThisDevice();
  await settle();
  fake.writes.at(-1)?.(true);
  await running;

  assert.equal(reads, 2, "the click that answered the prompt reads the environment again");
  assert.equal(controller.pushDevice, "ready", "what pushDeviceState says about the permission it now has");
  assert.equal(controller.pushSubscribed, true);
});

test("a disable the browser refused re-reads the environment too, so a blocked permission shows", async () => {
  let permission: NotificationPermission = "granted";
  const { controller } = setup(pushBrowser({
    subscription: async () => "https://push.example.net/device",
    environment: () => ({ secure: true, pushManager: true, userAgent: DESKTOP_CHROME, standalone: false, permission }),
    unsubscribe: async () => {
      permission = "denied";
      return false;
    },
  }));
  assert.equal(controller.pushDevice, "ready");

  const running = controller.disablePushOnThisDevice();
  await settle();
  fake.writes.at(-1)?.(true);
  await running;

  assert.equal(controller.pushDevice, "blocked", "the row says what the browser says after the attempt");
  assert.equal(controller.pushSubscribed, false, "the gateway no longer pushes to this device either way");
});

test("disabling this device forgets it at the push service and the gateway, then turns the switch off", async () => {
  const { controller, notices } = setup(pushBrowser({ subscription: async () => "https://push.example.net/device" }));
  const running = controller.disablePushOnThisDevice();
  await settle();
  assert.deepEqual(pushApi.unsubscribed, ["https://push.example.net/device"]);
  fake.writes.at(-1)?.(true);
  await running;
  assert.deepEqual(fake.patches.at(-1), { notifications: { ...DEFAULT_SETTINGS.notifications, push: { enabled: false, subject: "" } } });
  assert.equal(controller.pushSubscribed, false);
  assert.deepEqual(notices, [{ message: SETTINGS_COPY.push.disabled, failed: false }]);
});

test("a removal the gateway refuses keeps the endpoint, so a retry after the browser forgot it still frees the device", async () => {
  let endpoint: string | undefined = "https://push.example.net/device";
  const { controller, notices } = setup(pushBrowser({ subscription: async () => endpoint }));

  pushApi.unsubscribeError = "The gateway could not remove this device.";
  const first = controller.disablePushOnThisDevice();
  await settle();
  await first;
  assert.deepEqual(pushApi.unsubscribed, ["https://push.example.net/device"], "the gateway is asked before the browser forgets anything");
  assert.deepEqual(fake.patches, [], "a device the gateway still holds keeps the switch on");
  assert.equal(controller.pushSubscribed, true, "and the page still offers the way out");
  assert.deepEqual(notices, [{ message: "The gateway could not remove this device.", failed: true }]);

  // The browser then loses its subscription. Only the endpoint this page remembered can still free the device.
  endpoint = undefined;
  pushApi.unsubscribeError = "";
  const retry = controller.disablePushOnThisDevice();
  await settle();
  fake.writes.at(-1)?.(true);
  await retry;
  assert.deepEqual(pushApi.unsubscribed, ["https://push.example.net/device", "https://push.example.net/device"], "the retry removes the remembered endpoint");
  assert.deepEqual(fake.patches.at(-1), { notifications: { ...DEFAULT_SETTINGS.notifications, push: { enabled: false, subject: "" } } });
  assert.equal(controller.pushSubscribed, false);
  assert.deepEqual(notices.at(-1), { message: SETTINGS_COPY.push.disabled, failed: false });
});

test("a device with nothing subscribed is told so, and the switch still goes off", async () => {
  const { controller, notices } = setup();
  const running = controller.disablePushOnThisDevice();
  await settle();
  fake.writes.at(-1)?.(true);
  await running;
  assert.deepEqual(pushApi.unsubscribed, [], "there was no endpoint to forget");
  assert.deepEqual(notices, [{ message: SETTINGS_COPY.push.nothingToRemove, failed: false }]);
  assert.deepEqual(fake.patches.at(-1), { notifications: { ...DEFAULT_SETTINGS.notifications, push: { enabled: false, subject: "" } } });
});

test("a test push reports the counts the route answered with, and its own error", async () => {
  const { controller, notices } = setup();
  pushApi.test = { sent: 2, devices: 2 };
  await controller.testPushNotification();
  assert.deepEqual(notices.at(-1), { message: describePushTest(2, 2), failed: false });
  assert.equal(controller.pushDevices, 2);

  pushApi.test = { sent: 1, devices: 3 };
  await controller.testPushNotification();
  assert.deepEqual(notices.at(-1), { message: "The test push went to 1 device of 3.", failed: true });

  pushApi.test = { sent: 0, devices: 0 };
  await controller.testPushNotification();
  assert.deepEqual(notices.at(-1), { message: SETTINGS_COPY.push.noDevices, failed: true });

  pushApi.testError = "The push service answered HTTP 410.";
  await controller.testPushNotification();
  assert.deepEqual(notices.at(-1), { message: "The push service answered HTTP 410.", failed: true });
});

test("the device count and this device's own subscription are read once at a time", async () => {
  pushApi.status = { publicKey: "public-key", devices: [{ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }, { id: "b", createdAt: "2026-01-02T00:00:00.000Z" }] };
  const { controller } = setup(pushBrowser({ subscription: async () => "https://push.example.net/device" }));
  controller.loadPushStatus();
  controller.loadPushStatus();
  await settle();
  assert.equal(pushApi.statusReads, 1, "a second visit does not read twice while the first read runs");
  assert.equal(controller.pushDevices, 2);
  assert.equal(controller.pushSubscribed, true);

  pushApi.statusError = "Could not read this gateway's push state.";
  controller.loadPushStatus();
  await settle();
  assert.equal(controller.pushStatusError, "Could not read this gateway's push state.", "a failed read is reported, never a stale count");
});
