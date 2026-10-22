/** /reload picks up skills and commands added after a session started, keeping its transcript, model and thinking level, and refuses arguments, attachments and active work (CHAT-042). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const SKILL = "---\nname: reload-fixture\ndescription: Skill added after the session started.\n---\nUse only for reload checks.\n";
const TEMPLATE = "---\ndescription: Template added after the session started.\n---\nSay hello.\n";
const EXTENSION = `export default function (pi) {
  pi.registerCommand("reload-check", { description: "Command added after the session started", handler: async () => undefined });
}
`;

test("/reload lists skills and commands added since the session started and keeps its transcript, model and thinking level", { tags: ["CHAT-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const menu = screen.getByLabel("Commands and paths");
  const added = ["Skill added after the session started.", "Template added after the session started.", "Command added after the session started"];
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Reload me", cwd: repository.path });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.api("POST", `/__hui/sessions/${session.id}/thinking`, { level: "low" });
  await message.fill("Before the reload");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { visible: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: low", { visible: true })).toBeVisible();

  await message.fill("/");
  await expect(menu.getByText("/reload", { exact: true })).toBeVisible();
  for (const description of added) await expect(menu.getByText(description)).toBeHidden();
  const pi = join(repository.path, ".pi");
  await mkdir(join(pi, "skills", "reload-fixture"), { recursive: true });
  await mkdir(join(pi, "prompts"), { recursive: true });
  await mkdir(join(pi, "extensions"), { recursive: true });
  await writeFile(join(pi, "skills", "reload-fixture", "SKILL.md"), SKILL);
  await writeFile(join(pi, "prompts", "reload-template.md"), TEMPLATE);
  await writeFile(join(pi, "extensions", "reload-check.js"), EXTENSION);

  await message.fill("/reload");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Reloaded extensions, skills, prompts and context files.")).toBeVisible();
  await expect(transcript.getByText("Before the reload")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { visible: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: low", { visible: true })).toBeVisible();

  await message.fill("/");
  for (const description of added) await expect(menu.getByText(description)).toBeVisible();
});

test("/reload refuses arguments, attachments and active work", { tags: ["CHAT-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Reload refused" });
  await hui.open(`/sessions/${session.id}`);
  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();

  await message.fill("/reload");
  await screen.getByRole("button", "Steer message; touch and hold to enqueue").tap();
  await expect(screen.getByText("Finish or stop active work before reloading the session.")).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/reload everything");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Use /reload without arguments or attachments.")).toBeVisible();
  await expect(message).toHaveValue("/reload everything");
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(screen.getByText("Use /reload without arguments or attachments.")).toBeHidden();

  await message.fill("/reload");
  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Use /reload without arguments or attachments.")).toBeVisible();
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
});
