/** Guards fresh native consent inspection: a busy app is never dumped, and only the same real HUI prompt is refused. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { refusePhoneNotificationPrompt } from "../e2e/fixtures/phone.ts";

const hui = "dev.hui.app.debug/dev.hui.app.MainActivity";
const permission = "com.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity";
const focused = (activity: string, token = "abc") => `  mCurrentFocus=Window{${token} u0 ${activity}}`;
const prompt = '<hierarchy rotation="0"><node text="Allow HUI to send you notifications?" /><node resource-id="com.android.permissioncontroller:id/permission_deny_button" bounds="[100,200][300,260]" /></hierarchy>';
const ack = "UI hierchary dumped to: /sdcard/hui-notification-consent.xml";

type Options = { focus?: string[]; output?: string; fresh?: string; dumpError?: boolean; owner?: boolean };
function device(options: Options = {}) {
  const calls: string[] = [];
  const focuses = [...(options.focus ?? [focused(permission)])];
  let xml: string | undefined = prompt; // A stale file from an earlier prompt must never be consumed.
  let ownershipReads = 0;
  const run = (...args: string[]) => {
    const command = args.join(" "); calls.push(command);
    if (command === "shell dumpsys window") return focuses.length > 1 ? focuses.shift()! : focuses[0]!;
    if (command === "shell rm -f /sdcard/hui-notification-consent.xml") { xml = undefined; return ""; }
    if (command.startsWith("shell uiautomator dump ")) {
      if (options.dumpError) throw new Error("native transport failed");
      xml = options.fresh;
      return options.output ?? ack;
    }
    if (command.startsWith("shell cat ")) {
      if (xml === undefined) throw new Error("No such file or directory");
      return xml;
    }
    if (command.startsWith("shell input tap ")) return "";
    throw new Error(`unexpected native command: ${command}`);
  };
  return { calls, run, owns: () => { ownershipReads++; return options.owner ?? false; }, ownershipReads: () => ownershipReads };
}

test("ordinary HUI or another app never requests accessibility idle or target discovery", () => {
  for (const activity of [hui, "other.app/MainActivity"]) {
    const native = device({ focus: [focused(activity)] });
    refusePhoneNotificationPrompt(native.run, native.owns);
    assert.deepEqual(native.calls, ["shell dumpsys window"]);
    assert.equal(native.ownershipReads(), 0);
  }
});

test("fresh complete HUI notification XML and unchanged native focus authorize one Deny, even without a stdout ACK", () => {
  for (const output of [ack, ""]) {
    const native = device({ fresh: prompt, output });
    refusePhoneNotificationPrompt(native.run, native.owns);
    assert.deepEqual(native.calls, ["shell dumpsys window", "shell rm -f /sdcard/hui-notification-consent.xml", "shell uiautomator dump /sdcard/hui-notification-consent.xml", "shell cat /sdcard/hui-notification-consent.xml", "shell dumpsys window", "shell input tap 200 230"]);
    assert.equal(native.ownershipReads(), 0);
  }
});

test("stale, idle-failed, partial, missing or malformed inspections and changed focus never authorize a native tap", () => {
  const cases: Options[] = [
    { output: "" }, { output: "ERROR: could not get idle state.", fresh: prompt },
    { output: `${ack}\nERROR: could not get idle state.`, fresh: prompt },
    { fresh: prompt.replace("</hierarchy>", "</node></hierarchy>") },
    { fresh: prompt.replace("</hierarchy>", "") }, { fresh: "" }, { dumpError: true },
    { fresh: prompt, focus: [focused(permission), focused("other.app/MainActivity")], owner: true },
    { fresh: prompt, focus: [focused(permission), focused(permission, "replacement")] },
    { output: "", focus: [focused(permission), focused(hui)], owner: false },
  ];
  for (const options of cases) {
    const native = device(options);
    assert.throws(() => refusePhoneNotificationPrompt(native.run, native.owns), /native notification inspection failed:.*focus/isu);
    assert.ok(!native.calls.some((call) => call.startsWith("shell input")));
    assert.equal(native.calls.filter((call) => call.includes("uiautomator")).length, 1);
    assert.ok(native.calls.indexOf("shell rm -f /sdcard/hui-notification-consent.xml") < native.calls.indexOf("shell uiautomator dump /sdcard/hui-notification-consent.xml"));
  }
  for (const text of ["Allow Another App to send you notifications?", "Allow HUI to record audio?"]) {
    const native = device({ fresh: prompt.replace("Allow HUI to send you notifications?", text) });
    refusePhoneNotificationPrompt(native.run, native.owns);
    assert.ok(!native.calls.some((call) => call.startsWith("shell input")));
  }
  for (const malformed of [prompt.replace("permission_deny_button", "permission_allow_button"), prompt.replace("[300,260]", "[100,260]")]) {
    const native = device({ fresh: malformed });
    assert.throws(() => refusePhoneNotificationPrompt(native.run, native.owns), /native notification inspection failed/iu);
    assert.ok(!native.calls.some((call) => call.startsWith("shell input")));
  }
});

test("a vanished dialog returns without action only for freshly focused HUI with the owned attached target", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  for (const options of [{ output: "" }, { dumpError: true }, { fresh: prompt }]) {
    const native = device({ ...options, focus: [focused(permission), focused(hui)], owner: true });
    refusePhoneNotificationPrompt(native.run, native.owns);
    assert.equal(native.ownershipReads(), 1);
    assert.ok(!native.calls.some((call) => call.startsWith("shell input")));
  }
  assert.ok(log.mock.calls.every(([message]) => !String(message).includes("Declined")), "an already gone prompt is never reported as refused");
});
