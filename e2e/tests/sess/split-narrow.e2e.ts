/** Below 1100px a split workspace shows one pane at a time, and the Active panel selector or a sidebar row switches to another while the hidden ones keep their stream and draft (SESS-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a narrow split shows only the active pane, switches with the Active panel selector or a sidebar row, and hides nothing from the others", { tags: ["SESS-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const shown = () => screen.getByTestId("session-pane", { visible: true });
  const selector = screen.getByRole("button", { name: /^Active panel/u });
  // On a phone the active pane's header carries the pane chooser in place of its title.
  const shownTitle = async () => {
    const picker = screen.getByRole("button", { name: /^Active panel:/u });
    if (await picker.count() > 0) return (await picker.getAttribute("aria-label") ?? "").split(" · ").at(-1) ?? "";
    return (await shown().getByTestId("session-title").textContent()) ?? "";
  };
  await hui.wideScreen(2200);
  const first = await hui.createSession({ title: "Pane one" });
  await hui.createSession({ title: "Pane two" });

  await hui.open(`/sessions/${first.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Pane two")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  await panes.nth(0).getByLabel("Message").fill("E2E_REPLAY");
  await panes.nth(0).getByRole("button", "Send message").tap();
  await hui.provider.held();
  await panes.nth(1).getByLabel("Message").fill("Draft in the second chat");

  await hui.phoneScreen();
  await expect(shown()).toHaveCount(1);
  await expect(selector).toBeVisible();
  await expect(screen.getByRole("button", "Move panel")).toHaveCount(0);
  expect(await hui.overflowsSideways()).toBe(false);

  await selector.tap();
  await screen.getByTestId("picker-list").getByText("2 · Chat", { exact: true }).tap();
  await expect(shown()).toHaveCount(1);
  await expect.poll(shownTitle).toBe("Pane two");
  await expect(shown().getByLabel("Message")).toHaveValue("Draft in the second chat");

  await hui.sessionList();
  // Activating the focused row from the keyboard keeps clear of the drawer's backdrop while it slides in; a pointer
  // press there could only close the drawer and leave the previous pane active.
  await hui.activateSidebarRow("Pane one");
  await expect(shown()).toHaveCount(1);
  await expect.poll(shownTitle).toBe("Pane one");
  await expect(shown().getByLabel("Session status: Running")).toBeVisible();
  await expect(shown().getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${first.id}`);

  await selector.tap();
  await screen.getByTestId("picker-list").getByText("2 · Chat", { exact: true }).tap();
  await expect(shown().getByLabel("Message")).toHaveValue("Draft in the second chat");
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.provider.release();
  await selector.tap();
  await screen.getByTestId("picker-list").getByText("1 · Chat", { exact: true }).tap();
  await expect(shown().getByLabel("Session status: Idle")).toBeVisible();
});
