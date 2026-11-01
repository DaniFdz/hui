/** A file in the gateway's tool-icons directory, named by chat.toolIcons, replaces a tool row's built-in mark (CHAT-084). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a custom tool icon file replaces the built-in mark for its CLI", { tags: ["CHAT-084"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<{ chat: Record<string, unknown> }>("GET", "/__hui/settings");
  await mkdir(join(hui.configDir, "tool-icons"), { recursive: true });
  await writeFile(join(hui.configDir, "tool-icons", "git-e2e.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#f60"/></svg>');
  await hui.api("PUT", "/__hui/settings", { ...settings, chat: { ...settings.chat, toolIcons: { git: "git-e2e.svg" } } });

  const session = await hui.createSession({ title: "Custom tool icon" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, call("bash", { command: "git --version" }));
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const mark = transcript.getByTestId("tool-mark-icon");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("src", /\/__hui\/tool-icons\/git-e2e\.svg$/u);
});
