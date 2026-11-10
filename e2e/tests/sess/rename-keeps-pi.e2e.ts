/** Renaming a session changes only HUI's registry title; PI's own session file keeps its name and contents (SESS-066). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("renaming a session leaves PI's own session file alone", { tags: ["SESS-066"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByLabel("Session name");
  const session = await hui.createSession({ title: "Rename keeps PI", tool: "pi" });
  await hui.prompt(session, "PI session marker");
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  const before = await hui.stored("PI session marker");
  expect(before.length).toBeGreaterThan(0);

  await hui.sessionList();
  await hui.sessionMenu("Rename keeps PI");
  await screen.getByText("Rename…", { visible: true }).tap();
  await expect(name).toHaveValue("Rename keeps PI");
  await name.fill("Renamed keeps PI");
  await screen.getByLabel("Message", { visible: true }).tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Renamed keeps PI");
  await expect.poll(() => hui.stored("PI session marker")).toEqual(before);
});
