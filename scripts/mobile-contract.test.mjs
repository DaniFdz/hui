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
const [native, plugin, gateway, launch, page, script, agents, swiftPlugin, swiftGateway, swiftBridge, javaActivity, swiftDeepLink] = await Promise.all([
  read("mobile/connect/src/native.ts"),
  read("mobile/android/app/src/main/java/dev/hui/app/HuiGatewayPlugin.java"),
  read("mobile/android/app/src/main/java/dev/hui/app/Gateway.java"),
  read("mobile/android/app/src/main/java/dev/hui/app/GatewayAddress.java"),
  read("mobile/connect/src/gateway.ts"),
  read("scripts/mobile.mjs"),
  read("mobile/AGENTS.md"),
  read("mobile/ios/App/App/Shell/HuiGatewayPlugin.swift"),
  read("mobile/ios/App/App/Shell/Gateway.swift"),
  read("mobile/ios/App/App/Shell/HUIBridgeViewController.swift"),
  read("mobile/android/app/src/main/java/dev/hui/app/MainActivity.java"),
  read("mobile/ios/App/App/Shell/DeepLink.swift"),
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

test("the iOS shell speaks the same protocol as the Android one, and registers its plugin", () => {
  const swiftMethods = [...swiftPlugin.matchAll(/CAPPluginMethod\(name: "(\w+)"/gu)].map(([, name]) => name).sort();
  const javaMethods = [...plugin.matchAll(/@PluginMethod\s+public void (\w+)\(/gu)].map(([, name]) => name).sort();
  assert.deepEqual(swiftMethods, javaMethods, "the Swift plugin declares the methods the Java plugin declares");
  const javaName = /@CapacitorPlugin\(name = "(\w+)"\)/u.exec(plugin)?.[1];
  assert.ok(swiftPlugin.includes(`jsName = "${javaName}"`), "both plugins answer to the name the Connect page calls");
  // Capacitor discovers neither plugin by itself: an unregistered plugin rejects every call, which no screenshot shows.
  assert.ok(/registerPluginInstance\(HuiGatewayPlugin\(\)\)/u.test(swiftBridge), "the iOS bridge registers its plugin");
  assert.ok(/registerPlugin\(HuiGatewayPlugin\.class\)/u.test(javaActivity), "the Android activity registers its plugin");
  // The one-launch keys, asserted on their assignments so a doc comment cannot satisfy them.
  for (const key of ["HUIGatewayURL", "HUIGatewayFailed"]) {
    assert.ok(new RegExp(`=\\s*"${key}"`, "u").test(swiftGateway), `the Swift shell assigns ${key}, as the Android one does`);
  }
  assert.ok(/path\.hasPrefix\("\/"\)/u.test(swiftDeepLink) && /contains\(":\/\/"\)/u.test(swiftDeepLink), "the iOS deep link refuses anything but a plain path, as the Android one does");
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

test("both apps open the composer's camera and photos, and iOS explains both", async () => {
  // The composer's "Take photo" is an image input with `capture`: Android hands it to the camera app through the
  // intents its <queries> names, and WebKit on iOS opens a UIImagePickerController camera in the app's own process.
  // The "Photo" input opens WebKit's picker instead. iOS terminates an app that reaches either the camera or the
  // photo library without a usage string, so the plist entries are the crash fix, not a nicety. The simulator has no
  // camera, which is why the contract keeps this rather than a tapped journey.
  const manifest = await read("mobile/android/app/src/main/AndroidManifest.xml");
  const plist = await read("mobile/ios/App/App/Info.plist");
  const composer = await read("src/views/home.ts");
  assert.match(composer, /accept="image\/\*" capture="environment"/u, "the composer's Take photo input asks for a camera");
  assert.match(composer, /agent-chat__photo-input/u, "the composer's Photo input opens the photo picker");
  for (const action of ["IMAGE_CAPTURE", "VIDEO_CAPTURE"]) {
    assert.match(manifest, new RegExp(`android\\.media\\.action\\.${action}`), `the Android shell can resolve ${action}`);
  }
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/u, "the iOS shell explains why it wants the camera");
  assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/u, "the iOS shell explains why it wants the photo library");
});

test("both apps accept a gateway on the local network, and iOS explains the prompt", async () => {
  // The Connect page accepts an https address on the LAN as readily as a tailnet one, and iOS 14+ asks before an app
  // reaches a host on the same network. Without the string the app has no sentence for that prompt, and access can be
  // refused; the shared fixture is what both address checks read, so the LAN case cannot drift away from them.
  const plist = await read("mobile/ios/App/App/Info.plist");
  const addresses = await read("mobile/gateway-addresses.txt");
  assert.match(addresses, /^https:\/\/192\.168\.\d+\.\d+:\d+ -> https:\/\/192\.168\.\d+\.\d+:\d+$/mu, "the shared addresses include a LAN gateway");
  assert.match(plist, /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/u, "the iOS shell explains why it wants the local network");
});

test("both apps declare the microphone a call needs, and iOS explains it", async () => {
  // A call is the one capability the page cannot grant itself: the WebView asks, the app answers. Capacitor's chrome
  // client requests RECORD_AUDIO and its iOS delegate grants the capture, so an undeclared permission is a refusal
  // nobody can answer — and on iOS an app that reaches the microphone without a usage string is terminated.
  const manifest = await read("mobile/android/app/src/main/AndroidManifest.xml");
  const plist = await read("mobile/ios/App/App/Info.plist");
  for (const permission of ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
    assert.match(manifest, new RegExp(`<uses-permission android:name="android\\.permission\\.${permission}"`), `the Android shell declares ${permission}`);
  }
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/u, "the iOS shell explains why it wants the microphone");
});
