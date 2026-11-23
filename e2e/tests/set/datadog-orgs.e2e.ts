/**
 * Settings → Integrations → Datadog against the fixture's Datadog world (`hui.world('datadog')`: the fake `pup` with
 * one signed-in org, one that needs a sign-in, and an `approve`/`deny` file that finishes a pending sign-in the way the
 * operator answers pup's browser prompt): the Add org dialog with its site list and pup's own logins, the duplicate it
 * refuses, and an org added without a session signing in at once, being cancelled, confirmed and finally failing
 * (SET-026).
 *
 * The world seeds no orgs in HUI's own list, so the section starts on “No orgs yet”.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type DatadogConnection = { cli: { installed: boolean; version?: string }; orgs: { name: string; site: string; status: string }[]; pupOrgs: { name: string; site: string }[]; login: { phase: string } };
type World = Awaited<ReturnType<Hui["world"]>>;

const SITE = "app.datadoghq.com";
/** The fake pup's approval and refusal files (`e2e/fixtures/pup-cli-fixture.mjs`), which end a pending sign-in. */
const approved = (world: World) => writeFile(join(world.runDir, "pup", "approve"), "");
const denied = (world: World) => writeFile(join(world.runDir, "pup", "deny"), "");

const connection = (world: World) => world.api<DatadogConnection>("GET", "/__hui/datadog");
const names = async (world: World) => (await connection(world)).orgs.map(({ name }) => name);
/** The line each configured org draws: its site and whether pup has a session for it. */
const orgLine = (page: Locator, status: string) => page.getByText(`${SITE} · ${status}`, { exact: true });

/** Opens Settings → Integrations once the Datadog section has read pup. */
const openDatadog = async (screen: Screen, hui: Hui, world: World) => {
  await hui.open(`${world.url}/settings/integrations`);
  const page = screen.getByTestId("settings-page");
  await expect(page.getByRole("heading", { name: "Datadog", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No orgs", { exact: true })).toBeVisible();
  return page;
};

/** Opens the Add org dialog, names an org in it, and answers with the dialog. */
const addOrg = async (screen: Screen, page: Locator, name: string) => {
  await page.getByRole("button", { name: "Add org", exact: true }).tap();
  const dialog = screen.getByRole("dialog", { name: "Add Datadog org" });
  await expect(dialog).toBeVisible();
  if (name) await dialog.getByLabel("Org name", { exact: true }).fill(name);
  return dialog;
};

test("Add org offers pup's sites with the default preselected, refuses an org already listed, and adds each org, starting the sign-in pup has no session for and reporting it once approved", { tags: ["SET-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("datadog");
  const page = await openDatadog(screen, hui, world);

  // No org yet: the section says so and offers the dialog.
  await expect(page.getByText("No orgs yet", { exact: true })).toBeVisible();

  // The dialog preselects the default site, lists the other public ones, and adds a required Host for Other host….
  let dialog = await addOrg(screen, page, "");
  const site = dialog.getByLabel("Site", { exact: true });
  await expect(site).toHaveValue(SITE);
  await expect(screen.getByRole("option", { name: `${SITE} (default)`, selected: true })).toHaveCount(1);
  await expect(screen.getByRole("option", { name: "app.datadoghq.eu" })).toHaveCount(1);
  await expect(screen.getByRole("option", { name: "app.datad0g.com" })).toHaveCount(1);
  await expect(dialog.getByLabel("Host", { exact: true })).toHaveCount(0);
  await site.selectOption({ value: "other" });
  await expect(dialog.getByLabel("Host", { exact: true })).toHaveAttribute("required");
  await site.selectOption({ value: SITE });
  await expect(dialog.getByLabel("Host", { exact: true })).toHaveCount(0);
  // pup already has logins for this site, and the dialog says so beside its name suggestions.
  await expect(dialog.getByText(/pup already has logins for this site; pick one from the suggestions\.$/u)).toBeVisible();

  // An org pup already has a session for is added straight away and survives a reload.
  await dialog.getByLabel("Org name", { exact: true }).fill("e2e-prod");
  await dialog.getByRole("button", { name: "Add org", exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Added e2e-prod." })).toBeVisible();
  await expect(orgLine(page, "Connected")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove e2e-prod" })).toBeVisible();
  expect((await connection(world)).orgs).toEqual([{ name: "e2e-prod", site: SITE, status: "connected" }]);
  await hui.reload();
  await expect(page.getByRole("button", { name: "Remove e2e-prod" })).toBeVisible();
  await expect(orgLine(page, "Connected")).toHaveCount(1);
  expect(await names(world)).toEqual(["e2e-prod"]);

  // An org already in the list keeps the dialog open with its reason.
  dialog = await addOrg(screen, page, "e2e-prod");
  await dialog.getByRole("button", { name: "Add org", exact: true }).tap();
  await expect(dialog.getByRole("alert").filter({ hasText: "That org is already in the list." })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await names(world)).toEqual(["e2e-prod"]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(dialog).toBeHidden();

  // An org pup has no session for starts its sign-in at once; Cancel leaves it signed out.
  dialog = await addOrg(screen, page, "e2e-fresh");
  await dialog.getByRole("button", { name: "Add org", exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Signing in to e2e-fresh", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for sign-in…", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Approve the sign-in in your browser…/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open sign-in page/u })).toHaveAttribute("href", `https://${SITE}/oauth2/v1/authorize?client_id=fixture`);
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page.getByText("Signing in to e2e-fresh", { exact: true })).toBeHidden();
  await expect(orgLine(page, "Sign in needed")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove e2e-fresh" })).toBeVisible();
  expect((await connection(world)).login.phase).toBe("idle");

  // A sign-in pup finishes reports the org as connected, and the header counts the ones still waiting.
  dialog = await addOrg(screen, page, "e2e-new");
  await dialog.getByRole("button", { name: "Add org", exact: true }).tap();
  await expect(page.getByText("Signing in to e2e-new", { exact: true })).toBeVisible();
  await approved(world);
  await expect(page.getByRole("status").filter({ hasText: "Signed in to e2e-new." })).toBeVisible({ timeout: 30_000 });
  await expect(orgLine(page, "Connected")).toHaveCount(2);
  await expect(orgLine(page, "Sign in needed")).toHaveCount(1);
  await expect(page.getByText("1 org needs sign-in", { exact: true })).toBeVisible();
  expect((await connection(world)).orgs.map(({ name, status }) => ({ name, status }))).toEqual([
    { name: "e2e-prod", status: "connected" },
    { name: "e2e-fresh", status: "signed_out" },
    { name: "e2e-new", status: "connected" },
  ]);

  // A sign-in that does not finish shows pup's reason with Try again and Dismiss, which clears the failure.
  dialog = await addOrg(screen, page, "e2e-bad");
  await dialog.getByRole("button", { name: "Add org", exact: true }).tap();
  await expect(page.getByText("Signing in to e2e-bad", { exact: true })).toBeVisible();
  await denied(world);
  await expect(page.getByText("Sign-in to e2e-bad did not finish", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alert").filter({ hasText: "OAuth error: access_denied: The user denied the request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).tap();
  await expect(page.getByText("Sign-in to e2e-bad did not finish", { exact: true })).toBeHidden();
  await expect(orgLine(page, "Sign in needed")).toHaveCount(2);
  expect((await connection(world)).login.phase).toBe("idle");
});
