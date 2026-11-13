/** Guards native startup consent: a busy app is never accessibility-dumped, and only HUI's native Deny is tapped. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { refusePhoneNotificationPrompt } from "../e2e/fixtures/phone.ts";

const focused = (activity: string) => `  mCurrentFocus=Window{abc u0 ${activity}}`;
const permission = "com.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity";
const prompt = '<node text="Allow HUI to send you notifications?" /><node resource-id="com.android.permissioncontroller:id/permission_deny_button" bounds="[100,200][300,260]" />';

function device(activity: string, xml = prompt) {
  const calls: string[] = [];
  return { calls, run: (...args: string[]) => {
    const command = args.join(" ");
    calls.push(command);
    if (command === "shell dumpsys window") return focused(activity);
    if (!activity.includes("GrantPermissionsActivity")) throw new Error("busy app must never be accessibility-dumped");
    if (command.startsWith("shell cat ")) return xml;
    if (command.startsWith("shell uiautomator dump ")) return "UI hierchary dumped to: /sdcard/hui-notification-consent.xml";
    return "";
  } };
}

test("ordinary focused HUI never requests accessibility idle, even when a live WebView is busy", () => {
  const native = device("dev.hui.app.debug/dev.hui.app.MainActivity");
  refusePhoneNotificationPrompt(native.run);
  assert.deepEqual(native.calls, ["shell dumpsys window"]);
});

test("the focused real notification permission prompt is refused with its native Deny control, never granted", () => {
  const native = device(permission);
  refusePhoneNotificationPrompt(native.run);
  assert.deepEqual(native.calls, ["shell dumpsys window", "shell uiautomator dump /sdcard/hui-notification-consent.xml", "shell cat /sdcard/hui-notification-consent.xml", "shell input tap 200 230"]);
});

test("a failed dump never reads stale prompt XML or taps even when Android exits zero", () => {
  for (const output of ["", "ERROR: could not get idle state."]) {
    const native = device(permission);
    assert.throws(() => refusePhoneNotificationPrompt((...args) => args.includes("uiautomator") ? output : native.run(...args)), /inspection failed/u);
    assert.deepEqual(native.calls, ["shell dumpsys window"]);
  }
});

test("another app or permission is not dismissed; HUI's malformed refusal fails closed", () => {
  for (const text of ["Allow Another App to send you notifications?", "Allow HUI to record audio?"]) {
    const native = device(permission, prompt.replace("Allow HUI to send you notifications?", text));
    refusePhoneNotificationPrompt(native.run);
    assert.ok(!native.calls.some((call) => call.startsWith("shell input")));
  }
  assert.throws(() => refusePhoneNotificationPrompt(device(permission, prompt.replace("permission_deny_button", "permission_allow_button")).run), /no native refusal/u);
  assert.throws(() => refusePhoneNotificationPrompt(device(permission, prompt.replace("[300,260]", "[100,260]")).run), /empty native refusal/u);
});
