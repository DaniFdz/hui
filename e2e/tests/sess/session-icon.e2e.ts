/** The session menu's Icon panel sets a preset, custom or no icon on the session row, keeps it across a reload, and fits a phone screen (SESS-033). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Icon sets a preset, a custom emoji or no icon, and the icon survives a reload", { tags: ["SESS-033"] }, async ({ screen, hui }) => {
  const row = screen.getByLabel("Iconic session, status idle, tool durable, stage investigation");
  const icon = async () => {
    await hui.sessionMenu("Iconic session");
    await screen.getByText("Icon", { exact: true, visible: true }).tap();
  };
  const custom = screen.getByLabel("Custom emoji", { visible: true });
  const set = screen.getByRole("button", "Set");
  const session = await hui.createSession({ title: "Iconic session" });
  await hui.open(`/sessions/${session.id}`);
  await hui.sessionList();

  await icon();
  for (const preset of ["🦞", "🚀", "🐛", "✅", "🔥", "📦", "🧪", "📝", "🔍", "⚡", "🎯"]) await expect(screen.getByRole("button", `Set icon ${preset}`)).toBeVisible();
  await expect(screen.getByRole("button", "No icon")).toBeVisible();
  await screen.getByRole("button", "Set icon 🚀").tap();
  await expect(row.getByText("🚀")).toBeVisible();

  await icon();
  await screen.getByRole("button", "No icon").tap();
  await expect(row.getByText("Iconic session")).toBeVisible();
  await expect(row.getByText("🚀")).toBeHidden();

  await icon();
  await screen.getByRole("button", "Custom emoji…").tap();
  await expect(custom).toBeVisible();
  await expect(set).toBeDisabled();
  await custom.fill("🐧");
  await expect(set).toBeEnabled();
  await set.tap();
  await expect(row.getByText("🐧")).toBeVisible();
  await hui.reload();
  await hui.sessionList();
  await expect(row.getByText("🐧")).toBeVisible();
});

test("the Icon panel's grid and custom emoji entry stay inside a phone screen", { tags: ["SESS-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Phone icon" });
  const phone = await hui.phoneScreen();
  const inside = async (control: ReturnType<typeof screen.getByLabel>) => {
    await expect(control).toBeVisible();
    await expect.poll(async () => {
      const box = await control.boundingBox();
      return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= phone.width && box.y + box.height <= phone.height;
    }).toBe(true);
  };
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open navigation").tap();
  await hui.sessionMenu("Phone icon");
  await screen.getByText("Icon", { exact: true, visible: true }).tap();
  for (const control of [screen.getByRole("button", "Set icon 🦞"), screen.getByRole("button", "Set icon 🎯"), screen.getByRole("button", "No icon"), screen.getByRole("button", "Custom emoji…")]) await inside(control);
  await screen.getByRole("button", "Custom emoji…").tap();
  for (const control of [screen.getByLabel("Custom emoji", { visible: true }), screen.getByRole("button", "Set"), screen.getByRole("button", "Back")]) await inside(control);
});
