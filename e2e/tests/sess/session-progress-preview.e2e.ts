/** A session's latest progress card shows in its row preview while another screen is open, follows a cleared and a new plan in the background, survives a reload and comes back after a gateway restart once the session is reopened (SESS-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const progress = (input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name: "progress_card", input })).toString("base64url")}`;

const PLAN = progress({ plan: [
  { step: "Read the fixture", status: "completed" },
  { step: "Verify the preview", status: "in_progress" },
] });

const NEXT = progress({ plan: [{ step: "Report the result", status: "in_progress" }] });

test("a session's progress card shows in its row preview, follows a cleared and a new plan, and returns after a reload and a gateway restart", { tags: ["SESS-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = screen.getByTestId("session-row").filter({ hasText: "Plan in background" });
  const step = (text: string) => screen.getByText(text, { exact: true, visible: true });
  const preview = async () => hui.peek(row);
  const busy = await hui.createSession({ title: "Plan in background" });
  await hui.createSession({ title: "Other session" });
  await hui.open("/");

  await hui.prompt(busy, PLAN);
  await preview();
  await expect(step("Verify the preview")).toBeVisible();
  await expect(step("1/2")).toBeVisible();

  await hui.prompt(busy, progress({}));
  await expect(step("Verify the preview")).toBeHidden();
  await hui.prompt(busy, NEXT);
  await expect(step("Report the result")).toBeVisible();
  await expect(step("0/1")).toBeVisible();

  await hui.reload();
  await expect(step("Report the result")).toBeHidden();
  await preview();
  await expect(step("Report the result")).toBeVisible();

  await hui.restartGateway();
  await hui.reload();
  await preview();
  await expect(step("Report the result")).toBeHidden();
  await hui.open(`/sessions/${busy.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.open("/");
  await preview();
  await expect(step("Report the result")).toBeVisible();
});
