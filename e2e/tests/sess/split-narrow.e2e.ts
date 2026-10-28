/** Below 1100px a split workspace shows one pane at a time, and the Active panel selector or a sidebar row switches to another while the hidden ones keep their stream and draft (SESS-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a narrow split shows only the active pane, switches with the Active panel selector or a sidebar row, and hides nothing from the others", { tags: ["SESS-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const shown = () => screen.getByTestId("session-pane", { visible: true });
  const selector = screen.getByRole("button", { name: /^Active panel/u });
  await hui.wideScreen(2200);
  const first = await hui.createSession({ title: "Pane one" });
  await hui.createSession({ title: "Pane two" });

  await hui.open(`/sessions/${first.id}`);
  await screen.getByRole("button", "Open split view").tap();
  await expect(panes).toHaveCount(2);
  await (await hui.sessionMenu("Pane two")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);
  await panes.nth(0).getByLabel("Message").fill("E2E_REPLAY");
  await panes.nth(0).getByRole("button", "Send message").tap();
  await hui.provider.held();
  await panes.nth(2).getByLabel("Message").fill("Draft in the second chat");

  await hui.phoneScreen();
  await expect(shown()).toHaveCount(1);
  await expect(selector).toBeVisible();
  await expect(screen.getByRole("button", "Move panel")).toHaveCount(0);
  expect(await hui.overflowsSideways()).toBe(false);

  await selector.tap();
  await screen.getByText("3 · Chat").first().tap();
  await expect(shown()).toHaveCount(1);
  await expect(shown().getByTestId("session-title")).toHaveText("Pane two");
  await expect(shown().getByLabel("Message")).toHaveValue("Draft in the second chat");

  await hui.sessionList();
  await screen.getByLabel(/^Pane one, status running/u).tap();
  await expect(shown()).toHaveCount(1);
  await expect(shown().getByTestId("session-title")).toHaveText("Pane one");
  await expect(shown().getByLabel("Session status: Running")).toBeVisible();
  await expect(shown().getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${first.id}`);

  await selector.tap();
  await screen.getByText("3 · Chat").first().tap();
  await expect(shown().getByLabel("Message")).toHaveValue("Draft in the second chat");
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.provider.release();
  await selector.tap();
  await screen.getByText("1 · Chat").last().tap();
  await expect(shown().getByLabel("Session status: Idle")).toBeVisible();
});