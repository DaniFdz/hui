/** With a session menu open, P, R, U, A and D run their actions at once, with or without Shift, while modified keys, held-key repeats, text fields and submenus keep their usual keys (SESS-040). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const STATE = "Keyed session, status idle, tool durable, stage investigation";

test("a session menu's single keys pin, rename, mark unread, delete and archive", { tags: ["SESS-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const state = (...flags: string[]) => screen.getByLabel([STATE, ...flags].join(", "));
  const press = async (key: string) => {
    await hui.sessionMenu("Keyed session");
    await screen.getByRole("menuitem", "Rename…").press(key);
  };
  const session = await hui.createSession({ title: "Keyed session" });
  await hui.open(`/sessions/${session.id}`);

  await press("p");
  await expect(state("pinned")).toBeVisible();
  await press("Shift+P");
  await expect(state()).toBeVisible();
  await press("u");
  await expect(state("unread")).toBeVisible();
  await press("Shift+U");
  await expect(state()).toBeVisible();
  for (const key of ["r", "Shift+R"]) {
    await press(key);
    await expect(screen.getByLabel("Session name")).toHaveValue("Keyed session");
    await screen.getByLabel("Session name").press("Escape");
    await expect(screen.getByLabel("Session name")).toBeHidden();
  }
  for (const key of ["d", "Shift+D"]) {
    await press(key);
    await expect(screen.getByText("Remove Keyed session from HUI?")).toBeVisible();
    await screen.getByRole("button", "Cancel").tap();
    await expect(state()).toBeVisible();
  }
  await press("a");
  await expect(screen.getByText("Archived “Keyed session”.")).toBeVisible();
  await screen.getByRole("button", "Restore").press("Enter");
  await expect(state()).toBeVisible();
  await press("Shift+A");
  await expect(screen.getByText("Archived “Keyed session”.")).toBeVisible();
  await expect(state()).toBeHidden();
});

test("modified keys, held-key repeats, text fields and submenus keep their usual keys", { tags: ["SESS-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const archive = screen.getByRole("menuitem", "Archive session");
  const session = await hui.createSession({ title: "Keyed session" });
  await hui.open(`/sessions/${session.id}`);

  await hui.sessionMenu("Keyed session");
  await archive.press("Alt+a");
  await expect(archive).toBeVisible();
  await archive.press("Escape");
  await expect(archive).toBeHidden();

  await hui.keyboard.down("a");
  await hui.sessionMenu("Keyed session");
  await hui.keyboard.down("a");
  await hui.keyboard.up("a");
  await expect(archive).toBeVisible();

  await screen.getByRole("menuitem", "Icon").tap();
  await screen.getByRole("button", "Custom emoji…").tap();
  await screen.getByLabel("Custom emoji", { visible: true }).pressSequentially("pad");
  await expect(screen.getByLabel("Custom emoji", { visible: true })).toHaveValue("pad");
  await expect(archive).toBeVisible();
  await screen.getByRole("button", "Back").tap();

  await screen.getByRole("menuitem", "Copy").tap();
  await screen.getByRole("menuitem", "Session ID").press("a");
  await expect(screen.getByRole("menuitem", "Session ID")).toBeVisible();
  await archive.press("Escape");
  await expect(screen.getByLabel(STATE)).toBeVisible();
  await expect(screen.getByText("Archived “Keyed session”.")).toBeHidden();
});
