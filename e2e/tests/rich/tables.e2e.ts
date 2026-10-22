/** A reply's pipe tables keep their header cells, inline formatting, rows and column alignment, and a table wider than a phone scrolls inside its own Table region while the page stays put (RICH-004, RICH-005). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const USAGE = "| Program | Times |\n|---|---:|\n| `confetti` | 23 |\n| `rapid` | 19 |\n| `kubectl` | 15 |\n| `ddr` | 13 |\n| `ddtool` direct | 8 |\n| `bzl` | 5 |";
const WIDE = "| Program | Command | Status | Notes |\n|:--|:--|:-:|--:|\n| **confetti** | `confetti --environment=development --report=summary` | Ready | 23 |\n| rapid | `rapid --workspace=example --format=markdown` | Done | 19 |";

async function tables(screen: Screen, hui: Hui) {
  const session = await hui.createSession({ title: "Tables" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(`## Program usage\n\n${USAGE}\n\n### Wide table\n\n${WIDE}`).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return {
    transcript,
    usage: transcript.getByLabel("Table").filter({ hasText: "Times" }),
    wide: transcript.getByLabel("Table").filter({ hasText: "Command" }),
  };
}

const edges = async (target: Locator) => {
  const { x, width } = (await target.boundingBox())!;
  return { left: x, right: x + width };
};

test("A pipe table keeps its header cells, inline code, bold, every row and number, and each column's alignment", { tags: ["RICH-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { usage, wide } = await tables(screen, hui);
  await expect(usage).toHaveText("Program Times confetti 23 rapid 19 kubectl 15 ddr 13 ddtool direct 8 bzl 5");
  await expect(usage.getByText("|", { exact: false })).toBeHidden();
  for (const header of [usage.getByText("Program", { exact: true }), usage.getByText("Times", { exact: true }), wide.getByText("Notes", { exact: true })]) {
    expect((await hui.look(header)).weight).toBeGreaterThanOrEqual(600);
  }
  for (const number of ["23", "19", "15", "13", "8", "5"]) {
    const look = await hui.look(usage.getByText(number, { exact: true }));
    expect([look.align, look.weight]).toEqual(["right", 400]);
  }
  expect((await hui.look(usage.getByText("kubectl", { exact: true }))).fonts.join(" ")).toMatch(/mono/iu);

  const bold = await hui.look(wide.getByText("confetti", { exact: true }));
  expect(bold.weight).toBeGreaterThanOrEqual(600);
  await expect(wide.getByText("**", { exact: false })).toBeHidden();
  expect((await hui.look(wide.getByText("confetti --environment=development --report=summary", { exact: true }))).fonts.join(" ")).toMatch(/mono/iu);
  expect((await hui.look(wide.getByText("rapid", { exact: true }))).align).toBe("left");
  expect((await hui.look(wide.getByText("Ready", { exact: true }))).align).toBe("center");
  expect((await hui.look(wide.getByText("Done", { exact: true }))).align).toBe("center");
  expect((await hui.look(wide.getByText("19", { exact: true }))).align).toBe("right");
});

test("On a phone a table that fits stays inside the content, and a wider one scrolls inside its Table region while the page does not", { tags: ["RICH-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  const { transcript, usage, wide } = await tables(screen, hui);
  const content = await edges(transcript);
  const fitting = await edges(usage);
  expect(fitting.left).toBeGreaterThanOrEqual(content.left);
  expect(fitting.right).toBeLessThanOrEqual(Math.min(content.right, phone.width));
  expect((await edges(usage.getByText("Times", { exact: true }))).right).toBeLessThanOrEqual(fitting.right);

  const region = await edges(wide);
  expect(region.right).toBeLessThanOrEqual(phone.width);
  const notes = wide.getByText("Notes", { exact: true });
  const before = await edges(notes);
  expect(before.right).toBeGreaterThan(region.right);
  await hui.scrollSideways(wide);
  await expect.poll(async () => (await edges(notes)).left).toBeLessThan(before.left);
  expect(await edges(wide)).toEqual(region);
  expect(await hui.overflowX()).toBe(0);
});
