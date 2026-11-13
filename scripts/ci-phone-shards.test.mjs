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
  assert.ok(job.includes("echo 'hw.ramSize=4096'"), "guest RAM is unchanged");
  assert.ok(body.includes('read -r emulator_pid < <('));
  assert.ok(body.includes('wait "$child"'));
  const detachOutput = body.indexOf('exec >> "$RUNNER_TEMP/emulator-exits.log" 2>&1');
  assert.notEqual(detachOutput, -1, "the supervisor must not retain the boot step's output pipes");
  assert.ok(detachOutput < body.indexOf('wait "$child"'));
  assert.ok(job.includes('kill "$emulator_pid"'), "existing recovery still signals the actual child");
  for (const exitStatus of [0, 139]) {
    const directory = mkdtempSync(join(tmpdir(), "hui-ci-emulator-argv-"));
    const argvFile = join(directory, "argv.json");
    let timedOut = false;
    try {
      mkdirSync(join(directory, "emulator"));
      const fifo = join(directory, "release.fifo");
      assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
      // An owned fake child records its REAL PID/argv, then blocks on a FIFO until the main shell releases it.
      // Exit 139 is only a status fixture: no actual emulator, signal crash, core dump or ADB is involved.
      writeFileSync(join(directory, "emulator", "emulator"), `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.ARGV_FILE, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }));\nfs.readFileSync(process.env.RELEASE_FIFO);\nprocess.exit(Number(process.env.STUB_EXIT));\n`, { mode: 0o755 });
      const result = spawnSync("bash", ["-euc", `avd=HUI_Pixel_e2e\nstart_emulator() {\n${body}\n}\nstart_emulator\nsupervisor_pid=$!\nprintf '%s\\n' "$supervisor_pid" > "$RUNNER_TEMP/supervisor.pid"\nprintf 'returned\\n' > "$RUNNER_TEMP/main-returned"\nprintf 'release\\n' > "$RELEASE_FIFO"\nwait "$supervisor_pid"`], {
        encoding: "utf8", timeout: 5000,
        env: { ...process.env, ANDROID_HOME: directory, RUNNER_TEMP: directory, ARGV_FILE: argvFile, RELEASE_FIFO: fifo, STUB_EXIT: String(exitStatus) },
      });
      timedOut = result.error?.code === "ETIMEDOUT";
      assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
      assert.equal(readFileSync(join(directory, "main-returned"), "utf8"), "returned\n", "read must return before the fake child can exit");
      const child = JSON.parse(readFileSync(argvFile, "utf8"));
      assert.deepEqual(child.args, ["-avd", "HUI_Pixel_e2e", "-port", "5554", "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "software", "-feature", "-Vulkan", "-no-snapshot", "-no-metrics"]);
      assert.equal(Number(readFileSync(join(directory, "emulator.pid"), "utf8")), child.pid);
      assert.notEqual(Number(readFileSync(join(directory, "supervisor.pid"), "utf8")), child.pid);
      assert.match(readFileSync(join(directory, "emulator-exits.log"), "utf8"), new RegExp(`^pid=${child.pid} status=${exitStatus} exitedAt=\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z\\n$`, "u"));
    } finally {
      // Clean up only this fixture's child if a broken launch function deadlocked the test.
      if (timedOut) {
        try { const child = JSON.parse(readFileSync(argvFile, "utf8")); process.kill(child.pid, "SIGKILL"); } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
      }
      rmSync(directory, { recursive: true, force: true });
    }
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
  assert.ok(diagnostics.includes("/proc/self/cgroup"));
  assert.ok(diagnostics.includes("for metric in memory.events memory.peak"));
  assert.ok(diagnostics.includes('if [ -r "$path" ]; then'));
  assert.ok(diagnostics.includes('head -c 4096 "$path"'));
  assert.ok(diagnostics.includes("out of memory|oom-kill|killed process"));
  assert.doesNotMatch(diagnostics, /\badb\b|\bkill\s|\bpgrep\b|\bsleep\b|ps\s+-?(?:aux|ef)\b|args=|cmd=/u);
  assert.ok(job.includes("${{ runner.temp }}/emulator-host.txt"));
  assert.ok(job.includes("${{ runner.temp }}/emulator.pid"));
  assert.ok(job.includes("${{ runner.temp }}/emulator-exits.log"));
  const artifacts = job.slice(job.indexOf("uses: actions/upload-artifact@"));
  assert.doesNotMatch(artifacts, /coredump|emu-crash|\/core\b/u, "process memory is never an artifact");
});
