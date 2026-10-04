import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { piCommand } from "./pi-command.ts";
import { PI_SDK_VERSION } from "./pi-backend.ts";

test("PI CLI uses the packaged version without relying on PATH, with an explicit rollback override", async () => {
  const cli = piCommand(["--version"], "");
  assert.equal(cli.command, process.execPath);
  assert.equal((await promisify(execFile)(cli.command, cli.args)).stdout.trim(), PI_SDK_VERSION);
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(manifest.dependencies["@earendil-works/pi-coding-agent"], PI_SDK_VERSION, "the reported SDK version must be the pinned one");
  assert.deepEqual(piCommand(["--version"], "/explicit/pi"), { command: "/explicit/pi", args: ["--version"] });
});
