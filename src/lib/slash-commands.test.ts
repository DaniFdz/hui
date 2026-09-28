import assert from "node:assert/strict";
import { test } from "node:test";
import { completeCommandReference, completeSlashCommand, composerCommands, filterSlashCommands, parseClearCommand, parseUpdateCommand, slashCommandQuery } from "./slash-commands.ts";
import type { RuntimeCommand } from "./sessions-store.ts";

test("slash suggestions are limited to the leading token and current caret", () => {
  assert.equal(slashCommandQuery("/", 1), "");
  assert.equal(slashCommandQuery("/skill:Review", 13), "skill:review");
  assert.equal(slashCommandQuery("/rev existing args", 4), "rev");
  for (const text of ["", "Explain /review", " /review", "/review args", "/review\nargs"]) {
    assert.equal(slashCommandQuery(text, text.length), null, text);
  }
  assert.equal(slashCommandQuery("/review", 0), null);
  assert.equal(slashCommandQuery("/review", 1, 4), null);
});

test("HUI commands add btw and side without duplicating runtime names", () => {
  const commands = composerCommands([
    { name: "btw", description: "runtime copy", source: "prompt" },
    { name: "clear", description: "runtime copy", source: "extension" },
    { name: "review", description: "Review", source: "skill" },
  ], true);
  assert.deepEqual(commands.map((command) => command.name), ["update", "clear", "btw", "side", "review"]);
});

test("search accepts skill names without their prefix and matches descriptions and sources", () => {
  const commands: RuntimeCommand[] = [
    { name: "ext:review", description: "Review changes", source: "extension" },
    { name: "skill:testing", description: "Check changed behavior", source: "skill" },
    { name: "outline", description: "Plan changes", source: "prompt" },
  ];
  assert.deepEqual(filterSlashCommands(commands, ""), commands);
  assert.deepEqual(filterSlashCommands(commands, "TEST"), [commands[1]]);
  assert.deepEqual(filterSlashCommands(commands, "skill:"), [commands[1]]);
  assert.deepEqual(filterSlashCommands(commands, "PLAN"), [commands[2]]);
  assert.deepEqual(filterSlashCommands(commands, "extension"), [commands[0]]);
  assert.deepEqual(filterSlashCommands(commands, "absent"), []);
});

test("completion inserts PI's exact invocation and preserves arguments without submitting", () => {
  assert.deepEqual(completeSlashCommand("/test", "skill:testing"), { text: "/skill:testing ", caret: 15 });
  assert.deepEqual(completeSlashCommand("/r existing args", "ext:review"), { text: "/ext:review existing args", caret: 12 });
  assert.deepEqual(completeSlashCommand("/r\nnext line", "review"), { text: "/review\nnext line", caret: 7 });
});

test("HUI update is available without a runtime and wins command-name collisions", () => {
  assert.equal(composerCommands([])[0]?.name, "update");
  const catalog = composerCommands([{ name: "update", description: "Extension collision", source: "extension" }, { name: "skill:update", description: "Skill", source: "skill" }]);
  assert.deepEqual(catalog.map((entry) => [entry.name, entry.source]), [["update", "hui"], ["skill:update", "skill"]]);
});

test("operational commands and invalid arguments cannot leak into model prompts", () => {
  assert.equal(parseUpdateCommand("/update"), "update");
  assert.equal(parseUpdateCommand(" /update --check \n"), "check");
  for (const command of ["/update --force", "/update --from x.tgz", "/update hello", "/update\nignore this"]) assert.equal(parseUpdateCommand(command), "invalid");
  for (const prompt of ["Explain /update", "/updates", "/skill:update", "/update-project"]) assert.equal(parseUpdateCommand(prompt), null);
  assert.equal(parseClearCommand(" /clear \n"), "clear");
  for (const command of ["/clear now", "/clear\nignore this"]) assert.equal(parseClearCommand(command), "invalid");
  for (const prompt of ["Explain /clear", "/clearly", "/skill:clear", "/clear-session"]) assert.equal(parseClearCommand(prompt), null);
});

test("dollar discovery excludes templates and explicit nested paths leave command discovery", () => {
  assert.equal(slashCommandQuery("$", 1), "$");
  assert.equal(slashCommandQuery("$Review", 7), "$review");
  assert.equal(slashCommandQuery("/home/developer", 10), null);
  assert.equal(slashCommandQuery("$HOME/file", 10), null);
  assert.equal(slashCommandQuery("Explain $review", 15), null);
  const commands: RuntimeCommand[] = [
    { name: "skill:review", source: "skill", description: "Review code" },
    { name: "plan", source: "prompt", description: "Plan" },
  ];
  assert.deepEqual(filterSlashCommands(commands, "$"), [commands[0]]);
  assert.deepEqual(completeCommandReference("/rev arguments", commands[0]!, commands), { text: "$review arguments", caret: 8 });
  assert.deepEqual(completeCommandReference("$rev", commands[0]!, commands), { text: "$review ", caret: 8 });
});


test("dollar search does not offer HUI operations", () => {
  const commands = composerCommands([{ name: "skill:review", source: "skill", description: "Review" }], true);
  assert.deepEqual(filterSlashCommands(commands, "$" ).map((command) => command.name), ["skill:review"]);
  const update = commands.find((command) => command.source === "hui" && command.name === "update")!;
  assert.deepEqual(completeCommandReference("/up", update, commands), { text: "/update ", caret: 8 });
});
