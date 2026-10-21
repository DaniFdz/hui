/** The session menu's Icon panel sets a preset, custom or no icon on the session row, keeps it across a reload, and fits a phone screen (SESS-033). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Icon sets a preset, a custom emoji or no icon, and the icon survives a reload", { tags: ["SESS-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = screen.getByLabel("Iconic session, status idle, tool durable, stage investigation");
  const icon = async () => {
    await hui.sessionMenu("Iconic session");
    await screen.getByText("Icon", { exact: true, visible: true }).tap();
  };
  const custom = screen.getByLabel("Custom emoji", { visible: true });
  const set = screen.getByRole("button", "Set");
  const session = await hui.createSession({ title: "Iconic session" });
  await hui.open(`/sessions/${session.id}`);

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
  await expect(row.getByText("🐧")).toBeVisible();
});

test("the Icon panel's custom emoji entry stays inside a phone screen", { tags: ["SESS-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Phone icon" });
  const phone = await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open navigation").tap();
  await hui.sessionMenu("Phone icon");
  await screen.getByText("Icon", { exact: true, visible: true }).tap();
  await screen.getByRole("button", "Custom emoji…").tap();
  for (const control of [screen.getByLabel("Custom emoji", { visible: true }), screen.getByRole("button", "Set"), screen.getByRole("button", "Back")]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(phone.height);
  }
});
