/**
 * Keeps the phone shell's halves speaking one protocol: the Connect page (TypeScript), the Android activity and its
 * plugin (Java), and the loop script (Node) each name the same plugin, the same methods and the same launch extras. On
 * iOS it reads the Share Extension's activation predicates and the link it builds, the SceneDelegate and `DeepLink` that
 * answer it, and the project and workflows that embed the appex, so no half can drift from the others. A rename on one
 * side would otherwise pass every unit test and only fail on a device. It also holds the one security rule the split
 * makes easy to lose: the page and the app accept exactly the same gateway addresses.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
  const pluginName = /@CapacitorPlugin\(name = "([A-Za-z]+)"/u.exec(plugin)?.[1];
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
  const javaName = /@CapacitorPlugin\(name = "(\w+)"/u.exec(plugin)?.[1];
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

test("the Android local-network permission arrives with the SDK 37 target", async () => {
  // Android 16 and lower grant local-network access through INTERNET, and Android's own guidance says not to declare
  // ACCESS_LOCAL_NETWORK below targetSdk 37 because the platform ignores it there. Android 17 blocks the local network
  // by default for target 37, so the bump must bring the manifest permission and a runtime request before the Connect
  // page probes, or a LAN gateway silently stops answering.
  const gradle = await read("mobile/android/variables.gradle");
  const target = Number(/targetSdkVersion\s*=\s*(\d+)/u.exec(gradle)?.[1]);
  assert.ok(Number.isInteger(target), "variables.gradle declares targetSdkVersion");
  const manifest = await read("mobile/android/app/src/main/AndroidManifest.xml");
  const appDir = "mobile/android/app/src/main/java/dev/hui/app";
  const sources = await Promise.all(
    (await readdir(join(root, appDir), { recursive: true }))
      .filter((path) => path.endsWith(".java"))
      .map((path) => readFile(join(root, appDir, path), "utf8")),
  );
  const permission = "android.permission.ACCESS_LOCAL_NETWORK";
  if (target < 37) {
    assert.ok(!manifest.includes(permission), "the manifest declares the local-network permission only at targetSdk 37");
    assert.ok(!sources.some((source) => source.includes("ACCESS_LOCAL_NETWORK") && /(?:requestPermissions|requestPermissionForAlias)\s*\(/u.test(source)), "the app requests the local-network permission only at targetSdk 37");
    return;
  }
  assert.match(manifest, /<uses-permission\s+android:name="android\.permission\.ACCESS_LOCAL_NETWORK"\s*\/>/u, "targetSdk 37 declares ACCESS_LOCAL_NETWORK");
  const requester = sources.find((source) => source.includes("ACCESS_LOCAL_NETWORK") && /(?:requestPermissions|requestPermissionForAlias)\s*\(/u.test(source));
  assert.ok(requester, "targetSdk 37 requests ACCESS_LOCAL_NETWORK at runtime, before the first gateway request");
  assert.match(requester, /Build\.VERSION\.SDK_INT\s*(?:>=|<)\s*(?:37|Build\.VERSION_CODES\.[A-Z_]+)/u, "the request runs only where API 37 exists");
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

test("the Android Share sheet offers HUI for text and images, and nothing else", async () => {
  // Three halves have to agree for a share to reach New Session: the sheet has to offer HUI for it, the activity has to
  // read it and open the page's own route, and the page has to take the route's query. The page's half is pinned by its
  // own tests; these are the shell's two.
  const manifest = await read("mobile/android/app/src/main/AndroidManifest.xml");
  const activity = /<activity\b[\s\S]*?<\/activity>/u.exec(manifest)?.[0];
  assert.ok(activity, "MainActivity is the manifest's activity");
  const filters = [...activity.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/gu)].map(([, filter]) => filter);
  const send = filters.filter((filter) => filter.includes("android.intent.action.SEND"));
  assert.equal(send.length, 1, "the activity declares exactly one ACTION_SEND filter");
  assert.match(send[0], /android\.intent\.category\.DEFAULT/u, "the sheet needs CATEGORY_DEFAULT to list the filter");
  const types = [...send[0].matchAll(/android:mimeType="([^"]+)"/gu)].map(([, type]) => type);
  assert.deepEqual(types, ["text/plain", "image/*"], "the sheet offers exactly the text and the image New Session can take");
  assert.doesNotMatch(send[0], /text\/\*/u, "no wildcard text: a markup or contact-card share is never offered");
});

