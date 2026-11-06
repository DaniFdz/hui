import assert from "node:assert/strict";
import { test } from "vitest";

import { expandedSkillText, splitSkillBlock } from "./skill-block.ts";

const expanded = `<skill name="cost-investigation" location="/opt/hui/skills/cost-investigation/SKILL.md">
References are relative to /opt/hui/skills/cost-investigation.

# Cost investigation

Name the cheaper mechanism.

## Report

Do not change code.
</skill>

# Why was "Retry-safe checkout" expensive?

It cost $1.25.`;

test("a prompt that invokes a skill is split into the skill, its body and the turn's own words", () => {
  const skill = splitSkillBlock(expanded);
  assert.ok(skill);
  assert.equal(skill.name, "cost-investigation");
  assert.equal(skill.location, "/opt/hui/skills/cost-investigation/SKILL.md");
  assert.match(skill.body, /^# Cost investigation/u);
  assert.ok(!skill.body.includes("References are relative to"), "PI's pointer line is not part of the method");
  assert.match(skill.rest, /^# Why was "Retry-safe checkout" expensive\?/u);
  assert.equal(expandedSkillText(skill), `${skill.body}\n\n${skill.rest}`, "the wrapper disappears, the method stays readable");
});

test("plain prompts and malformed blocks are left alone", () => {
  assert.equal(splitSkillBlock("# Why was this expensive?\n\nIt cost $1.25."), undefined);
  assert.equal(splitSkillBlock('<skill name="x" location="/x">\nno closing tag'), undefined);
  const withoutBody = splitSkillBlock('<skill name="x" location="/x">\n</skill>\n\n# Heading');
  assert.equal(withoutBody?.body, "");
  assert.equal(withoutBody?.rest, "# Heading");
});
