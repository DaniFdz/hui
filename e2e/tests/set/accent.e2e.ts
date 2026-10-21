/** An accent recolours highlights over any theme and Current accent names it; Theme default restores the theme's own, and a colour too faint for the mode is moved until it reads (SET-007). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const rgb = (color: string) => color.match(/[\d.]+/gu)!.slice(0, 3).map((value) => Math.round(Number(value) * (color.startsWith("color(srgb") ? 255 : 1))) as [number, number, number];
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

test("an accent recolours the highlights over any theme, Current accent names it, and Theme default restores the theme's own", { tags: ["SET-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const accents = screen.getByLabel("Accent color");
  const swatch = (name: string, pressed = true) => accents.getByRole("button", { name, pressed });
  const title = screen.getByTestId("settings-page-title");
  const highlight = screen.getByLabel("Text size").getByRole("button", { name: "Default 100%", pressed: true });

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await expect(swatch("Theme default")).toBeVisible();
  await expect(screen.getByText("Theme default", { exact: true })).toBeVisible();
  const claw = (await hui.look(title)).color;

  await accents.getByRole("button", "Blue").tap();
  await expect(swatch("Blue")).toBeVisible();
  await expect(swatch("Theme default", false)).toBeVisible();
  await expect(screen.getByText("Blue", { exact: true })).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).color).toBe("rgb(91, 156, 246)");
  expect(rgb((await hui.look(highlight)).background)).toEqual([91, 156, 246]);

  await screen.getByRole("button", "Dracula").tap();
  await expect(screen.getByRole("button", { name: "Dracula", pressed: true })).toBeVisible();
  await expect(swatch("Blue")).toBeVisible();
  const [r, g, b] = rgb((await hui.look(title)).color);
  expect(b > g && g > r && r < 120).toBe(true);

  await screen.getByLabel("Custom accent color").fill("#2dd4bf");
  await expect(screen.getByText("Custom color", { exact: true })).toBeVisible();
  await expect(swatch("Blue", false)).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).color).toBe("rgb(45, 212, 191)");

  await accents.getByRole("button", "Theme default").tap();
  await expect(swatch("Theme default")).toBeVisible();
  await expect(screen.getByText("Theme default", { exact: true })).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).color).toBe("rgb(189, 147, 249)");
  expect(claw).not.toBe("rgb(189, 147, 249)");

  await hui.reload();
  await expect(swatch("Theme default")).toBeVisible();
  expect((await hui.look(title)).color).toBe("rgb(189, 147, 249)");
});

test("an accent too faint for a light page is darkened just until it reads, and kept as chosen on a dark one", { tags: ["SET-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const title = screen.getByTestId("settings-page-title");
  const amber = "rgb(245, 185, 66)";

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await screen.getByLabel("Accent color").getByRole("button", "Amber").tap();
  await expect.poll(async () => (await hui.look(title)).color).toBe(amber);

  await hui.deviceAppearance("light");
  await expect.poll(async () => (await hui.look(title)).color).not.toBe(amber);
  const { color, background } = await hui.look(title);
  expect(contrast(amber, background)).toBeLessThan(4.5);
  expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(color, background)).toBeLessThan(5.5);
  const [r, g, b] = rgb(color);
  expect(r > g && g > b).toBe(true);
});
