import assert from "node:assert/strict";
import { test } from "node:test";
import { filesWorkViewKind, newFilesViewId } from "./files.ts";
import { writeFilesViewState } from "../files-view-state.ts";

test("each Files launch is a new view keyed by its id", async () => {
  const first = await filesWorkViewKind.create("session-a");
  const second = await filesWorkViewKind.create("session-a");
  assert.equal(first.kind, "files");
  assert.notEqual(first.id, second.id);
  assert.equal(filesWorkViewKind.key(first), first.id);
  assert.match(newFilesViewId(), /^files-/u);
  assert.equal(filesWorkViewKind.label, "Files");
  assert.equal(filesWorkViewKind.unavailable, undefined);
});

test("the tab shows the selected file's name, or Files", () => {
  const ref = { kind: "files" as const, id: "files-title-test" };
  assert.equal(filesWorkViewKind.title(ref), "Files");
  writeFilesViewState(ref.id, { selected: "src/components/files-view.ts" }, undefined);
  assert.equal(filesWorkViewKind.title(ref), "files-view.ts");
  writeFilesViewState(ref.id, { selected: undefined }, undefined);
  assert.equal(filesWorkViewKind.title(ref), "Files");
});

test("its launcher icon carries an explicit size", () => {
  const markup = filesWorkViewKind.icon.strings.join("");
  assert.match(markup, /width="16" height="16"/u);
});
