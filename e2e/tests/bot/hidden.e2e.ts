/** A row's ⋯ → Hide takes a bot out of the roster, Show hidden (N) lists it with a Hidden tag and Unhide puts it back, and with every bot hidden the roster says so (BOT-013). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** A roster row's ⋯: a phone draws it on the row, and the wide layout reveals it to the pointer first. */
const rowMenu = async (screen: Screen, hui: Hui, name: string): Promise<Locator> => {
  const menu = screen.getByRole("button", `Actions for ${name}`);
  if (!(await hui.reachable(menu))) await hui.peek(screen.getByLabel(new RegExp(`^${name},`, "u")));
  await expect(menu).toBeVisible();
  return menu;
};

test("Hide takes a bot off the roster, Show hidden lists it with a Hidden tag, Unhide puts it back and its toggle goes, and every bot hidden says so", { tags: ["BOT-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Napper", soul: "# Who I am\nA terse fixture bot.\n" });
  await hui.open("/");
  // A phone keeps the sidebar, and so the roster, in the navigation drawer; on the wide layout this is nothing.
  await hui.sessionList();
  await screen.getByRole("tab", "Bots").tap();
  const row = screen.getByLabel(/^Napper,/u);
  await expect(row).toBeVisible();

  await (await rowMenu(screen, hui, "Napper")).tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Napper is hidden. Show hidden lists it again.")).toBeVisible();
  await expect(row).toBeHidden();
  const toggle = screen.getByRole("button", "Show hidden (1)");
  await expect(toggle).toBeVisible();

  await toggle.tap();
  await expect(row).toBeVisible();
  await expect(row.getByText("Hidden")).toBeVisible();

  await (await rowMenu(screen, hui, "Napper")).tap();
  await screen.getByText("Unhide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Napper is back in the roster.")).toBeVisible();
  await expect.poll(async () => screen.getByText(/^Show hidden/u).count()).toBe(0);

  await (await rowMenu(screen, hui, "Napper")).tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  // The seeded Chief of Staff is a bot too: hide it before the roster can say every bot is hidden.
  const chief = screen.getByLabel(/^Chief of Staff,/u);
  await expect(chief).toBeVisible();
  await (await rowMenu(screen, hui, "Chief of Staff")).tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Every bot is hidden.")).toBeVisible();
  await expect(screen.getByRole("button", "Show hidden (2)")).toBeVisible();

  // The roster is shared by the suite: unhide whatever this test hid, so the Chief of Staff is back for the next test.
  const hiddenBots = (await hui.api<{ bots: Array<{ id: string; hidden?: boolean }> }>("GET", "/__hui/bots")).bots.filter((bot) => bot.hidden);
  for (const bot of hiddenBots) await hui.api("PATCH", `/__hui/bots/${bot.id}`, { hidden: false });
});
