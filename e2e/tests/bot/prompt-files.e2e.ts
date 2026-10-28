/** A bot's prompt is four files and only two of them travel: its export carries SOUL.md and its BOOTSTRAP.md, never
 * USER.md or MEMORY.md, and an import's memories become MEMORY.md, shown in its preview as reference data (BOT-068). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a bot's export carries SOUL.md and its BOOTSTRAP.md, never USER.md or MEMORY.md", { tags: ["BOT-068"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", {
    name: "Quill",
    soul: "# Who I am\nE2E_SOUL: a fixture bot.\n",
    user: "- E2E_USER: the operator prefers short answers.\n",
    memory: "# What I kept\n\nE2E_MEMORY: the fixture project.\n",
    bootstrap: "E2E_BOOTSTRAP: ask what to look after.\n",
  });

  await hui.open("/");
  await screen.getByRole("tab", "Bots").tap();
  await screen.getByText("Quill").hover();
  await screen.getByRole("button", "Actions for Quill").tap();
  await screen.getByText("Export…").tap();
  const files = screen.getByText("Files as they will be saved");
  await expect(files).toBeVisible();
  await files.tap();
  await expect(screen.getByText("SOUL.md")).toBeVisible();
  await expect(screen.getByText("BOOTSTRAP.md")).toBeVisible();
  await expect(screen.getByText("USER.md")).toBeHidden();
  await expect(screen.getByText("MEMORY.md")).toBeHidden();
});

test("an import's memories become MEMORY.md, which its preview shows as never exported", { tags: ["BOT-068"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = JSON.stringify({
    spec: "chara_card_v2",
    data: {
      name: "Marina",
      description: "E2E_SOUL: a fixture bot for the catalogue.",
      character_book: { entries: [{ content: "E2E_MEMORY: the fixture project is called Quasar." }] },
    },
  });

  await hui.open("/");
  await screen.getByRole("tab", "Bots").tap();
  await screen.getByRole("button", "Import bot…").tap();
  await screen.getByLabel("Paste").tap();
  await screen.getByRole("textbox", "Template").fill(card);
  await screen.getByRole("button", "Preview").tap();
  const memory = screen.getByText("MEMORY.md");
  await expect(memory).toBeVisible();
  await memory.tap();
  await expect(screen.getByText("E2E_MEMORY: the fixture project is called Quasar.", { exact: false })).toBeVisible();
  await expect(screen.getByText("It is read on every request and never leaves with an export.", { exact: false })).toBeVisible();
});