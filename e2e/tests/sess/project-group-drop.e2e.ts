/** With Group by Project, a dropped session row changes nothing: project groups follow each session's directory, so only custom groups take a drop (SESS-070). */
import { basename, dirname } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("dropping a session row on a project group leaves it where it was", { tags: ["SESS-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = dirname(hui.workspace);
  const there = basename(parent).toLocaleUpperCase();
  const heading = (label: string) => screen.getByText(label, { exact: true, visible: true });
  const home = () => screen.getByTestId("session-row").filter({ hasText: "Home row" });
  const order = () => screen.getByLabel(/^(Home row|Away row), status/u).allTextContents();
  const grouping = async () => (await hui.api<{ groups: { label: string; sessions: { id: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.map((group) => [group.label, group.sessions.map(({ id }) => id)]);
  await hui.createSession({ title: "Home row" });
  await hui.createSession({ title: "Away row", cwd: parent });

  await hui.open("/");
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByText("Project", { exact: true, visible: true }).tap();
  await expect(heading(there)).toBeVisible();
  const groups = await grouping();
  const before = await order();

  await hui.drag(home(), heading(there), async () => expect((await hui.look(home())).opacity).toBeLessThan(1));
  await expect(screen.getByText(/^Moved Home row/u)).toBeHidden();
  await expect.poll(order).toEqual(before);
  expect(await grouping()).toEqual(groups);

  await hui.api("POST", "/__hui/session-groups", { name: "Drop zone" });
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByText("Custom groups", { exact: true, visible: true }).tap();
  await expect(heading("DROP ZONE")).toBeVisible();
  await home().dragTo(heading("DROP ZONE"));
  await expect(screen.getByText("Moved Home row to DROP ZONE.")).toBeVisible();
});