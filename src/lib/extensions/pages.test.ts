/** Only a loaded extension's page becomes a sidebar link. */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionStatus } from "../../api/schema/extensions.ts";
import { extensionPageLinks } from "./pages.ts";

const status = (id: string, state: ExtensionStatus["state"], page?: { title: string; icon?: "github" | "package" | "pull-request" }): ExtensionStatus => ({
  id, name: id, description: "", enabled: state === "loaded", state, mode: "in-process", restarts: 0, routes: [],
  ...(page ? { page: { title: page.title, entry: "page.html", ...(page.icon ? { icon: page.icon } : {}) } } : {}),
});

test("loaded page extensions become sidebar links; disabled, failed and panel-only ones do not", () => {
  assert.deepEqual(extensionPageLinks([
    status("contributions", "loaded", { title: "Contributions", icon: "github" }),
    status("disabled", "disabled", { title: "Hidden" }),
    status("failed", "failed", { title: "Broken" }),
    status("panel", "loaded"),
  ]), [{ id: "contributions", title: "Contributions", icon: "github" }]);
});
