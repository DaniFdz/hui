/**
 * The Android app's local loop (`npm run android -- <command>`): the pinned toolchain from `nix develop .#android`,
 * the headless `HUI_Pixel` emulator, Gradle builds and unit tests, installing and launching the debug app against a
 * gateway (reached through `adb reverse`), and screenshots for PR evidence. `android/AGENTS.md` describes each loop.
 * Commands: doctor, avd, emulator, stop, build, test, dev [--gateway <url>] [--fresh] [--no-gateway], screenshot <path>.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "help", ...args] = process.argv.slice(2);

// Every command runs inside the pinned SDK shell; outside it, run this script again there.
if (!process.env.ANDROID_HOME && command !== "help") {
  const nix = ["nix", "/run/current-system/sw/bin/nix", "/nix/var/nix/profiles/default/bin/nix"].find((candidate) =>
    spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
  if (!nix) fail("Neither ANDROID_HOME nor nix is available: install Nix, or an SDK as android/AGENTS.md says.");
  const run = spawnSync(nix, ["develop", `${root}#android`, "--command", "node", fileURLToPath(import.meta.url), command, ...args], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

const SDK = process.env.ANDROID_HOME;
const AVD = process.env.HUI_ANDROID_AVD ?? "HUI_Pixel";
const IMAGE = "system-images;android-36;google_apis;x86_64";
const PACKAGE = "dev.hui.android.debug";
const APK = join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
const SERIAL = process.env.ANDROID_SERIAL ?? "emulator-5554";
const tool = (path) => join(SDK, path);
// Every adb call has a deadline: a device that went offline makes adb wait for it forever.
const adb = (...rest) => execFileSync(tool("platform-tools/adb"), ["-s", SERIAL, ...rest], { encoding: "utf8", timeout: 120_000 }).trim();
const gradle = (...tasks) => run(join(root, "android/gradlew"), ["-p", join(root, "android"), "--console=plain", ...tasks]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(executable, argv, options = {}) {
  const result = spawnSync(executable, argv, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`${executable} ${argv.join(" ")} exited with ${result.status}`);
}

function booted() {
  try {
    return execFileSync(tool("platform-tools/adb"), ["-s", SERIAL, "shell", "getprop", "sys.boot_completed"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() === "1";
  } catch {
    return false;
  }
}

function createAvd() {
  const avdmanager = tool("cmdline-tools/latest/bin/avdmanager");
  const fallback = join(SDK, "cmdline-tools", readdirFirst(join(SDK, "cmdline-tools")), "bin/avdmanager");
  run(existsSync(avdmanager) ? avdmanager : fallback, ["create", "avd", "--force", "-n", AVD, "-k", IMAGE], { input: "no\n", stdio: ["pipe", "inherit", "inherit"] });
  // A Pixel 7's screen and density, and a hardware keyboard so typed text never waits on the soft one.
  const config = join(homedir(), ".android/avd", `${AVD}.avd`, "config.ini");
  const lines = readFileSync(config, "utf8").split("\n").filter((line) => !/^(hw\.lcd\.(width|height|density)|hw\.keyboard|hw\.ramSize)=/u.test(line));
  writeFileSync(config, [...lines, "hw.lcd.width=1080", "hw.lcd.height=2400", "hw.lcd.density=420", "hw.keyboard=yes", "hw.ramSize=4096", ""].join("\n"));
  console.log(`Created ${AVD} from ${IMAGE}.`);
}

function readdirFirst(directory) {
  return execFileSync("ls", [directory], { encoding: "utf8" }).split("\n").filter(Boolean)[0] ?? "latest";
}

async function startEmulator() {
  if (booted()) return console.log(`${SERIAL} is already booted.`);
  const config = join(homedir(), ".android/avd", `${AVD}.avd`, "config.ini");
  // An AVD made from an image this SDK no longer has would never boot; make it again from the pinned one.
  if (!existsSync(config) || !readFileSync(config, "utf8").includes(`image.sysdir.1=${IMAGE.replaceAll(";", "/")}/`)) createAvd();
  const logs = join(homedir(), ".cache/hui-android");
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `${AVD}.log`);
  const child = spawn(tool("emulator/emulator"), ["-avd", AVD, "-port", SERIAL.split("-")[1], "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"], {
    detached: true,
    stdio: ["ignore", openSync(log, "a"), openSync(log, "a")],
  });
  child.unref();
  const started = Date.now();
  while (!booted()) {
    if (child.exitCode !== null) fail(`The emulator exited with ${child.exitCode}; see ${log}`);
    if (Date.now() - started > 180_000) fail(`${AVD} did not finish booting in 3 minutes; see ${log}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  // Animations off, so a screenshot or a test step never catches a transition.
  for (const scale of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) adb("shell", "settings", "put", "global", scale, "0");
  console.log(`${AVD} booted in ${Math.round((Date.now() - started) / 1000)} s (log: ${log}).`);
}

function option(name) {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

const commands = {
  doctor() {
    const checks = [
      ["ANDROID_HOME", existsSync(SDK)],
      ["adb", existsSync(tool("platform-tools/adb"))],
      ["emulator", existsSync(tool("emulator/emulator"))],
      ["system image", existsSync(join(SDK, ...IMAGE.split(";")))],
      ["/dev/kvm", existsSync("/dev/kvm")],
      ["JAVA_HOME", Boolean(process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME))],
      [`AVD ${AVD}`, existsSync(join(homedir(), ".android/avd", `${AVD}.avd`))],
      [`${SERIAL} booted`, booted()],
    ];
    for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "MISS"} ${name}`);
    if (checks.slice(0, 6).some(([, ok]) => !ok)) process.exit(1);
  },
  avd: createAvd,
  emulator: startEmulator,
  stop() {
    if (booted()) adb("emu", "kill");
    console.log(`${SERIAL} stopped.`);
  },
  build: () => gradle(":app:assembleDebug"),
  test: () => gradle(":app:testDebugUnitTest"),
  async dev() {
    const gateway = option("gateway") ?? "http://127.0.0.1:47400";
    await startEmulator();
    gradle(":app:assembleDebug");
    adb("install", "-r", APK);
    // The emulator reaches a gateway on this machine at the same loopback address.
    const url = new URL(gateway);
    if (["127.0.0.1", "localhost"].includes(url.hostname)) adb("reverse", `tcp:${url.port || 80}`, `tcp:${url.port || 80}`);
    if (args.includes("--fresh")) adb("shell", "pm", "clear", PACKAGE);
    // --no-gateway opens on Connect to HUI (with --fresh) or the remembered gateway, as a user's own launch does.
    const extra = args.includes("--no-gateway") ? [] : ["--es", "huiGatewayUrl", gateway];
    adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/dev.hui.android.MainActivity`, ...extra);
    console.log(`Launched ${PACKAGE}${extra.length ? ` against ${gateway}` : ""}.`);
  },
  screenshot() {
    const path = resolve(args[0] ?? join(tmpdir(), `hui-android-${Date.now()}.png`));
    mkdirSync(dirname(path), { recursive: true });
    const png = execFileSync(tool("platform-tools/adb"), ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path, png);
    console.log(path);
  },
  help() {
    console.log("npm run android -- doctor | avd | emulator | stop | build | test | dev [--gateway <url>] [--fresh] [--no-gateway] | screenshot [path]");
  },
};

if (!commands[command]) fail(`Unknown command ${command}. ${commands.help() ?? ""}`);
await commands[command]();
