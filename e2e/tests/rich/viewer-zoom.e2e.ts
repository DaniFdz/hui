/** The media viewer's zoom and pan: Zoom in and Zoom out move the level shown and pressing it fits again, the wheel zooms around the pointer, a drag pans, a double-click toggles zoom, and on a touch screen a two-finger pinch zooms around its midpoint before one finger drags alone (RICH-019). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const FLOWCHART = "flowchart LR\n  Idea[Idea] --> Model{Useful model}\n  Model -->|yes| Explain[Explain clearly]\n  Model -->|no| Prose[Use concise prose]\n";
const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;

const centre = async (target: Locator) => {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function open(screen: Screen, hui: Hui) {
  const session = await hui.createSession({ title: "Zoom and pan" });
  await hui.prompt(session, say(`\`\`\`mermaid\n${FLOWCHART}\`\`\``));
  await hui.open(`/sessions/${session.id}`);
  const embed = screen.getByTestId("transcript").getByLabel("Mermaid diagram");
  await expect(embed.getByRole("button", "Open mermaid diagram viewer")).toBeVisible();
  await embed.tap();
  const viewer = screen.getByLabel("Mermaid diagram viewer: mermaid-diagram");
  await expect(viewer).toBeVisible();
  const level = viewer.getByRole("button", /^Zoom \d+%\. Fit to screen$/u);
  await expect(level).toBeEnabled();
  return { viewer, stage: screen.getByLabel("Mermaid diagram: scroll or pinch to zoom, drag to pan"), level, zoom: async () => Number(/\d+/u.exec((await level.getAttribute("aria-label"))!)![0]) };
}

test("The viewer zooms around the pointer, pans by drag, toggles by double-click, fits again from the level, and pinches to zoom before one finger pans", { tags: ["RICH-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { viewer, stage, level, zoom } = await open(screen, hui);
  const fit = await zoom();

  await screen.getByRole("button", "Zoom in").tap();
  await expect.poll(zoom).toBeGreaterThan(fit);
  const zoomedIn = await zoom();
  await screen.getByRole("button", "Zoom out").tap();
  await expect.poll(zoom).toBeLessThan(zoomedIn);
  await level.tap();
  await expect.poll(zoom).toBe(fit);

  const idea = stage.getByText("Idea");
  const anchored = await centre(idea);
  const middle = await centre(stage);
  expect(Math.hypot(anchored.x - middle.x, anchored.y - middle.y)).toBeGreaterThan(20);
  await hui.wheel(idea, -120);
  await expect.poll(zoom).toBeGreaterThan(fit);
  await expect.poll(async () => Math.hypot((await centre(idea)).x - anchored.x, (await centre(idea)).y - anchored.y)).toBeLessThan(3);
  await level.tap();
  await expect.poll(zoom).toBe(fit);

  const model = stage.getByText("Useful model");
  await model.doubleTap();
  await expect.poll(zoom).toBeGreaterThan(fit);
  await model.doubleTap();
  await expect.poll(zoom).toBe(fit);

  const dragFrom = await centre(idea);
  const dragTo = await centre(stage.getByText("Explain clearly"));
  await hui.drag(idea, stage.getByText("Explain clearly"), async () => {});
  await expect.poll(async () => Math.hypot((await centre(idea)).x - dragTo.x, (await centre(idea)).y - dragTo.y)).toBeLessThan(3);
  expect(Math.hypot(dragTo.x - dragFrom.x, dragTo.y - dragFrom.y)).toBeGreaterThan(20);
  await expect.poll(zoom).toBe(fit);
  await level.tap();
  await expect.poll(async () => Math.hypot((await centre(idea)).x - dragFrom.x, (await centre(idea)).y - dragFrom.y)).toBeLessThan(3);

  const pinched = await centre(model);
  await hui.pinch(model, { from: 100, to: 200 });
  await expect.poll(zoom).toBeGreaterThan(fit);
  await expect.poll(async () => Math.hypot((await centre(model)).x - pinched.x, (await centre(model)).y - pinched.y)).toBeLessThan(3);
  const scale = await zoom();

  await hui.fingerDrag({ dx: 80, dy: 0 });
  await expect(viewer).toBeVisible();
  await expect.poll(async () => (await centre(model)).x).toBeGreaterThan(pinched.x + 40);
  await expect.poll(zoom).toBe(scale);
});