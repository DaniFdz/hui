/** File names the agent writes in its reply become links to the Files view once the gateway confirms the path, and
 * everything else in the reply stays plain; a path the agent creates later becomes a link at the end of the next turn
 * (WORK-058). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("paths the agent names become links to Files, everything else stays plain, and a path created later becomes a link at the next turn's end", { tags: ["WORK-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await mkdir(join(repository.path, "src", "lib"), { recursive: true });
  await writeFile(join(repository.path, "src", "lib", "greeting.ts"), `${Array.from({ length: 60 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n")}\n`);
  await writeFile(join(repository.path, "README.md"), "# Read me\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "design.md"), "# Design\n");
  const session = await hui.createSession({ title: "File links", cwd: repository.path });
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");

  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_FILE_LINKS");
  await expect(idle).toBeVisible();

  // A path that exists is a link named after it, and shows the text the agent wrote.
  const greeting = transcript.getByRole("link", "Open src/lib/greeting.ts at line 3 in Files");
  await expect(greeting).toBeVisible();
  expect(await hui.textOf(greeting)).toBe("src/lib/greeting.ts:3");
  await expect(transcript.getByRole("link", "Open src/lib/greeting.ts at line 58 in Files")).toBeVisible();
  await expect(transcript.getByRole("link", "Open README.md in Files")).toBeVisible();
  await expect(transcript.getByRole("link", "Open folder docs in Files")).toBeVisible();
  await expect(transcript.getByRole("link", "Open docs/design.md at line 2 in Files")).toBeVisible();

  // A missing path, a command, a call, a version, an external link, prose and fenced code are not links.
  await expect(transcript.getByRole("link", /^Open /u)).toHaveCount(5);
  await expect(transcript.getByText("src/lib/missing.ts")).toBeVisible();
  await expect(transcript.getByText("npm test")).toBeVisible();
  await hui.expectLinkTo(transcript, "the website", "https://example.com/docs/design.md");

  // The agent creates a path it had named before: the next turn's end turns it into a link.
  await writeFile(join(repository.path, "src", "lib", "missing.ts"), "export const found = true;\n");
  await hui.prompt(session, "thanks");
  await expect(transcript.getByRole("link", "Open src/lib/missing.ts in Files")).toBeVisible();
  await expect(transcript.getByRole("link", /^Open /u)).toHaveCount(6);
});
