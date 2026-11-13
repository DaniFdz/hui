/** Account on the Contributions page narrows both charts and the year list to one signed-in login, remembers it after a reload, and shows All accounts while that login is not signed in (BOARD-046). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Account lists every signed-in login, choosing one narrows both charts and the year list to it, the choice survives a reload, and a login that is no longer signed in shows All accounts until it returns", { tags: ["BOARD-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const accounts = join(world.runDir, "gh", "accounts");
  await hui.open(`${world.url}/contributions`);

  const total = screen.getByText(/^[\d,]+ commits in the last year$/u);
  const account = screen.getByRole("button", { name: /^Account: /u });
  const years = screen.getByRole("navigation", { name: "Year" });
  const choose = async (login: string) => {
    await account.tap();
    await screen.getByRole("option", { name: login, exact: true }).tap();
    await expect(account).toHaveAccessibleName(`Account: ${login}`);
  };
  await expect(account).toHaveAccessibleName("Account: All accounts");
  await expect(total).toBeVisible();

  // Each signed-in login is offered, and choosing one narrows both charts and the year list to it.
  await account.tap();
  await expect(screen.getByRole("option", { name: "hui-e2e", exact: true })).toBeVisible();
  await screen.getByRole("option", { name: "hui-e2e-personal", exact: true }).tap();
  await expect(account).toHaveAccessibleName("Account: hui-e2e-personal");
  await expect(years.getByRole("button", { name: "2019", exact: true })).toBeVisible();
  const personal = await hui.textOf(total);
  await choose("hui-e2e");
  // That login was created in 2022, so the elder one's 2019 is no longer on offer.
  await expect(years.getByRole("button", { name: "2022", exact: true })).toBeVisible();
  await expect(years.getByRole("button", { name: "2019", exact: true })).toBeHidden();
  await expect.poll(() => hui.textOf(total)).not.toBe(personal);
  const one = await hui.textOf(total);

  // The reload reads the remembered login back, and only its activity.
  await hui.reload();
  await expect(account).toHaveAccessibleName("Account: hui-e2e");
  await expect.poll(() => hui.textOf(total)).toBe(one);

  // Signed out of `gh`, the remembered login is not the selection: the page shows everyone still signed in.
  await writeFile(accounts, "hui-e2e-personal\n");
  await screen.getByRole("button", "Refresh").tap();
  await expect(account).toHaveAccessibleName("Account: All accounts");
  await expect.poll(() => hui.textOf(total)).toBe(personal);
  await expect(years.getByRole("button", { name: "2019", exact: true })).toBeVisible();

  // Back in `gh`, the remembered login is the selection again.
  await writeFile(accounts, "hui-e2e\nhui-e2e-personal\n");
  await screen.getByRole("button", "Refresh").tap();
  await expect(account).toHaveAccessibleName("Account: hui-e2e");
  await expect.poll(() => hui.textOf(total)).toBe(one);
});
