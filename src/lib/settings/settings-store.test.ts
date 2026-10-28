/** Route creation publishes only confirmed data and shares the settings queue without losing other edits. */
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { addSubagentRoute, currentSettings, loadSettings, patchSettings } from "./settings-store.ts";

const api = vi.hoisted(() => ({ fetchSettings: vi.fn<() => Promise<unknown>>(), saveSettings: vi.fn<(settings: Settings) => Promise<unknown>>() }));
vi.mock("../../api/settings.ts", () => api);

beforeEach(async () => {
  vi.stubGlobal("document", { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } } });
  api.fetchSettings.mockResolvedValue(DEFAULT_SETTINGS);
  api.saveSettings.mockReset().mockImplementation(async (settings) => settings);
  await loadSettings();
});

test.each([false, true])("route creation confirms before publishing and preserves a concurrent edit, saved=%s", async (saved) => {
  let succeed: (settings: Settings) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const response = new Promise<Settings>((resolve, reject) => { succeed = resolve; fail = reject; });
  api.saveSettings.mockImplementationOnce(() => response);
  const route = { name: "deep", description: "Careful debugging", model: "fixture/deep" };
  const creating = addSubagentRoute(route);
  await vi.waitFor(() => assert.equal(api.saveSettings.mock.calls.length, 1));
  assert.deepEqual(currentSettings().models.routes, [], "an unconfirmed route is never in the shared cache");
  const editing = patchSettings({ profileName: "Changed during creation" });
  const submitted = api.saveSettings.mock.calls[0]?.[0];
  assert.ok(submitted);
  assert.deepEqual(submitted.models.routes, [route]);
  if (saved) succeed(submitted);
  else fail(new Error("Settings storage unavailable"));
  assert.equal(await creating, saved);
  assert.equal(await editing, true);
  const expected = saved ? [route] : [];
  assert.deepEqual(api.saveSettings.mock.calls[1]?.[0].models.routes, expected, "a later write neither erases a confirmed route nor saves a failed one");
  assert.deepEqual(currentSettings().models.routes, expected);
  assert.equal(currentSettings().profileName, "Changed during creation");
  if (!saved) {
    assert.equal(await addSubagentRoute(route), true, "the same name can be retried after failure");
    assert.deepEqual(currentSettings().models.routes, [route]);
  }
});
