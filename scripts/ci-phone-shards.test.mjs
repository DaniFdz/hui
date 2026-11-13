/** Guards complete Android CI slicing, cold software graphics, and scoped host evidence without booting a local emulator. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/mobile.yml", import.meta.url), "utf8");
const job = workflow.slice(workflow.indexOf("\n  android-e2e:"), workflow.indexOf("\n  ios-ipa:"));

test("Android uses every six-way slice once and keeps its existing failure deadline and catalogue selection", () => {
  const matrix = JSON.parse(job.match(/        shard: (\[[^\n]+\])/u)?.[1] ?? "null");
  assert.deepEqual(matrix, Array.from({ length: 6 }, (_, index) => `${index + 1}/6`));
  assert.match(job, /timeout-minutes: 45/u);
  assert.match(job, /fail-fast: false/u);
  assert.ok(job.includes('tags=$(node e2e/catalogue/phone.ts'));
  assert.ok(job.includes('npx e2e run --target android --shard "${{ matrix.shard }}" --tag "$tags"'));
  assert.doesNotMatch(job, /--exclude-tag|--grep|--max-failures|--retries|increaseTimeout/u);
});

test("every Android launch cold-boots software GLES without restoring or saving graphics snapshots", () => {
  const body = job.match(/          start_emulator\(\) \{\n([\s\S]*?)\n          \}/u)?.[1];
  assert.ok(body, "the real shared emulator launch function is present");
  assert.equal((job.match(/"\$ANDROID_HOME\/emulator\/emulator"/gu) ?? []).length, 1, "boot and existing recovery share one launch policy");
  assert.doesNotMatch(job, /uses: actions\/cache@|steps\.avd|default_boot|Save the AVD|Restore the AVD/u);
  const directory = mkdtempSync(join(tmpdir(), "hui-ci-emulator-argv-"));
  try {
    mkdirSync(join(directory, "emulator"));
    // This executable only records argv. It never starts an emulator or runs ADB on the shared host.
    writeFileSync(join(directory, "emulator", "emulator"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.ARGV_FILE, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const result = spawnSync("bash", ["-euc", `avd=HUI_Pixel_e2e\nstart_emulator() {\n${body}\n}\nstart_emulator\nwait "$emulator_pid"`], {
      encoding: "utf8",
      env: { ...process.env, ANDROID_HOME: directory, RUNNER_TEMP: directory, ARGV_FILE: join(directory, "argv.json") },
    });
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(join(directory, "argv.json"), "utf8"));
    assert.deepEqual(args, ["-avd", "HUI_Pixel_e2e", "-port", "5554", "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect", "-feature", "-Vulkan", "-no-snapshot", "-no-metrics"]);
    assert.match(readFileSync(join(directory, "emulator.pid"), "utf8"), /^\d+\n$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Android always retains bounded read-only host diagnostics before uploading evidence", () => {
  const match = job.match(/      - name: Record the emulator host state\n        if: \$\{\{ always\(\) \}\}\n        run: \|\n((?:          .*\n)+)/u);
  const diagnostics = match?.[1].replace(/^          /gmu, "");
  assert.ok(diagnostics);
  assert.equal(spawnSync("bash", ["-n"], { input: diagnostics }).status, 0);
  assert.ok(job.indexOf("- name: Record the emulator host state") < job.indexOf("uses: actions/upload-artifact@"));
  assert.ok(diagnostics.includes("free -m"));
  assert.ok(diagnostics.includes('df -h "$RUNNER_TEMP" "$HOME"'));
  assert.ok(diagnostics.includes('ps -p "$emulator_pid" -o pid=,ppid=,stat=,rss=,comm='));
  assert.ok(diagnostics.includes('ps --ppid "$emulator_pid" -o pid=,ppid=,stat=,rss=,comm='));
  const processReads = [...diagnostics.matchAll(/^\s*ps ([^\n]+)/gmu)].map(([, command]) => command);
  assert.equal(processReads.length, 2);
  for (const command of processReads) assert.match(command, /^(?:-p|--ppid) "\$emulator_pid" -o pid=,ppid=,stat=,rss=,comm= \|\| echo /u);
  assert.ok(diagnostics.includes("timeout 5 dmesg"));
  assert.ok(diagnostics.includes("out of memory|oom-kill|killed process"));
  assert.doesNotMatch(diagnostics, /\badb\b|\bkill\s|\bpgrep\b|\bsleep\b|ps\s+-?(?:aux|ef)\b|args=|cmd=/u);
  assert.ok(job.includes("${{ runner.temp }}/emulator-host.txt"));
  assert.ok(job.includes("${{ runner.temp }}/emulator.pid"));
});
