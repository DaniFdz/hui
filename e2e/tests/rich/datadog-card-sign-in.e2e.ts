/** Signing in to a Datadog org from a chat card, driven against the `datadog` fixture world (`hui.world("datadog")`: the
 * fake `pup`, whose `e2e-stale` session cannot be renewed and whose `approve`/`deny` files finish a sign-in the way the
 * operator answers pup's browser prompt): a card whose org's pup session ended offers **Sign in to e2e-stale** and says
 * it opens a browser on the computer running HUI; pressing it waits on pup, a refused sign-in puts pup's reason on the
 * card, and once approved every Datadog card of that message reloads filled in (RICH-039). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type DatadogConnection = { cli: { installed: boolean }; orgs: { name: string; site: string; status: string }[]; login: { phase: string } };
type World = Awaited<ReturnType<Hui["world"]>>;

const SITE = "app.datadoghq.com";
/** The fake pup's own dashboard for `e2e-stale`, and its one widget (`e2e/visual-verification.mjs`). */
const widgetUrl = `https://${SITE}/dashboard/stl-123-xyz/legacy?tile_focus=7`;
const dashboardUrl = `https://${SITE}/dashboard/stl-123-xyz/legacy`;
/** The fake pup's approval and refusal files (`e2e/fixtures/pup-cli-fixture.mjs`), which end a pending sign-in. */
const approved = (world: World) => writeFile(join(world.runDir, "pup", "approve"), "");
const denied = (world: World) => writeFile(join(world.runDir, "pup", "deny"), "");

/** Removes the world's session once the assertions are done: a runtime still writing into the world's agent directory
 * while the fixture stops and removes that directory makes the world's own cleanup race it. */
const settle = async (world: World, session: { id: string }) => {
  await world.api("DELETE", `/__hui/sessions/${session.id}`);
};

test("A card whose org's pup session ended offers Sign in to e2e-stale, waits on the sign-in, shows pup's reason when it is refused, and fills every card of the message in once it is approved", { tags: ["RICH-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("datadog");
  // Adding e2e-stale starts a sign-in at once, because pup's session for it cannot be renewed; cancelling leaves the org
  // in HUI with a session pup has to replace, which is the card's reason.
  await world.api("POST", "/__hui/datadog/orgs", { name: "e2e-stale", site: SITE });
  await world.api("DELETE", "/__hui/datadog/login");
  await expect.poll(async () => (await world.api<DatadogConnection>("GET", "/__hui/datadog")).orgs,
    { message: "the world's gateway never listed e2e-stale as needing a sign-in" }).toEqual([{ name: "e2e-stale", site: SITE, status: "signed_out" }]);

  const session = await world.createSession({ title: "The legacy dashboard" });
  await world.prompt(session, `Check ${widgetUrl} against ${dashboardUrl} before the migration.`);
  await hui.open(`${world.url}/sessions/${session.id}`);

  // Both cards say which org to sign in to, offer it once, and say where the browser opens.
  const links = screen.getByLabel("Datadog links");
  await expect(links.getByRole("listitem")).toHaveCount(2);
  const widget = links.getByRole("listitem").nth(0);
  const dashboard = links.getByRole("listitem").nth(1);
  await expect(widget.getByRole("link", { name: "Widget on dashboard stl-123-xyz" })).toHaveAttribute("href", widgetUrl);
  await expect(dashboard.getByRole("link", { name: "Dashboard stl-123-xyz" })).toHaveAttribute("href", dashboardUrl);
  for (const card of [widget, dashboard]) {
    await expect(card.getByText("Sign in to e2e-stale to preview it.", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Sign in to e2e-stale", exact: true })).toBeVisible();
    await expect(card.getByText("Opens a browser on the computer running HUI.", { exact: true })).toBeVisible();
  }

  // Pressing it waits on pup: the sign-in is one for the message, so both cards of the org say so and refuse a second.
  await widget.getByRole("button", { name: "Sign in to e2e-stale", exact: true }).tap();
  await expect(links.getByRole("button", { name: "Waiting for sign-in…", exact: true })).toHaveCount(2);
  await expect(links.getByRole("button", { name: "Waiting for sign-in…", exact: true }).first()).toBeDisabled();
  await expect(links.getByText("Approve the sign-in in your browser…", { exact: true })).toHaveCount(2);
  expect((await world.api<DatadogConnection>("GET", "/__hui/datadog")).login.phase).toBe("pending");

  // A sign-in the operator refuses puts pup's reason on the cards, word for word, and offers it again.
  await denied(world);
  await expect(links.getByText(/OAuth error: access_denied: The user denied the request$/u)).toHaveCount(2);
  await expect(links.getByRole("button", { name: "Sign in to e2e-stale", exact: true })).toHaveCount(2);
  await expect(links.getByText("Waiting for sign-in…", { exact: true })).toHaveCount(0);

  // Approving the second attempt fills every card of the message in by itself: the widget's own title with the org, the
  // dashboard and the range, and the dashboard's title with its description.
  await links.getByRole("button", { name: "Sign in to e2e-stale", exact: true }).first().tap();
  await expect(links.getByRole("button", { name: "Waiting for sign-in…", exact: true })).toHaveCount(2);
  await approved(world);
  await expect(links.getByRole("listitem").nth(0)).toHaveAttribute("aria-label", "Datadog: Legacy error rate", { timeout: 30_000 });
  await expect(links.getByRole("listitem").nth(1)).toHaveAttribute("aria-label", "Datadog: Legacy checkout");
  await expect(widget.getByText("e2e-stale · Legacy checkout · Past 1 hour", { exact: true })).toBeVisible();
  await expect(widget.getByText("Datadog could not draw this widget.", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("e2e-stale", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("Before the migration.", { exact: true })).toBeVisible();
  await expect(links.getByText("Sign in to e2e-stale to preview it.", { exact: true })).toHaveCount(0);
  const connection = await world.api<DatadogConnection>("GET", "/__hui/datadog");
  expect(connection.orgs.map(({ name, site, status }) => ({ name, site, status }))).toEqual([{ name: "e2e-stale", site: SITE, status: "connected" }]);
  expect(connection.login.phase).toBe("idle");
  await settle(world, session);
});