test("the activity opens a share once and takes it back out of the launch intent", async () => {
  const activity = await read("mobile/android/app/src/main/java/dev/hui/app/MainActivity.java");
  assert.match(activity, /Intent\.ACTION_SEND\.equals\(/u, "the activity answers ACTION_SEND, not every intent it is handed");
  assert.match(activity, /getCharSequenceExtra\(Intent\.EXTRA_TEXT\)/u, "the text is read as a CharSequence: X sends a SpannedString");
  // Every restart the activity asks for applies the launch intent again, so a share left in it opens New Session twice.
  assert.match(activity, /setAction\(null\)/u, "the share's action is dropped with it");
  for (const extra of ["EXTRA_TEXT", "EXTRA_STREAM", "EXTRA_TITLE"]) {
    assert.match(activity, new RegExp(`removeExtra\\(Intent\\.${extra}\\)`, "u"), `the share's ${extra} is dropped with it`);
  }
  assert.match(activity, /setClipData\(null\)/u, "the share's clip data is dropped with it");
  assert.match(activity, /ShareTarget\.url\(gateway,/u, "the address is built from the gateway this launch loaded");
  assert.match(activity, /web\.loadUrl\(address\)/u, "the page's own New Session route opens in the WebView");
});

test("the Android share is the page's own address, within the page's own bounds", async () => {
  const share = await read("mobile/android/app/src/main/java/dev/hui/app/ShareTarget.java");
  const page = await read("src/lib/composer/share-seed.ts");
  const pages = await read("src/lib/pages.ts");
  assert.match(share, /"\/new-session\?share="/u, "ShareTarget builds the route the page's intake reads");
  assert.match(pages, /\[\s*"new-session",/u, "and the page does route /new-session");
  assert.match(share, /URLEncoder\.encode\(/u, "the value is percent-encoded exactly once");
  // The two bounds are the page's and the iOS half's, so one share cannot be cut differently on each phone.
  assert.match(share, /MAX_CHARACTERS = 8_000;/u, "the text is capped at the page's 8 000 characters");
  assert.match(page, /SHARE_SEED_LIMIT = 8000/u, "the page caps the same value at the same 8 000 characters");
  // The address bound is the gateway's: Node's createServer refuses a request head past its default 16 KiB, and the
  // request line counts against it, so a share may not spend the whole budget on its own value.
  assert.match(share, /MAX_URL_BYTES = 12 \* 1024;/u, "the finished address stays inside the gateway's 16 KiB request head, at 12 KiB");
  assert.doesNotMatch(share, /^import android\./mu, "the parser stays pure Java, so the host JVM can run ShareTargetTest");
});

test("the iOS project embeds a Share Extension that inherits the app's version", async () => {
  const project = await read("mobile/ios/App/App.xcodeproj/project.pbxproj");
  assert.equal([...project.matchAll(/isa = PBXNativeTarget;/gu)].length, 2, "the project has the app and one extension");
  assert.match(project, /isa = PBXNativeTarget;[\s\S]*?productType = "com\.apple\.product-type\.app-extension";/u, "the second target is an app extension");
  assert.match(project, /name = ShareExtension;/u, "the extension is the one the workflow and the release look for");
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = dev\.hui\.app\.ShareExtension;/u, "the appex lives under the app's own bundle id");
  // dstSubfolderSpec 13 is the PlugIns folder: an appex built but never embedded is missing from the archive and the IPA.
  const embed = /([0-9A-F]{24}) \/\* Embed Foundation Extensions \*\/ = \{[\s\S]*?dstSubfolderSpec = 13;[\s\S]*?\n\t\t\};/u.exec(project);
  assert.ok(embed, "a copy phase embeds the appex into PlugIns");
  const app = /^\t\t([0-9A-F]{24}) \/\* App \*\/ = \{\n\t\t\tisa = PBXNativeTarget;[\s\S]*?productType = "com\.apple\.product-type\.application";/mu.exec(project);
  assert.ok(app, "the App target exists");
  assert.ok(app[0].includes(`${embed[1]} /* Embed Foundation Extensions */`), "the App target runs that phase");
  // Both versions sit on the project, so the appex inherits the one the release stamps; a target-level value would win.
  const configurations = [...project.matchAll(/\t\tisa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/gu)].map(([block]) => block);
  const versioned = configurations.filter((block) => /(?:MARKETING_VERSION|CURRENT_PROJECT_VERSION) =/u.test(block));
  assert.equal(versioned.length, 2, "only the project's Debug and Release configurations carry the versions");
  for (const block of versioned) {
    assert.doesNotMatch(block, /PRODUCT_BUNDLE_IDENTIFIER/u, "a target configuration would override the stamped version");
  }
});

test("the iOS Share Extension activates for text and web addresses only", async () => {
  const plist = await read("mobile/ios/App/ShareExtension/Info.plist");
  assert.match(plist, /<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.share-services<\/string>/u, "the extension is a share extension");
  assert.match(plist, /<key>NSExtensionActivationSupportsText<\/key>\s*<true\/>/u, "it offers itself for text");
  assert.match(plist, /<key>NSExtensionActivationSupportsWebURLWithMaxCount<\/key>\s*<integer>1<\/integer>/u, "and for one web address");
  for (const key of ["Image", "Movie", "File", "Attachments"]) {
    assert.ok(!plist.includes(`NSExtensionActivationSupports${key}WithMaxCount`), `it does not offer itself for a ${key.toLowerCase()}: New Session takes words`);
  }
});

test("the iOS app opens a share on the gateway it remembers, as the Android one does", async () => {
  const scene = await read("mobile/ios/App/App/SceneDelegate.swift");
  assert.match(scene, /case "share":/u, "the SceneDelegate answers the extension's hui://share link");
  assert.match(scene, /DeepLink\.share\(url:/u, "the value goes through the parser that bounds it");
  assert.match(swiftDeepLink, /static func share\(url: String\?, gateway: String\) -> URL\?/u, "DeepLink.share builds the address");
  assert.match(swiftDeepLink, /"\/new-session"/u, "the same route the Android half builds");
  assert.match(swiftDeepLink, /maxShareCharacters = 8_000/u, "the same 8 000-character cap as the Android half");
  assert.match(swiftDeepLink, /maxShareQueryBytes = 12 \* 1024/u, "the same 12 KiB query bound as the Android half");
});

test("the extension's link opens the scheme the app registers, under the host and query the app reads", async () => {
  // The link crosses two processes with no compiler between them: the extension builds a string the app parses, and a
  // rename on either side would still pass every unit test. The app's own registration is the third half — an unregistered
  // scheme leaves the system with nothing to open, and neither half shows it in a log.
  const plist = await read("mobile/ios/App/App/Info.plist");
  const extension = await read("mobile/ios/App/ShareExtension/ShareViewController.swift");
  const scene = await read("mobile/ios/App/App/SceneDelegate.swift");
  const schemes = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(plist)?.[1] ?? "";
  assert.match(schemes, /<string>hui<\/string>/u, "the app registers the scheme the extension opens");
  assert.match(extension, /URLComponents\(string: "hui:\/\/share"\)/u, "the extension builds the share link");
  assert.match(extension, /URLQueryItem\(name: "url", value:/u, "under the query name it has to agree on");
  assert.match(scene, /case "share":/u, "and the app answers that host");
  assert.match(scene, /query\("url"\)/u, "reading the same query");
});

test("both workflows refuse a build whose Share Extension is missing from the app", async () => {
  const ios = await read(".github/workflows/ios.yml");
  assert.match(ios, /Check the Share Extension is embedded/u, "ios-smoke reads the built bundle, not only the project file");
  assert.match(ios, /test -d "\$app\/PlugIns"/u, "the app must have embedded something");
  assert.match(ios, /com\.apple\.share-services/u, "and the point identifier has to be the one the sheet lists");
  const release = await read(".github/workflows/release.yml");
  const appex = 'appex="$app/PlugIns/ShareExtension.appex"';
  assert.ok(release.includes(appex), "the release reads the appex out of the archive's app");
  // The check has to run before the Payload is zipped: an IPA built from an app without the appex cannot be repaired.
  assert.ok(release.indexOf(appex) < release.indexOf('mkdir -p "$RUNNER_TEMP/Payload"'), "the appex is checked before the IPA is built");
  assert.match(release, /grep -q "Payload\/App\.app\/PlugIns\/ShareExtension\.appex\/"/u, "and the IPA's own listing has to carry it");
});
