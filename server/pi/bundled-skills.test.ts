/** The skills HUI ships: each file exists with the name and description PI lists, and the cost method is complete. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { bundledSkillEnabled, bundledSkills } from "./bundled-skills.ts";

const frontmatter = (path: string) => {
  const source = readFileSync(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source);
  assert.ok(match, `${path} starts with skill frontmatter`);
  const fields = Object.fromEntries([...match[1]!.matchAll(/^([a-z-]+):\s*(.+)$/gmu)].map(([, key, value]) => [key, value]));
  return { source, fields };
};

test("every shipped skill exists with the name PI offers and a description it can list", () => {
  for (const skill of bundledSkills) {
    const { source, fields } = frontmatter(skill.path);
    assert.equal(fields["name"], skill.name, `${skill.name} names itself`);
    assert.ok((fields["description"] ?? "").trim().length > 10, `${skill.name} explains when to use it`);
    assert.ok(source.trim().length > (fields["description"] ?? "").length, `${skill.name} has a body`);
    assert.ok(skill.preferencePath.startsWith("hui:skill:"), `${skill.name} keeps a stable preference key`);
  }
});

test("the cost method names what to work out, the four mechanisms and the report shape", () => {
  const skill = bundledSkills.find((entry) => entry.name === "cost-investigation");
  assert.ok(skill, "HUI ships the cost investigation method");
  const { source } = frontmatter(skill.path);
  const flat = source.replace(/\s+/gu, " ");
  for (const text of [
    "## What to work out",
    "**Context**", "**Model and effort**", "**Structure**", "**Workflow**",
    "driver → mechanism → what it saves", "this session", "every session",
    "## Suggest follow-ups", "**A check**", "**A skill**", "**A refactor**", "**Service instructions**",
    "suggest_task", "One card per change, at most three",
    "Do not change code unless asked",
  ]) assert.ok(flat.includes(text), `${text} is in the method`);
});

test("a shipped skill is on unless its stable key or its file is in disabledSkills", () => {
  const skill = bundledSkills[0]!;
  assert.equal(bundledSkillEnabled(skill.name, []), true);
  assert.equal(bundledSkillEnabled(skill.name, [{ path: skill.preferencePath }]), false, "the stable key turns it off");
  assert.equal(bundledSkillEnabled(skill.name, [{ path: skill.path }]), false, "so does the file path an older settings file holds");
  assert.equal(bundledSkillEnabled("missing-skill", []), false);
});
