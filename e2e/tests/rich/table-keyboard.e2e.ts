/** A wide pipe table in a reply reaches from the keyboard: clicking it focuses its Table region, and ArrowRight
 * scrolls the table sideways while the page stays where it is (RICH-006). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const WIDE = "| Program | Command | Status | Notes |\n|:--|:--|:-:|--:|\n| **confetti** | `confetti --environment=development --report=summary` | Ready | 23 |\n| rapid | `rapid --workspace=example --format=markdown` | Done | 19 |";

const edges = async (target: Locator) => {
  const { x, width } = (await target.boundingBox())!;
  return { left: x, right: x + width };
};

test("Clicking a wide table focuses its Table region, and ArrowRight scrolls the table while the page stays put", { tags: ["RICH-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.phoneScreen();
  const session = await hui.createSession({ title: "Wide table" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(WIDE).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();

  const wide = transcript.getByLabel("Table");
  const region = await edges(wide);
  const notes = wide.getByText("Notes", { exact: true });
  const before = await edges(notes);
  expect(before.right).toBeGreaterThan(region.right);

  await wide.tap();
  await expect(wide).toBeFocused();
  await hui.keyboard.down("ArrowRight");
  await hui.keyboard.up("ArrowRight");
  await expect.poll(async () => (await edges(notes)).left).toBeLessThan(before.left);
  expect(await edges(wide)).toEqual(region);
  expect(await hui.overflowX()).toBe(0);
});
