/** Datadog dashboard and widget cards in the chat, driven against the `datadog` fixture world (`hui.world("datadog")`:
 * the fake `pup` with `e2e-prod` signed in and its `abc-123-xyz` dashboard, whose widget 42 is a graph the fake's
 * snapshot API refuses). A widget link shows the widget's title with the link's template variable filled in, the org,
 * the dashboard and the time range, and says Datadog could not draw it; a dashboard link without `tile_focus` shows
 * the dashboard's title, org and description. Both cards fit a 390 px user bubble (RICH-037). The graph itself needs a
 * snapshot image from a Datadog host, which only the demo fixture serves (`HUI_DATADOG_TEST_ORIGIN`), so the drawn
 * widget is RICH-040's business, not this file's. */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

type DatadogConnection = { cli: { installed: boolean }; orgs: { name: string; site: string; status: string }[]; login: { phase: string } };
type World = Awaited<ReturnType<import("../../fixtures/hui.ts").Hui["world"]>>;

const site = "app.datadoghq.com";
/** The fake pup's own dashboard for `e2e-prod` (`e2e/visual-verification.mjs`); widget 42 is its one graph. */
const widgetUrl = `https://${site}/dashboard/abc-123-xyz/checkout?tile_focus=42&tpl_var_env[0]=staging`;
const dashboardUrl = `https://${site}/dashboard/abc-123-xyz/checkout`;

/** Removes the world's session once the assertions are done: a runtime still writing into the world's agent directory
 * while the fixture stops and removes that directory makes the world's own cleanup race it. */
const settle = async (world: World, session: { id: string }) => {
  await world.api("DELETE", `/__hui/sessions/${session.id}`);
};

/** A card's own box, so a phone's screen can be checked against it. */
const edges = async (target: Locator) => {
  const { x, y, width, height } = (await target.boundingBox())!;
  return { left: x, right: x + width, top: y, bottom: y + height };
};

test("A dashboard widget link shows the widget's title, org, dashboard and time range and says Datadog could not draw it, a plain dashboard link shows its title, org and description, and both fit a 390 px user bubble", { tags: ["RICH-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("datadog");
  // The org HUI reads dashboard links through: pup already has its session, so adding it starts no sign-in.
  await world.api("POST", "/__hui/datadog/orgs", { name: "e2e-prod", site });
  await expect.poll(async () => (await world.api<DatadogConnection>("GET", "/__hui/datadog")).orgs,
    { message: "the world's gateway never listed e2e-prod as connected" }).toEqual([{ name: "e2e-prod", site, status: "connected" }]);

  const session = await world.createSession({ title: "Two dashboards" });
  await world.prompt(session, `Look at these dashboards before the review: ${widgetUrl} and ${dashboardUrl}`);
  await hui.open(`${world.url}/sessions/${session.id}`);

  // One card per link, in the user message that carries them, in reading order.
  const links = screen.getByLabel("Datadog links");
  await expect(links.getByRole("listitem")).toHaveCount(2);

  // The widget card: the link's template variable is in the title, the meta names the org, the dashboard and the range
  // (the link had none, so the last hour), and the card says why there is no graph.
  const widget = links.getByLabel("Datadog: p99 latency in env:staging");
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("link", { name: "p99 latency in env:staging" })).toHaveAttribute("href", widgetUrl);
  await expect(widget.getByRole("link", { name: "p99 latency in env:staging" })).toHaveAttribute("target", "_blank");
  await expect(widget.getByText("e2e-prod · Checkout service · Past 1 hour", { exact: true })).toBeVisible();
  await expect(widget.getByText("Datadog could not draw this widget.", { exact: true })).toBeVisible();
  await expect(widget.getByRole("img")).toHaveCount(0);

  // The dashboard card: its title, the org, and the dashboard's description instead of a widget line.
  const dashboard = links.getByLabel("Datadog: Checkout service");
  await expect(dashboard).toBeVisible();
  await expect(dashboard.getByRole("link", { name: "Checkout service" })).toHaveAttribute("href", dashboardUrl);
  await expect(dashboard.getByText("e2e-prod", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("Latency and errors of the checkout service.", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("Datadog could not draw this widget.", { exact: true })).toHaveCount(0);

  // At a phone's width the cards — the bubble's widest content — hold inside the operator's 390 px bubble, and neither
  // they nor the long links above them make the page scroll sideways. The bubble itself carries no role, label or test
  // id to read its box through, so its cards stand for it, and a resize lays out over the next frame.
  const phone = await hui.phoneScreen();
  for (const card of [widget, dashboard]) {
    await expect.poll(async () => (await edges(card)).right, { message: "a Datadog card never fit a phone's width" }).toBeLessThanOrEqual(phone.width);
  }
  expect(await hui.overflowX()).toBe(0);
  await settle(world, session);
});
