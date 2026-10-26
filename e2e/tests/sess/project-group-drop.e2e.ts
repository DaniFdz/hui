/** With Group by Project, a dropped session row changes nothing: project groups follow each session's directory, so only custom groups take a drop (SESS-070). */
import { basename, dirname } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("dropping a session row on a project group leaves it where it was", { tags: ["SESS-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = dirname(hui.workspace);
  const there = basename(parent).toLocaleUpperCase();
  const heading = (label: string) => screen.getByText(label, { exact: true, visible: true });
  const order = () => screen.getByLabel(/^(Home row|Away row), status/u).allTextContents();
  const registry = () => hui.api("GET", "/__hui/sessions");
  await hui.createSession({ title: "Home row" });
  await hui.createSession({ title: "Away row", cwd: parent });

  await hui.open("/");
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByText("Project", { exact: true, visible: true }).tap();
  await expect(heading(there)).toBeVisible();
  const listed = await registry();
  const before = await order();

  await screen.getByTestId("session-row").filter({ hasText: "Home row" }).dragTo(heading(there));
  await expect(screen.getByText(/^Moved Home row/u)).toBeHidden();
  await expect.poll(order).toEqual(before);
  expect(await registry()).toEqual(listed);
  await hui.reload();
  await expect(heading(there)).toBeVisible();
  await expect.poll(order).toEqual(before);

  await hui.api("POST", "/__hui/session-groups", { name: "Drop zone" });
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByText("Custom groups", { exact: true, visible: true }).tap();
  await screen.getByTestId("session-row").filter({ hasText: "Home row" }).dragTo(heading("DROP ZONE"));
  await expect(screen.getByText("Moved Home row to DROP ZONE.")).toBeVisible();
});