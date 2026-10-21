/** An accent recolours highlights and the keyboard focus ring over any theme and Current accent names it; Theme default restores the theme's own, and a colour too faint for the mode is moved until it reads (SET-007, SET-076). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const luminance = (color: number[]) => {
  const [r, g, b] = color.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
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
  await expect.poll(async () => (await hui.look(title)).color).toEqual([91, 156, 246]);
  expect((await hui.look(highlight)).background).toEqual([91, 156, 246]);

  await screen.getByRole("button", "Dracula").tap();
  await expect(screen.getByRole("button", { name: "Dracula", pressed: true })).toBeVisible();
  await expect(swatch("Blue")).toBeVisible();
  const [r, g, b] = (await hui.look(title)).color;
  expect(b > g && g > r && r < 120).toBe(true);

  await screen.getByLabel("Custom accent color").fill("#2dd4bf");
  await expect(screen.getByText("Custom color", { exact: true })).toBeVisible();
  await expect(swatch("Blue", false)).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).color).toEqual([45, 212, 191]);

  await accents.getByRole("button", "Theme default").tap();
  await expect(swatch("Theme default")).toBeVisible();
  await expect(screen.getByText("Theme default", { exact: true })).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).color).toEqual([189, 147, 249]);
  expect(claw).not.toEqual([189, 147, 249]);

  await hui.reload();
  await expect(swatch("Theme default")).toBeVisible();
  expect((await hui.look(title)).color).toEqual([189, 147, 249]);
});

test("an accent too faint for a light page is darkened just until it reads, and kept as chosen on a dark one", { tags: ["SET-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const title = screen.getByTestId("settings-page-title");
  const amber = [245, 185, 66];

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await screen.getByLabel("Accent color").getByRole("button", "Amber").tap();
  await expect.poll(async () => (await hui.look(title)).color).toEqual(amber);

  await hui.deviceAppearance("light");
  await expect.poll(async () => (await hui.look(title)).color).not.toEqual(amber);
  const { color, background } = await hui.look(title);
  expect(contrast(amber, background)).toBeLessThan(4.5);
  expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(color, background)).toBeLessThan(5.5);
  const [r, g, b] = color;
  expect(r > g && g > b).toBe(true);
});

test("a control reached from the keyboard draws its focus ring in the accent over any theme, and in the theme's own after Theme default", { tags: ["SET-076"], platforms: ["web"] }, async ({ screen, hui }) => {
  const accents = screen.getByLabel("Accent color");
  const rings = async () => {
    await accents.getByRole("button", "Blue").press("Tab");
    const swatch = (await hui.look(accents.getByRole("button", "Violet"))).ring;
    await screen.getByLabel("Search settings").press("Tab");
    return [swatch, (await hui.look(screen.getByTestId("settings-page-link").filter({ hasText: "Appearance" }))).ring];
  };
  const blue = [91, 156, 246];

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await accents.getByRole("button", "Blue").tap();
  await expect(accents.getByRole("button", { name: "Blue", pressed: true })).toBeVisible();
  await expect.poll(rings).toEqual([blue, blue]);

  await screen.getByRole("button", "Miami").tap();
  await expect(screen.getByRole("button", { name: "Miami", pressed: true })).toBeVisible();
  await expect.poll(async () => (await hui.look(screen.getByTestId("settings-page-title"))).background).toEqual([20, 15, 30]);
  expect(await rings()).toEqual([blue, blue]);

  await accents.getByRole("button", "Theme default").tap();
  await expect(accents.getByRole("button", { name: "Theme default", pressed: true })).toBeVisible();
  await expect.poll(rings).toEqual([[244, 114, 182], [244, 114, 182]]);
});
