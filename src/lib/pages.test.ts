import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HUI_PAGES } from "./pages.ts";
import { isObservabilitySurface } from "../views/observability.ts";
import { isOwnedSurface } from "../views/hui-owned-surfaces.ts";
import { isPiSurface } from "../views/pi-surfaces.ts";

/** Pages rendered by a dedicated branch in hui-app.ts rather than a surface family. */
const DEDICATED = ["new-session", "cron", "tasks", "sessions", "worktrees"];

test("every routed page has a real renderer and no placeholder shell remains", () => {
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  for (const id of DEDICATED) assert.match(app, new RegExp(`this\\.activePage\\.id === "${id}"`, "u"), id);
  for (const page of HUI_PAGES) {
    const families = [DEDICATED.includes(page.id), isPiSurface(page), isObservabilitySurface(page), isOwnedSurface(page)];
    assert.equal(families.filter(Boolean).length, 1, `${page.id} must have exactly one renderer`);
  }
  assert.doesNotMatch(app, /renderOpenClawSurface|renderCapabilitiesPage/u);
});
