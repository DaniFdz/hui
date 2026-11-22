import assert from "node:assert/strict";
import { test } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "../lib/settings/settings.ts";
import { SETTINGS_COPY, describePushDevices, describePushTest } from "../lib/settings/pages.ts";
import { renderNotificationsPage, type SettingsProps } from "./settings.ts";

/** The rendered text, including the value a directive such as `live(checked)` binds. */
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, index) => part + text(template.values[index])).join("");
  }
  if (value && typeof value === "object" && "values" in value && Array.isArray((value as { values?: unknown }).values)) {
    return text((value as { values: unknown[] }).values);
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

/** The copy as a literal, so a sentence's own punctuation is never a pattern. */
const literal = (value: string): RegExp => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");

const settings = (notifications: Partial<Settings["notifications"]> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  notifications: { ...DEFAULT_SETTINGS.notifications, ...notifications },
});

function render(overrides: Partial<SettingsProps> = {}): string {
  return text(renderNotificationsPage({
    settings: settings(),
    pushDevice: "ready",
    pushSubscribed: false,
    pushDevices: 0,
    pushStatusError: "",
    onChangeNotifications: () => {},
    onEnablePush: () => {},
    onDisablePush: () => {},
    onTestPush: () => {},
    ...overrides,
  } as SettingsProps));
}

test("a device that can subscribe offers the switch, the enable button and the device count", () => {
  const result = render({ pushDevices: 2 });
  assert.match(result, /This device/);
  assert.match(result, literal(SETTINGS_COPY.push.labels.toggle), "the switch is labelled in words");
  assert.match(result, literal(SETTINGS_COPY.push.states.ready));
  assert.match(result, /class="btn primary" @click=>Enable on this device</u, "a ready, unsubscribed device is offered the enable button");
  assert.doesNotMatch(result, /Disable on this device/u);
  assert.match(result, /2 devices are subscribed\./u);
  assert.match(result, literal(SETTINGS_COPY.push.labels.test));
  assert.match(result, literal(SETTINGS_COPY.push.fallback), "the ntfy fallback is named beside it");
});

test("every state this page can be in renders its own copy and never a button it cannot honour", () => {
  const subscribed = render({ pushSubscribed: true });
  assert.match(subscribed, literal(SETTINGS_COPY.push.states.subscribed));
  assert.match(subscribed, /class="btn" @click=>Disable on this device</u, "a subscribed device is offered the way out");
  assert.doesNotMatch(subscribed, /Enable on this device/u);

  const ios = render({ pushDevice: "ios-not-installed" });
  assert.match(ios, /Share → Add to Home Screen, then open HUI from the Home Screen and enable notifications here/u, "the exact iOS steps");
  assert.match(ios, /class="btn" disabled>Enable on this device</u, "Safari outside the Home Screen cannot subscribe");

  const insecure = render({ pushDevice: "insecure" });
  assert.match(insecure, /Web Push needs a secure address\. Open HUI over HTTPS/u);
  assert.match(insecure, /class="btn" disabled>Enable on this device</u);

  const unsupported = render({ pushDevice: "unsupported" });
  assert.match(unsupported, /This browser cannot receive Web Push\./u);
  assert.match(unsupported, /class="btn" disabled>Enable on this device</u);

  // A browser whose operator blocked notifications says so and offers nothing to click: the site settings are the only
  // way back, and the control that would fail is rendered disabled rather than inviting the click.
  const blocked = render({ pushDevice: "blocked" });
  assert.match(blocked, literal(SETTINGS_COPY.push.states.blocked));
  assert.match(blocked, /Allow notifications for HUI there, then reload HUI and enable this device/u);
  assert.match(blocked, /class="btn" disabled>Enable on this device</u);
  for (const result of [ios, insecure, unsupported, blocked]) assert.doesNotMatch(result, /Disable on this device/u);
});

test("the switch carries the saved setting and the contact field the saved subject", () => {
  assert.match(render({ settings: settings({ push: { enabled: false, subject: "" } }) }), /\.checked=false/u);
  assert.match(render({ settings: settings({ push: { enabled: true, subject: "" } }) }), /\.checked=true/u);
  const contact = render({ settings: settings({ push: { enabled: true, subject: "mailto:ops@example.com" } }) });
  assert.match(contact, /name="subject"[^>]*\.value=mailto:ops@example\.com/u);
  assert.match(contact, /aria-label="Push contact"/u);
  assert.match(contact, /The address a push service may use to reach you/u);
  assert.match(render({ settings: settings({ push: { enabled: true, subject: "" } }) }), /\.value= \/>/u, "an empty subject binds nothing");
});

test("the section comes before Phone (ntfy), which calls itself the fallback", () => {
  const result = render();
  assert.ok(result.indexOf(SETTINGS_COPY.push.labels.toggle) < result.indexOf("Phone (ntfy)"), "This device leads");
  assert.match(result, /The fallback: HUI publishes each notification to this topic/u);
});

test("the count and the test push report what the gateway answered, not what it hoped", () => {
  assert.equal(describePushDevices(undefined), "Reading the subscribed devices…");
  assert.equal(describePushDevices(0), "No device is subscribed.");
  assert.equal(describePushDevices(1), "1 device is subscribed.");
  assert.equal(describePushDevices(3), "3 devices are subscribed.");
  assert.match(render({ pushDevices: undefined }), /Reading the subscribed devices…/u);
  assert.match(render({ pushStatusError: "Could not read this gateway's push state." }), /Could not read this gateway's push state\./u);

  assert.equal(describePushTest(2, 2), "The test push went to 2 devices.");
  assert.equal(describePushTest(1, 1), "The test push went to 1 device.");
  assert.equal(describePushTest(1, 3), "The test push went to 1 device of 3.");
  assert.equal(describePushTest(0, 2), SETTINGS_COPY.push.noAccept);
  assert.equal(describePushTest(0, 0), SETTINGS_COPY.push.noDevices);
});

test("notifications settings normalize the push switch and its optional subject", () => {
  assert.equal(normalizeSettings({}).notifications.push.enabled, false, "no old settings file starts pushing");
  assert.equal(normalizeSettings({}).notifications.push.subject, "");
  assert.deepEqual(normalizeSettings({ notifications: { push: { enabled: true, subject: " mailto:a@b.c " } } }).notifications.push, { enabled: true, subject: "mailto:a@b.c" });
  assert.deepEqual(normalizeSettings({ notifications: { push: { enabled: true, subject: "not an address" } } }).notifications.push, { enabled: true, subject: "" });
});
