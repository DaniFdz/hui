import assert from "node:assert/strict";
import { test } from "node:test";
import { clearFilesViewState, DEFAULT_FILES_VIEW_STATE, filesViewTitle, normalizeFilesViewState, onFilesViewStateChange, readFilesViewState, writeFilesViewState } from "./files-view-state.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("malformed stored state falls back to the defaults", () => {
  assert.deepEqual(normalizeFilesViewState(null), DEFAULT_FILES_VIEW_STATE);
  assert.deepEqual(normalizeFilesViewState({ selected: 4, expanded: ["a", 2, "a"], navigatorOpen: false, markdown: "html" }), {
    selected: undefined, expanded: ["a"], navigatorOpen: false, markdown: "rendered",
  });
});

test("each view keeps its own selection and the tab title follows it", () => {
  const storage = new MemoryStorage();
  const changed: string[] = [];
  const stop = onFilesViewStateChange((id) => changed.push(id));
  writeFilesViewState("view-a", { selected: "src/a.ts", expanded: ["src"] }, storage);
  writeFilesViewState("view-b", { selected: "README.md", markdown: "source" }, storage);
  stop();
  assert.deepEqual(changed, ["view-a", "view-b"]);
  assert.equal(readFilesViewState("view-a", storage).selected, "src/a.ts");
  assert.equal(readFilesViewState("view-b", storage).markdown, "source");
  assert.equal(filesViewTitle("view-a"), "a.ts");
  assert.equal(filesViewTitle("view-b"), "README.md");
  assert.deepEqual(JSON.parse(storage.values.get("hui.files-view.v1:view-a")!), { selected: "src/a.ts", expanded: ["src"], navigatorOpen: true, markdown: "rendered" });
  clearFilesViewState("view-a", storage);
  assert.equal(storage.values.has("hui.files-view.v1:view-a"), false);
  assert.equal(readFilesViewState("view-a", storage).selected, undefined);
});

test("a fresh page reads what an earlier one stored", () => {
  const storage = new MemoryStorage();
  storage.setItem("hui.files-view.v1:view-c", JSON.stringify({ selected: "docs/x.md", expanded: ["docs"], navigatorOpen: false, markdown: "source" }));
  assert.deepEqual(readFilesViewState("view-c", storage), { selected: "docs/x.md", expanded: ["docs"], navigatorOpen: false, markdown: "source" });
});
