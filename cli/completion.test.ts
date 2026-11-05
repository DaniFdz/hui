import assert from "node:assert/strict";
import { test } from "vitest";
import { BOT_FACE_COLORS, BOT_FACE_SHAPES, BOT_THINKING_LEVELS } from "../server/bots-format.ts";
import { COMMAND_ALIASES, COMMAND_FLAGS } from "./commands.ts";
import { completionCandidates, completionScript, completionShell } from "./completion.ts";
import { HELP } from "./main.ts";

const sorted = (words: readonly string[]) => [...words].sort();

test("completion offers every command and its aliases at the start of a line", () => {
  const first = completionCandidates([""]);
  for (const key of Object.keys(COMMAND_FLAGS)) assert.ok(first.includes(key.split(" ")[0]!), `offers ${key.split(" ")[0]}`);
  for (const alias of Object.keys(COMMAND_ALIASES)) assert.ok(first.includes(alias), `offers the alias ${alias}`);
  assert.deepEqual(first, sorted(first), "candidates are ordered");
  assert.equal(new Set(first).size, first.length, "candidates are listed once");
  assert.deepEqual(completionCandidates(["g"]), ["gateway"]);
});

test("completion offers the subcommands of the words typed so far", () => {
  assert.deepEqual(completionCandidates(["gateway", "st"]), ["start", "status", "stop"]);
  assert.ok(completionCandidates(["gateway", ""]).includes("logs"));
  assert.deepEqual(completionCandidates(["bot", "routine", ""]), ["add", "list", "remove", "run"]);
  assert.ok(completionCandidates(["bot", "trigger", ""]).includes("test"));
  assert.ok(completionCandidates(["bots", ""]).includes("list"), "the alias completes like the command it names");
  assert.deepEqual(completionCandidates(["schedule", "pa"]), ["pause"]);
  assert.deepEqual(completionCandidates(["bot", "export", ""]), [], "a command taking a bot, not a subcommand, leaves file names to the shell");
  assert.deepEqual(completionCandidates(["typo", ""]), [], "an unknown command offers nothing");
});

test("completion offers the flags of the command that applies, and only those", () => {
  const start = completionCandidates(["gateway", "start", "--"]);
  assert.deepEqual(start, ["--allow-host", "--host", "--json", "--port"]);
  assert.ok(!start.includes("--force"));
  assert.deepEqual(completionCandidates(["gateway", "stop", "--"]), ["--force", "--json"]);
  // `hui gateway` runs the gateway, as `hui workers` lists and `hui bot` lists.
  assert.ok(completionCandidates(["gateway", "--"]).includes("--port"));
  assert.deepEqual(completionCandidates(["workers", "--"]), ["--json"]);
  assert.deepEqual(completionCandidates(["bot", "--"]), ["--archived", "--json"]);
  assert.deepEqual(completionCandidates(["typo", "--"]), []);
  assert.deepEqual(completionCandidates(["doctor", "--f"]), ["--fix"]);
});

test("completion offers the values of the flags whose list the CLI validates", () => {
  assert.deepEqual(completionCandidates(["bot", "edit", "bob", "--shape", ""]), sorted(BOT_FACE_SHAPES));
  assert.deepEqual(completionCandidates(["bot", "edit", "bob", "--shape", "ro"]), ["round"]);
  assert.deepEqual(completionCandidates(["bot", "edit", "bob", "--thinking", ""]), sorted(BOT_THINKING_LEVELS));
  assert.deepEqual(completionCandidates(["bot", "edit", "bob", "--color", ""]), sorted(BOT_FACE_COLORS.map((color) => color.id)));
  assert.deepEqual(completionCandidates(["bot", "edit", "bob", "--model", ""]), [], "a free-form value leaves the shell to it");
});

test("completion offers the shell `hui completion` prints a program for", () => {
  assert.deepEqual(completionCandidates(["completion", ""]), ["bash", "zsh"]);
  assert.deepEqual(completionCandidates(["completion", "z"]), ["zsh"]);
  assert.equal(completionShell("zsh"), "zsh");
  for (const value of [undefined, "", "fish", "bash "]) assert.throws(() => completionShell(value), /one shell: bash or zsh/u);
});

test("every command and flag in the table is one a shell can offer", () => {
  for (const [command, flags] of Object.entries(COMMAND_FLAGS)) {
    const words = command.split(" ");
    assert.ok(completionCandidates([...words.slice(0, -1), ""]).includes(words.at(-1)!), `offers the last word of ${command}`);
    const offered = completionCandidates([...words, "--"]);
    for (const flag of flags) assert.ok(offered.includes(`--${flag}`), `offers --${flag} of ${command}`);
    assert.equal(offered.length, flags.length, `${command} offers nothing but its flags`);
  }
});

test("the printed programs ask the CLI instead of listing its words themselves", async () => {
  const bash = await completionScript("bash");
  assert.match(bash, /command hui __complete/u);
  assert.match(bash, /complete -o default -F _hui_completions hui/u, "bash keeps file names for --from and --out");
  const zsh = await completionScript("zsh");
  assert.match(zsh, /^#compdef hui$/mu);
  assert.match(zsh, /command hui __complete/u);
  assert.match(zsh, /compdef _hui hui/u, "sourcing the program registers it, not only fpath");
  assert.match(zsh, /funcstack\[1\]\} == _hui/u, "compinit runs the file as _hui");
  assert.match(HELP, /hui completion <bash\|zsh>/u);
});
