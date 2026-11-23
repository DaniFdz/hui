/** The prompt a reader scrolled past comes back as a one-line pill that jumps to it (CHAT-086). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const prompt = (step: number) => `Step ${step}: describe the transcript layout.`;

test("the pill names the prompt scrolled past, jumps back to it and hides at the top", { tags: ["CHAT-086"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Sticky prompt" });
  for (let step = 1; step <= 10; step++) await hui.prompt(session, prompt(step));
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const transcript = screen.getByTestId("transcript");
  const pill = screen.getByRole("button", "Jump to your prompt", { exact: false });
  // Scroll the reader past a prompt: the pill only shows once the prompt it would name has left the top of the transcript.
  const prompts = transcript.getByRole("button", "Copy prompt");
  let named: string | null = null;
  for (let index = 5; index < 8 && !named; index++) {
    await hui.scrollTo(transcript, prompts.nth(index));
    if (await pill.isVisible()) named = await pill.textContent();
  }
  expect(named).toMatch(/^Step \d+: describe the transcript layout\.$/u);
  const step = Number(/^Step (\d+):/u.exec(named!)?.[1]);
  expect(step).toBeGreaterThanOrEqual(2);

  const pillBox = await pill.boundingBox();
  await pill.tap();
  const jumped = transcript.getByText(prompt(step), { exact: true }).first();
  await expect(jumped).toBeVisible();
  const jumpedBox = await jumped.boundingBox();
  expect(jumpedBox!.y).toBeGreaterThan(pillBox!.y);
  expect(jumpedBox!.y).toBeLessThan(pillBox!.y + pillBox!.height + 40);
  await expect.poll(() => pill.textContent()).toBe(prompt(step - 1));

  await hui.scrollTo(transcript, transcript.getByText(prompt(1), { exact: true }).first());
  await expect(pill).toBeHidden();
});
