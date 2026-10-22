/** A reply's disclosure blocks, callouts and code blocks: a details summary toggles its body, alert quotes become titled callouts, and code blocks copy, wrap and reveal their hidden lines (RICH-003, RICH-013, RICH-007, RICH-008). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function reply(screen: Screen, hui: Hui, markdown: string) {
  const session = await hui.createSession({ title: "Rich reply" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

const edges = async (target: Locator) => {
  const { x, y, width, height } = (await target.boundingBox())!;
  return { left: x, right: x + width, top: y, bottom: y + height };
};

test("A details block shows only its summary, and activating the summary shows its body, then hides it again", { tags: ["RICH-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = await reply(screen, hui, "Before the block.\n\n<details><summary>More formatting</summary>\n\nThe body behind the summary.\n\n</details>\n\nAfter the block.");
  const summary = transcript.getByText("More formatting");
  const body = transcript.getByText("The body behind the summary.");
  await expect(summary).toBeVisible();
  await expect(transcript.getByText("After the block.")).toBeVisible();
  await expect(body).toBeHidden();

  await summary.tap();
  await expect(body).toBeVisible();
  await summary.tap();
  await expect(body).toBeHidden();
  await expect(summary).toBeVisible();
});

test("Alert quotes render as callouts titled Note, Tip, Important, Warning and Caution, and an ordinary quote stays plain", { tags: ["RICH-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  const titles = ["Note", "Tip", "Important", "Warning", "Caution"];
  const transcript = await reply(screen, hui, [...titles.map((title) => `> [!${title.toUpperCase()}]\n> The ${title.toLowerCase()} body.`), "> An ordinary quote."].join("\n\n"));
  for (const title of titles) {
    const callout = transcript.getByLabel(title);
    await expect(callout.getByText(title, { exact: true })).toBeVisible();
    await expect(callout).toContainText(`The ${title.toLowerCase()} body.`);
    await expect(transcript.getByText(title, { exact: true })).toHaveCount(1);
  }
  await expect(transcript.getByText("An ordinary quote.")).toBeVisible();
  await expect(transcript.getByText(/\[!/u)).toBeHidden();
});

test("Copy code copies the block without its trailing newline, reads Copied, then Copy code again", { tags: ["RICH-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const transcript = await reply(screen, hui, "```python\nprint(\"one\")\nprint(\"two\")\n```");
  await expect(transcript.getByText("python", { exact: true })).toBeVisible();
  await transcript.getByRole("button", "Copy code").tap();
  await expect(transcript.getByRole("button", "Copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("print(\"one\")\nprint(\"two\")");
  await expect(transcript.getByRole("button", "Copy code")).toBeVisible();
  await expect(transcript.getByRole("button", "Copied")).toBeHidden();
});

test("When the clipboard refuses, Copy code reads Copy failed, then Copy code again", { tags: ["RICH-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard({ refuse: true });
  const transcript = await reply(screen, hui, "```sh\necho refused\n```");
  await expect(transcript.getByText("sh", { exact: true })).toBeVisible();
  await transcript.getByRole("button", "Copy code").tap();
  await expect(transcript.getByRole("button", "Copy failed")).toBeVisible();
  await expect(transcript.getByRole("button", "Copy code")).toBeVisible();
  await expect(transcript.getByRole("button", "Copy failed")).toBeHidden();
  expect(await hui.copied()).toBe("");
});

test("Enable word wrap wraps a block's long line and becomes Disable word wrap, which brings back horizontal scrolling", { tags: ["RICH-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = await reply(screen, hui, `\`\`\`ts\nconst banner = "${"wide ".repeat(80).trim()}";\nconst done = true;\n\`\`\``);
  const code = transcript.getByText(/^const banner/u);
  const copy = transcript.getByRole("button", "Copy code");
  await expect(code).toBeVisible();
  const overflowing = async () => (await edges(code)).right > (await edges(copy)).right;
  await expect.poll(overflowing).toBe(true);

  await transcript.getByRole("button", "Enable word wrap").tap();
  await expect(transcript.getByRole("button", "Disable word wrap")).toBeVisible();
  await expect.poll(overflowing).toBe(false);

  await transcript.getByRole("button", "Disable word wrap").tap();
  await expect(transcript.getByRole("button", "Enable word wrap")).toBeVisible();
  await expect.poll(overflowing).toBe(true);
  const start = (await edges(code)).left;
  await hui.scrollSideways(code);
  await expect.poll(async () => (await edges(code)).left).toBeLessThan(start);
});

test("A block taller than its limit shows Show N hidden lines, which reveals the rest", { tags: ["RICH-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const lines = Array.from({ length: 12 }, (_, index) => `step(${index + 1});`);
  const transcript = await reply(screen, hui, `\`\`\`ts\n${lines.join("\n")}\n\`\`\`\n\nAfter the code.`);
  const show = transcript.getByRole("button", "Show 5 hidden lines");
  const code = transcript.getByText(/^step\(1\);/u);
  const after = transcript.getByText("After the code.");
  const revealed = async () => (await edges(code)).bottom <= (await edges(after)).top;
  await expect(show).toBeVisible();
  await expect.poll(revealed).toBe(false);

  await show.tap();
  await expect(show).toBeHidden();
  await expect.poll(revealed).toBe(true);
});
