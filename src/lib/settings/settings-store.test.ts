/** Confirmed route saves preserve the original on failure and keep unrelated queued settings edits. */
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { currentSettings, loadSettings, patchSettings, saveSubagentRoute } from "./settings-store.ts";

const api = vi.hoisted(() => ({ fetchSettings: vi.fn<() => Promise<unknown>>(), saveSettings: vi.fn<(settings: Settings) => Promise<unknown>>() }));
vi.mock("../../api/settings.ts", () => api);

beforeEach(async () => {
  vi.stubGlobal("document", { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } } });
  api.fetchSettings.mockResolvedValue(DEFAULT_SETTINGS);
  api.saveSettings.mockReset().mockImplementation(async (settings) => settings);
  await loadSettings();
});

test.each([
  { editing: false, saved: false }, { editing: false, saved: true },
  { editing: true, saved: false }, { editing: true, saved: true },
])("route saves confirm before publishing and preserve a queued model-role change, editing=$editing saved=$saved", async ({ editing, saved }) => {
  const fast = { name: "fast", description: "Quick lookups", model: "fixture/fast" };
  const original = { name: "deep", description: "Careful debugging", model: "fixture/deep" };
  const initial = editing ? [fast, original] : [fast];
  api.fetchSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, routes: initial } });
  await loadSettings();
  let succeed: (settings: Settings) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const response = new Promise<Settings>((resolve, reject) => { succeed = resolve; fail = reject; });
  api.saveSettings.mockImplementationOnce(() => response);
  const route = { ...original, name: "expert", description: "Updated debugging route" };
  const originalName = editing ? original.name : undefined;
  const saving = saveSubagentRoute(route, originalName);
  await vi.waitFor(() => assert.equal(api.saveSettings.mock.calls.length, 1));
  assert.deepEqual(currentSettings().models.routes, initial, "an unconfirmed draft never changes the shared cache");
  const changingRole = patchSettings({ models: { ...currentSettings().models, primary: "fixture/new-primary" } });
  const submitted = api.saveSettings.mock.calls[0]?.[0];
  assert.ok(submitted);
  assert.deepEqual(submitted.models.routes, [fast, route]);
  if (saved) succeed(submitted);
  else fail(new Error("Settings storage unavailable"));
  assert.equal(await saving, saved);
  assert.equal(await changingRole, true);
  const expected = saved ? [fast, route] : initial;
  assert.deepEqual(api.saveSettings.mock.calls[1]?.[0].models.routes, expected, "a queued settings write preserves confirmed routes and never saves a failed draft");
  assert.deepEqual(currentSettings().models.routes, expected);
  assert.equal(currentSettings().models.primary, "fixture/new-primary");
  if (!saved) {
    assert.equal(await saveSubagentRoute(route, originalName), true, "the same draft can be retried after failure");
    assert.deepEqual(currentSettings().models.routes, [fast, route]);
  }
});

test("editing at the route limit keeps an unchanged model and refuses invalid replacements before writing", async () => {
  const routes = Array.from({ length: 50 }, (_, index) => ({ name: `route-${index}`, description: "Saved route", model: "retired/model" }));
  api.fetchSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, routes } });
  await loadSettings();
  const original = routes[0];
  assert.ok(original);
  for (const [route, originalName] of [
    [{ ...original, name: "extra" }, undefined],
    [{ ...original, name: "missing-target" }, "missing"],
    [{ ...original, name: "route-1" }, original.name],
    [{ ...original, model: "invalid-model" }, original.name],
  ] satisfies [Settings["models"]["routes"][number], string | undefined][]) {
    assert.equal(await saveSubagentRoute(route, originalName), false);
    assert.deepEqual(currentSettings().models.routes, routes);
    assert.equal(api.saveSettings.mock.calls.length, 0, "a refused edit never writes a document that could drop the original");
  }
  const updated = { ...original, description: "Updated description" };
  assert.equal(await saveSubagentRoute(updated, original.name), true, "keeping the same name is not a duplicate");
  assert.deepEqual(currentSettings().models.routes, [updated, ...routes.slice(1)]);
  assert.equal(currentSettings().models.routes.length, 50);
});
