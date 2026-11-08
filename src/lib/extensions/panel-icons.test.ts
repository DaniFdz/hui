/** The extension panel's tab icon is a named HUI mark, with the package cube as the fallback. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { brandMarks, icons } from "../icons.ts";
import { extensionPanelIcon } from "./panel-icons.ts";

test("a panel icon maps to its named mark and falls back to the package", () => {
  assert.equal(extensionPanelIcon("pull-request"), brandMarks.pullRequest);
  assert.equal(extensionPanelIcon("github"), brandMarks.github);
  assert.equal(extensionPanelIcon("package"), icons.package);
  assert.equal(extensionPanelIcon(undefined), icons.package);
  assert.equal(extensionPanelIcon("unicorn"), icons.package);
});
