/** A turn that starts with a skill is expanded by the runtime and the transcript names the skill instead of showing PI's wrapper (CHAT-048). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const skill = `---
name: transcript-skill
description: Skill the transcript names when a turn invokes it.
---

# Transcript skill

Use only for this check.
`;

test("a turn that starts with a skill is expanded, and the transcript names it instead of PI's wrapper", { tags: ["CHAT-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await mkdir(join(repository.path, ".pi", "skills", "transcript-skill"), { recursive: true });
  await writeFile(join(repository.path, ".pi", "skills", "transcript-skill", "SKILL.md"), skill);
  const session = await hui.createSession({ title: "Skill turn", cwd: repository.path });
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await screen.getByLabel("Message").fill("/skill:transcript-skill please");
  await screen.getByRole("button", "Send message").tap();

  await expect(transcript.getByTestId("chat-skill-invoked")).toContainText("transcript-skill");
  await expect(transcript.getByTestId("chat-skill-invoked")).toContainText("Skill");
  await expect(transcript.getByText("Use only for this check.", { exact: false })).toBeVisible();
  await expect(transcript.getByText("References are relative to", { exact: false })).toBeHidden();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
