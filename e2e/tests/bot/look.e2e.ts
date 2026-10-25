/** Settings → Profile → Look opens into Face or Emoji, a face's shape, ears and colour each save at once and the roster, header and empty-chat faces follow, and choosing Face clears the emoji that replaced it (BOT-028). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const SHAPES = ["Blob", "Pebble", "Triangle", "Heart", "Cookie", "Star", "Flower", "Cloud", "Drop", "Ghost", "Pill", "Block", "Hexagon"];
const EARS = ["No ears", "Cat ears", "Bear ears", "Bunny ears", "Antenna", "Sprout", "Horns"];
const COLORS = ["Blue", "Yellow", "Magenta", "Mint", "Coral", "Lilac"];

test("Look offers thirteen shapes, ears and a colour, each saves at once and the roster, header and empty-chat faces follow, and an emoji replaces the face until Face clears it", { tags: ["BOT-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Facemaker", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const stored = async () => (await hui.api<{ bot: { avatar?: { shape?: string; ears?: string; color?: string; emoji?: string } } }>("GET", `/__hui/bots/${bot.id}`)).bot.avatar ?? {};
  const rosterFace = async () => (await hui.faces()).find((face) => face.size === "sm")!;
  const choose = async (name: string) => {
    const chip = screen.getByLabel(name);
    await chip.focus();
    await chip.press("Space");
  };

  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByText("Say hi to Facemaker")).toBeVisible();
  await expect.poll(async () => [...new Set((await hui.faces()).map((face) => face.size))]).toEqual(["sm", "md", "lg"]);
  const picked = await rosterFace();
  expect(picked.shape).not.toBe("");
  expect(picked.color).toMatch(/^#[0-9a-f]{6}$/u);

  await screen.getByRole("button", "Edit Facemaker").tap();
  const summary = screen.getByLabel(/^Look: /u);
  await summary.tap();
  for (const shape of SHAPES) await expect(screen.getByLabel(shape)).toBeVisible();
  for (const ears of EARS) await expect(screen.getByLabel(ears)).toBeVisible();
  for (const color of COLORS) await expect(screen.getByLabel(color)).toBeVisible();

  const save = await hui.intercept("PATCH", new RegExp(`/__hui/bots/${bot.id}$`, "u"));
  await choose("Star");
  await save.arrived();
  await expect(screen.getByText("Saving…")).toBeVisible();
  await save.deliver();
  await expect(screen.getByText("Saving…")).toBeHidden();
  await expect.poll(async () => (await stored()).shape).toBe("star");
  await expect.poll(async () => (await rosterFace()).shape).toBe("star");

  await choose("Bunny ears");
  await expect.poll(async () => (await stored()).ears).toBe("bunny");
  await expect.poll(async () => (await rosterFace()).ears).toBe("bunny");

  await choose("Mint");
  await expect.poll(async () => (await stored()).color).toBe("#2fc49a");
  await expect.poll(async () => (await rosterFace()).color).toBe("#2fc49a");
  await expect(summary).toHaveAttribute("aria-label", "Look: Star, Bunny ears, Mint");

  await choose("Emoji");
  const emoji = screen.getByRole("textbox", "Emoji");
  await expect(emoji).toBeVisible();
  await expect(screen.getByLabel("Star")).toBeHidden();
  await emoji.fill("🦊");
  await emoji.press("Tab");
  await expect.poll(async () => (await stored()).emoji).toBe("🦊");
  await expect.poll(async () => (await rosterFace()).emoji).toBe("🦊");
  await expect.poll(async () => (await rosterFace()).shape).toBe("");

  await choose("Face");
  await expect.poll(async () => (await stored()).emoji).toBeUndefined();
  await expect.poll(async () => (await rosterFace()).shape).toBe("star");
  await expect(summary).toHaveAttribute("aria-label", "Look: Star, Bunny ears, Mint");

  await screen.getByRole("button", "Hide the bot panel").tap();
  await expect.poll(async () => (await hui.faces()).map((face) => face.size)).toEqual(["sm", "md", "lg"]);
  expect(await hui.faces()).toEqual([
    { size: "sm", shape: "star", ears: "bunny", emoji: "", color: "#2fc49a" },
    { size: "md", shape: "star", ears: "bunny", emoji: "", color: "#2fc49a" },
    { size: "lg", shape: "star", ears: "bunny", emoji: "", color: "#2fc49a" },
  ]);
});