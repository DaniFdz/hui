import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { piCommand } from "./pi-command.ts";

test("PI CLI uses the packaged version without relying on PATH, with an explicit rollback override", async () => {
  const cli = piCommand(["--version"], "");
  assert.equal(cli.command, process.execPath);
  assert.match((await promisify(execFile)(cli.command, cli.args)).stdout, /0\.87\.1/u);
  assert.deepEqual(piCommand(["--version"], "/explicit/pi"), { command: "/explicit/pi", args: ["--version"] });
});
