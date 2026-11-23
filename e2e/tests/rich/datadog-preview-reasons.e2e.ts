/** Why a Datadog link has no card, driven against the `datadog` fixture world (`hui.world("datadog")`: the fake `pup`
 * with `e2e-prod` signed in and its own dashboards): a dashboard link on a site no org is configured for says so, a
 * dashboard no configured org can read says it is not found, and a `pup` that fails in a way HUI does not recognize
 * says the preview is unavailable. Each card keeps its Datadog link (RICH-038).
 *
 * The fourth reason, *The Datadog CLI (pup) is required for previews.*, needs a gateway whose orgs exist but whose
 * `pup` does not: this world always installs the fake `pup` (HUI_PUP_CLI), and a test must not make the shared checkout's
 * fixture executable unreadable for the other tests running beside it, so that clause has no route here yet.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type DatadogConnection = { cli: { installed: boolean }; orgs: { name: string; site: string; status: string }[] };
type World = Awaited<ReturnType<Hui["world"]>>;

/** Removes a world's session once the assertions are done: a runtime still writing into the world's agent directory while
 * the fixture stops and removes that directory makes the world's own cleanup race it. */
const settle = async (world: World, ...sessions: { id: string }[]) => {
  for (const session of sessions) await world.api("DELETE", `/__hui/sessions/${session.id}`);
};

test("A Datadog link that cannot be previewed keeps its link and says why: the site has no org, no org can read the dashboard, or the preview is unavailable", { tags: ["RICH-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("datadog");
  // Only app.datadoghq.com has an org, so a link on another Datadog site has nowhere to be read.
  await world.api("POST", "/__hui/datadog/orgs", { name: "e2e-prod", site: "app.datadoghq.com" });
  await expect.poll(async () => (await world.api<DatadogConnection>("GET", "/__hui/datadog")).orgs.map(({ name }) => name),
    { message: "the world's gateway never kept e2e-prod" }).toEqual(["e2e-prod"]);

  const elsewhere = "https://app.datadoghq.eu/dashboard/zzz-999-zzz/not-here";
  const unknown = "https://app.datadoghq.com/dashboard/zzz-999-zzz/unknown";
  const session = await world.createSession({ title: "Two dashboards HUI cannot draw" });
  await world.prompt(session, `These never load for me: ${elsewhere} and ${unknown}`);
  await hui.open(`${world.url}/sessions/${session.id}`);

  // Two cards in reading order, each still a link to its Datadog page.
  const links = screen.getByLabel("Datadog links");
  await expect(links.getByRole("listitem")).toHaveCount(2);
  const unconfigured = links.getByRole("listitem").nth(0);
  const notFound = links.getByRole("listitem").nth(1);
  await expect(unconfigured.getByRole("link", { name: "Dashboard zzz-999-zzz" })).toHaveAttribute("href", elsewhere);
  await expect(notFound.getByRole("link", { name: "Dashboard zzz-999-zzz" })).toHaveAttribute("href", unknown);
  await expect(unconfigured.getByRole("link", { name: "Dashboard zzz-999-zzz" })).toHaveAttribute("target", "_blank");

  // The reasons, in the words the cards use: the site has no org of its own, and pup's site does but that org cannot
  // read this dashboard.
  await expect(unconfigured.getByText("Add a Datadog org for app.datadoghq.eu in Settings → Integrations to preview it.", { exact: true })).toBeVisible();
  await expect(notFound.getByText("Not found in your Datadog orgs for app.datadoghq.com.", { exact: true })).toBeVisible();

  // A pup that fails in a way HUI does not recognize — here its session registry cannot be read — leaves the card
  // saying so rather than a stale loading line. A new link, so the gateway's remembered answer cannot stand in for it.
  await writeFile(join(world.runDir, "pup", "sessions.json"), "{ not a session registry");
  const unavailable = "https://app.datadoghq.com/dashboard/qqq-111-qqq/another";
  const other = await world.createSession({ title: "A dashboard pup cannot answer for" });
  await world.prompt(other, `Still nothing: ${unavailable}`);
  await hui.open(`${world.url}/sessions/${other.id}`);
  const unavailableCard = links.getByRole("listitem");
  await expect(unavailableCard).toHaveCount(1);
  await expect(unavailableCard.getByRole("link", { name: "Dashboard qqq-111-qqq" })).toHaveAttribute("href", unavailable);
  await expect(unavailableCard.getByText("Datadog preview unavailable.", { exact: true })).toBeVisible();
  await settle(world, session, other);
});
