/** A progress_card call shows the agent's plan above the composer, follows its latest call and comes back after a reload (AGENT-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const progress = (input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name: "progress_card", input })).toString("base64url")}`;

const PARTIAL = progress({
  markdown: "**Shipping the slice** · three steps",
  plan: [
    { step: "Read the fixture", status: "completed" },
    { step: "Verify the presentation", status: "in_progress" },
    { step: "Report the result", status: "pending" },
  ],
});

const DONE = progress({ plan: ["Read the fixture", "Verify the presentation", "Report the result"].map((step) => ({ step, status: "completed" })) });

test("a progress_card call shows the agent's plan, its latest call, its removal and the collapsed setting", { tags: ["AGENT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("task-progress");
  const steps = card.getByLabel("Task progress");
  const collapse = screen.getByRole("switch", "Collapse task progress");
  const step = (name: string) => steps.getByRole("listitem").filter({ hasText: name });
  const started = async (title: string) => {
    const session = await hui.createSession({ title });
    await hui.open(`/sessions/${session.id}`);
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    return session;
  };

  await hui.open("/settings/appearance");
  await expect(collapse).toBeChecked({ checked: false });
  const session = await started("Agent progress");
  await hui.prompt(session, PARTIAL);

  await expect(card).toBeVisible();
  const [cardBox, composerBox] = [(await card.boundingBox())!, (await screen.getByLabel("Message").boundingBox())!];
  expect(cardBox.y).toBeLessThan(composerBox.y);
  await expect(steps).toBeVisible();
  await expect(card.getByText("1 of 3", { visible: true })).toBeVisible();
  await expect(card.getByText("Shipping the slice", { exact: false })).toBeVisible();
  await expect(step("Read the fixture")).toHaveAttribute("data-status", "completed");
  await expect(step("Verify the presentation")).toHaveAttribute("data-status", "in_progress");
  await expect(step("Report the result")).toHaveAttribute("data-status", "pending");
  await expect(transcript.getByText("progress_card")).toHaveCount(0);

  await card.getByText("Task progress", { visible: true }).tap();
  await expect(steps).toBeHidden();
  await expect(card.getByText("Verify the presentation", { visible: true })).toBeVisible();
  await expect(card.getByText("1/3", { visible: true })).toBeVisible();

  await hui.reload();
  await expect(card).toBeVisible();
  await expect(step("Verify the presentation")).toHaveAttribute("data-status", "in_progress");

  await hui.prompt(session, DONE);
  await expect(card.getByText("3/3", { visible: true })).toBeVisible();
  await expect(steps).toBeHidden();

  await hui.prompt(session, progress({ markdown: "", plan: [] }));
  await expect(card).toBeHidden();

  await hui.open("/settings/appearance");
  await hui.flip(collapse);
  await expect(collapse).toBeChecked();
  const collapsed = await started("Collapsed agent progress");
  await hui.prompt(collapsed, PARTIAL);
  await expect(card.getByText("1/3", { visible: true })).toBeVisible();
  await expect(steps).toBeHidden();
});