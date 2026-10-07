import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bootFailureMessage } from "./boot-screen.ts";

test("a chunk that did not download reads as a connection problem", () => {
  assert.equal(bootFailureMessage(new TypeError("Failed to fetch dynamically imported module: https://hui/assets/hui-app.js")), "HUI could not load over this connection.");
  assert.equal(bootFailureMessage(new TypeError("error loading dynamically imported module")), "HUI could not load over this connection.");
  assert.equal(bootFailureMessage(new TypeError("Importing a module script failed.")), "HUI could not load over this connection.");
  assert.equal(bootFailureMessage(new Error("x is not a function")), "HUI could not start.");
});

test("the page paints the boot screen before any script, and the app replaces it", () => {
  const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const boot = page.indexOf('id="hui-boot"');
  assert(boot > 0 && boot < page.indexOf("<hui-app>"), "the boot screen is markup ahead of the app");
  assert.match(page, /<style>[\s\S]*#hui-boot[\s\S]*<\/style>/u, "its styles are inline");
  assert.match(page, /class="hui-boot__slow">[^<]*<a href="">Reload<\/a>/u, "a reload stays possible without script");
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.match(main, /Promise\.all\(\[import\("\.\/hui-app\.ts"\), resolveAppearance\(\)\]\)/u, "the app's code downloads while the appearance resolves");
});
