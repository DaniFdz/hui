/** A session's address, a Sessions row or another link opens the pane that already shows the session instead of repeating it in the focused pane (SESS-078). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a session's address or a Sessions row opens the pane that already shows it instead of repeating it in the focused one", { tags: ["SESS-078"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const title = (index: number) => panes.nth(index).getByTestId("session-title");
  // Neither pane count nor titles move: the two panes keep their own sessions in the same order.
  const unchanged = async () => {
    await expect(panes).toHaveCount(2);
    await expect(title(0)).toHaveText("First width");
    await expect(title(1)).toHaveText("Second width");
  };
  await hui.wideScreen(2200);
  const first = await hui.createSession({ title: "First width" });
  const second = await hui.createSession({ title: "Second width" });
  await hui.open(`/sessions/${first.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Second width")).getByText("Open in split pane", { visible: true }).tap();
  await unchanged();
  await expect(panes.nth(1)).toHaveAttribute("aria-current", "true");

  // A Sessions row for a session the other pane shows focuses that pane; it does not give the focused pane a second
  // view of it.
  await hui.sessionList();
  await screen.getByTestId("nav-item").filter({ hasText: "Sessions" }).tap();
  await expect(screen.getByTestId("page-title")).toHaveText("Sessions");
  await screen.getByRole("button", "Open First width").tap();
  await unchanged();
  await expect(panes.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(panes.nth(1)).not.toHaveAttribute("aria-current", "true");
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${first.id}`);

  // An address naming the other pane's session — a deep link, a second tab's saved layout or a reload — focuses it and
  // keeps both panes instead of giving the focused pane a second view of it.
  await title(1).tap();
  await expect(panes.nth(1)).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${second.id}`);
  await hui.open(`/sessions/${first.id}`);
  await unchanged();
  await expect(panes.nth(0)).toHaveAttribute("aria-current", "true");

  // A reload keeps the focused pane when it shows the addressed session, so a deliberate second view of it is not
  // reassigned to its sibling.
  await title(1).tap();
  await panes.nth(1).getByRole("button", "Split right").tap();
  await expect(panes).toHaveCount(3);
  await expect(title(2)).toHaveText("Second width");
  const focused = panes.nth(2);
  await hui.reload();
  await expect(panes).toHaveCount(3);
  await expect(title(2)).toHaveText("Second width");
  await expect(focused).toHaveAttribute("aria-current", "true");
});
