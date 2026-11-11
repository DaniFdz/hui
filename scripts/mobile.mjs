/**
 * The phone app's local loop (`npm run mobile -- <command>`): the pinned toolchain from `nix develop .#android`, the
 * headless `HUI_Pixel` emulator, the Connect page and Capacitor sync, Gradle builds and unit tests, installing and
 * launching the debug app against a gateway (reached through `adb reverse`), and screenshots for PR evidence.
 * Commands: doctor, avd, emulator, stop, connect, build, test, dev [--gateway <url>] [--fresh] [--no-gateway],
 * screenshot [path]. `npm run mobile:build` is `connect` on its own. Contracts and the per-change loops live in
 * mobile/AGENTS.md; two workers can run at once with HUI_ANDROID_AVD, ANDROID_SERIAL and E2E_PHONE_PORT.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "help", ...args] = process.argv.slice(2);

// Every command that needs the SDK runs inside the pinned shell; outside it, run this script again there. Building the
// Connect page alone needs only Vite and the Capacitor CLI, so it works without the Android toolchain.
const needsAndroid = !["help", "connect"].includes(command);
if (needsAndroid && !process.env.ANDROID_HOME) {
  const nix = ["nix", "/run/current-system/sw/bin/nix", "/nix/var/nix/profiles/default/bin/nix"].find((candidate) =>
    spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
  if (!nix) fail("Neither ANDROID_HOME nor nix is available: install Nix, or an SDK as mobile/AGENTS.md says.");
  const run = spawnSync(nix, ["develop", `${root}#android`, "--command", "node", fileURLToPath(import.meta.url), command, ...args], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

const SDK = process.env.ANDROID_HOME;
const AVD = process.env.HUI_ANDROID_AVD ?? "HUI_Pixel";
const SERIAL = process.env.ANDROID_SERIAL ?? "emulator-5554";
// The gateway port the emulator reaches through `adb reverse`; two workers on one machine take different ports.
const PHONE_PORT = Number(process.env.E2E_PHONE_PORT ?? 47400);
const IMAGE = "system-images;android-36;google_apis;x86_64";
const PACKAGE = "dev.hui.app.debug";
const ACTIVITY = "dev.hui.app.MainActivity";
const NATIVE = join(root, "mobile/android");
const APK = join(NATIVE, "app/build/outputs/apk/debug/app-debug.apk");
const tool = (path) => join(SDK, path);
// Every adb call has a deadline: a device that went offline makes adb wait for it forever.
const adb = (...rest) => execFileSync(tool("platform-tools/adb"), ["-s", SERIAL, ...rest], { encoding: "utf8", timeout: 120_000 }).trim();
const gradle = (...tasks) => run(join(NATIVE, "gradlew"), ["-p", NATIVE, "--console=plain", ...tasks]);

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

function readdirFirst(directory) {
  return execFileSync("ls", [directory], { encoding: "utf8" }).split("\n").filter(Boolean)[0] ?? "latest";
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

async function startEmulator() {
  if (booted()) return console.log(`${SERIAL} is already booted.`);
  const config = join(homedir(), ".android/avd", `${AVD}.avd`, "config.ini");
  // An AVD made from an image this SDK no longer has would never boot; make it again from the pinned one.
  if (!existsSync(config) || !readFileSync(config, "utf8").includes(`image.sysdir.1=${IMAGE.replaceAll(";", "/")}/`)) createAvd();
  const logs = join(homedir(), ".cache/hui-mobile");
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `${AVD}.log`);
  const port = /^emulator-(\d+)$/u.exec(SERIAL)?.[1] ?? "5554";
  const child = spawn(tool("emulator/emulator"), ["-avd", AVD, "-port", port, "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"], {
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

/** The Connect page, then Capacitor's copy of it and of the native plugin list into the Android project. */
function connect() {
  run(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--config", join(root, "mobile/connect/vite.config.ts")], { cwd: root });
  run("npx", ["--no-install", "cap", "sync", "android"], { cwd: root });
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
  connect,
  build() {
    connect();
    gradle(":app:assembleDebug");
  },
  test: () => gradle(":app:testDebugUnitTest"),
  async dev() {
    const gateway = option("gateway") ?? `http://127.0.0.1:${PHONE_PORT}`;
    await startEmulator();
    commands.build();
    adb("install", "-r", APK);
    // The emulator reaches a gateway on this machine at the same loopback address.
    const url = new URL(gateway);
    if (["127.0.0.1", "localhost"].includes(url.hostname)) adb("reverse", `tcp:${url.port || 80}`, `tcp:${url.port || 80}`);
    if (args.includes("--fresh")) adb("shell", "pm", "clear", PACKAGE);
    // --no-gateway opens on Connect to HUI (with --fresh) or the remembered gateway, as a user's own launch does.
    const extra = args.includes("--no-gateway") ? [] : ["--es", "huiGatewayUrl", gateway];
    adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, ...extra);
    console.log(`Launched ${PACKAGE}${extra.length ? ` against ${gateway}` : ""}.`);
  },
  screenshot() {
    const path = resolve(args[0] ?? join(tmpdir(), `hui-mobile-${Date.now()}.png`));
    mkdirSync(dirname(path), { recursive: true });
    const png = execFileSync(tool("platform-tools/adb"), ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path, png);
    console.log(path);
  },
  /**
   * The iPhone loop's slow half, in one command: dispatch the Mobile workflow asking only for the unsigned IPA, wait for
   * that run, and put the file where SideStore can import it. Nothing here builds — an iOS archive needs Xcode — so the
   * waiting is the point: `gh workflow run` plus a poll beats remembering the run id, the artifact name and the folder,
   * and the dispatch spends no Linux minutes because the Android jobs are gated on this input.
   */
  async "ios-ipa"() {
    const flag = (name, fallback) => {
      const at = args.indexOf(`--${name}`);
      return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
    };
    const gh = process.env.GH ?? "gh";
    const call = (ghArgs) => execFileSync(gh, ghArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
    const ref = flag("ref", execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() || "HEAD");
    const out = resolve(flag("out", join(homedir(), "Downloads", "hui-ipa")));
    // An archive is 90 seconds of work behind a macOS queue, so it is only worth asking for when the shell itself moved:
    // the app loads the gateway's UI at runtime, and every web change reaches the phone through the gateway instead.
    const native = ["mobile/ios", "mobile/connect", "capacitor.config.ts", "package.json", "package-lock.json", "src/lib/native-shell.ts", "src/lib/native-shell-boot.ts"];
    const stamp = join(out, ".ipa-commit");
    const tip = execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();
    if (!args.includes("--force") && existsSync(stamp)) {
      const archived = readFileSync(stamp, "utf8").trim();
      const changed = spawnSync("git", ["diff", "--name-only", archived, tip, "--", ...native], { cwd: root, encoding: "utf8" });
      if (changed.status === 0 && changed.stdout.trim() === "") {
        console.log(`The IPA in ${out} is already this branch's shell (${archived.slice(0, 8)}); nothing under ${native.join(", ")} changed since.`);
        console.log("Pass --force to archive it again anyway.");
        return;
      }
    }
    const started = Date.now();
    console.log(`Dispatching the IPA build for ${ref}…`);
    call(["workflow", "run", "mobile.yml", "--ref", ref, "-f", "ios_ipa=true"]);
    // The run this dispatch created: the newest one for the branch that started after the call returned.
    let run;
    for (;;) {
      const [newest] = JSON.parse(call(["run", "list", "--workflow", "mobile.yml", "--branch", ref, "--limit", "1", "--json", "databaseId,status,conclusion,createdAt,url"]));
      if (newest && Date.parse(newest.createdAt) >= started - 60_000) { run = newest; break; }
      await new Promise((r) => setTimeout(r, 5_000));
      if (Date.now() - started > 120_000) throw new Error("no Mobile run appeared for this dispatch within two minutes");
    }
    console.log(`Run ${run.databaseId}: ${run.url}`);
    let state = run;
    for (;;) {
      if (state.status === "completed") break;
      await new Promise((r) => setTimeout(r, 15_000));
      const [nextest] = JSON.parse(call(["run", "list", "--workflow", "mobile.yml", "--branch", ref, "--limit", "1", "--json", "databaseId,status,conclusion,createdAt,url"]));
      if (nextest?.databaseId === run.databaseId) state = nextest;
    }
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    if (state.conclusion !== "success") throw new Error(`the IPA build ${state.conclusion} after ${minutes} min: ${run.url}`);
    mkdirSync(out, { recursive: true });
    call(["run", "download", String(run.databaseId), "-n", "ios-ipa", "-D", out]);
    // The artifact names its files after the version it archived, so the folder is read rather than assumed.
    const files = readdirSync(out).filter((name) => name.endsWith(".ipa") || name.endsWith(".ipa.sha256")).sort();
    console.log(`${minutes} min. ${out} holds:`);
    for (const name of files) console.log(`  ${name}`);
    writeFileSync(stamp, `${tip}\n`);
    const sums = files.find((name) => name.endsWith(".sha256"));
    if (sums) console.log(`  sha256 ${readFileSync(join(out, sums), "utf8").split(/\s+/u)[0]}`);
  },
  help() {
    console.log("npm run mobile -- doctor | avd | emulator | stop | connect | build | test | dev [--gateway <url>] [--fresh] [--no-gateway] | ios-ipa [--ref <branch>] [--out <dir>] | screenshot [path]");
  },
};

if (!commands[command]) fail(`Unknown command ${command}. ${commands.help() ?? ""}`);
await commands[command]();
