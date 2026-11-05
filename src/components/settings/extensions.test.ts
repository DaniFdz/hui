import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { ROUTABLE_SETTINGS_PAGES } from "../../lib/navigation.ts";
import { SETTINGS_COPY, SETTINGS_PAGES } from "../../lib/settings/pages.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Settings lists Extensions under Agents & Tools and routes it", () => {
  const page = SETTINGS_PAGES.find((entry) => entry.id === "extensions");
  assert.deepEqual(page, { id: "extensions", label: "Extensions", group: "Agents & Tools", icon: "package" });
  assert.ok(ROUTABLE_SETTINGS_PAGES.includes("extensions"));
  assert.match(SETTINGS_COPY.intros.extensions ?? "", /gateway modules/u);
});

test("the page renders the extensions element and the element uses the gateway surface", () => {
  const settings = read("../../views/settings.ts");
  assert.match(settings, /import "\.\.\/components\/settings\/extensions\.ts";/u);
  assert.match(settings, /props\.page === "extensions"[\s\S]*hui-extensions-settings/u);
  const element = read("./extensions.ts");
  assert.match(element, /loadExtensions/u);
  assert.match(element, /setExtensionEnabled/u);
  assert.match(element, /renderSettingsToggle\(extensionToggleLabel/u);
  assert.match(element, /data-extension-state/u);
  assert.match(element, /data-extensions-empty/u);
  assert.match(element, /Prompt and tools/u);
  assert.match(element, /data-testid="extension-prompt"/u);
  assert.match(element, /data-testid="extension-tool"/u);
  assert.match(element, /role="alert"/u);
});
