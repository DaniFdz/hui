/**
 * Keeps the phone shell's two halves speaking one protocol: the Connect page (TypeScript), the Android activity and its
 * plugin (Java), and the loop script (Node) each name the same plugin, the same methods and the same launch extras. A
 * rename on one side would otherwise pass every unit test and only fail on a device. It also holds the one security
 * rule the split makes easy to lose: the page and the app accept exactly the same gateway addresses.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const [native, plugin, gateway, launch, page, script, agents] = await Promise.all([
  read("mobile/connect/src/native.ts"),
  read("mobile/android/app/src/main/java/dev/hui/app/HuiGatewayPlugin.java"),
  read("mobile/android/app/src/main/java/dev/hui/app/Gateway.java"),
  read("mobile/android/app/src/main/java/dev/hui/app/GatewayAddress.java"),
  read("mobile/connect/src/gateway.ts"),
  read("scripts/mobile.mjs"),
  read("mobile/AGENTS.md"),
]);

test("the Connect page and the plugin agree on the plugin name and its methods", () => {
  const pluginName = /@CapacitorPlugin\(name = "([A-Za-z]+)"\)/u.exec(plugin)?.[1];
  assert.ok(pluginName, "HuiGatewayPlugin.java declares @CapacitorPlugin(name = …)");
  assert.ok(native.includes(`"${pluginName}"`), `native.ts calls the ${pluginName} plugin`);

  const methods = [...plugin.matchAll(/@PluginMethod\s+public void (\w+)\(/gu)].map(([, name]) => name);
  assert.ok(methods.length > 0, "HuiGatewayPlugin.java declares @PluginMethod methods");
  for (const method of methods) assert.ok(new RegExp(`\\b${method}\\s*\\(`, "u").test(native), `native.ts calls ${method}(), which the plugin declares`);
  const called = [...native.matchAll(/huiGateway\.(\w+)\(/gu)].map(([, name]) => name);
  assert.deepEqual(called.filter((name) => !methods.includes(name)), [], "native.ts calls no plugin method the plugin does not declare");
});

test("the launch extras the activity reads are the ones the loop script and the guide use", () => {
  const extras = [...gateway.matchAll(/static final String \w+ = "(\w+)";/gu)].map(([, name]) => name)
    .filter((name) => name !== "hui" && name !== "gatewayUrl");
  assert.deepEqual(extras.sort(), ["huiGatewayFailed", "huiGatewayUrl"]);
  // The loop script passes only the gateway; the failed marker is the app's own (it survives the restart it triggers).
  assert.ok(script.includes("huiGatewayUrl"), "scripts/mobile.mjs passes huiGatewayUrl");
  for (const extra of extras) assert.ok(agents.includes(extra), `mobile/AGENTS.md documents ${extra}`);
});

test("the page and the app read one shared list of gateway addresses", async () => {
  const [fixture, pageTest, javaTest] = await Promise.all([
    read("mobile/gateway-addresses.txt"),
    read("mobile/connect/src/gateway.test.ts"),
    read("mobile/android/app/src/test/java/dev/hui/app/GatewayAddressTest.java"),
  ]);
  const cases = fixture.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.ok(cases.length >= 8, "the fixture holds the accepted and refused addresses");
  for (const file of [pageTest, javaTest]) {
    assert.ok(file.includes("gateway-addresses.txt"), "each check reads the shared fixture rather than its own list");
  }
});

test("the plugin's connect refuses an address the app would refuse, and remembers the one it accepts", () => {
  assert.ok(plugin.includes("GatewayAddress.normalize(call.getString(\"url\"))"), "the plugin normalises with the app's own check");
  assert.ok(plugin.includes("Gateway.remember("), "an accepted address is remembered");
});
