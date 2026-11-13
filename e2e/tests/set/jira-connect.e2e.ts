/**
 * Settings → Integrations → Jira against the fixture's Jira world (`hui.world('jira')`: a local Jira Cloud subset the
 * gateway verifies tokens with): the connect walkthrough with its token link, a rejection that saves nothing, “Change”
 * keeping a saved token, the default project picker and its preselection in a new work item, and disconnecting
 * (SET-022, SET-023, SET-024).
 *
 * The world arrives with Jira connected, so every connect clause starts from “Disconnect” and rebuilds the connection
 * through the page; each test puts the seeded connection back.
 */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type JiraConnection = { configured: boolean; site: string; email: string; tokenSet: boolean; defaultProject: string; accountName?: string };

/** The fixture Jira's public test credentials (`e2e/fixtures/jira-fixture.mjs`), which the world is seeded with. */
const EMAIL = "e2e@hui.test";
const TOKEN = "e2e-token";
const ACCOUNT = "HUI E2E";
const TOKEN_LINK = "https://id.atlassian.com/manage-profile/security/api-tokens";
/** A token the fixture Jira answers 401 to. */
const REJECTED = "wrong-token";

const connection = (api: Hui["api"]) => api<JiraConnection>("GET", "/__hui/jira");

/** Puts the connection the world was seeded with back, whatever the test did to it. */
const restore = async (world: { api: Hui["api"]; jiraUrl?: string }, seeded: JiraConnection) => {
  await world.api("DELETE", "/__hui/jira").catch(() => undefined);
  if (seeded.configured) await world.api("PUT", "/__hui/jira", { site: world.jiraUrl, email: seeded.email, token: TOKEN, defaultProject: seeded.defaultProject });
};

/** Opens Settings → Integrations once the Jira section has read the gateway's connection. */
const openJira = async (screen: Screen, hui: Hui, world: { url: string }) => {
  await hui.open(`${world.url}/settings/integrations`);
  const page = screen.getByTestId("settings-page");
  await expect(page.getByRole("heading", { name: "Jira", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/(?:Connected to Jira Cloud\.|Not connected\.)$/u)).toBeVisible();
  return page;
};

test("Connect Jira walks through an Atlassian API token, verifies it while saying so, keeps the token off the page, and a rejection saves nothing", { tags: ["SET-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const seeded = await connection(world.api);
  try {
    const page = await openJira(screen, hui, world);
    // A connected world starts on its saved connection, which Disconnect clears into the connect form.
    await page.getByRole("button", { name: "Disconnect" }).tap();
    await expect(page.getByRole("status").filter({ hasText: "Jira disconnected. The API token was removed from this machine." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeVisible();
    // The form walks through creating the token and links Atlassian's own page for it.
    await expect(page.getByRole("listitem").filter({ hasText: "Open Atlassian API tokens" })).toBeVisible();
    await hui.expectLinkTo(page, "Atlassian API tokens", TOKEN_LINK);

    // A token Jira refuses changes nothing: the page shows Jira's error and the gateway keeps no connection.
    await page.getByLabel("Jira site", { exact: true }).fill(world.jiraUrl!);
    await page.getByLabel("Atlassian account email", { exact: true }).fill(EMAIL);
    await page.getByLabel("API token", { exact: true }).fill(REJECTED);
    await page.getByRole("button", { name: "Connect Jira" }).tap();
    await expect(page.getByRole("alert").filter({ hasText: "Jira rejected the email or API token." })).toBeVisible();
    expect((await connection(world.api)).configured).toBe(false);
    await expect(page.getByText(/Not connected\.$/u)).toBeVisible();

    // The token is verified while the button says “Verifying…”, and the page then names the account it reached.
    const verifying = await hui.intercept("PUT", /\/__hui\/jira$/u);
    await page.getByLabel("API token", { exact: true }).fill(TOKEN);
    await page.getByRole("button", { name: "Connect Jira" }).tap();
    await verifying.arrived();
    await expect(page.getByRole("button", { name: "Verifying…" })).toBeVisible();
    await verifying.deliver();
    await expect(page.getByRole("status").filter({ hasText: `Connected as ${ACCOUNT}.` })).toBeVisible();
    await expect(page.getByText(`${ACCOUNT} · ${EMAIL} · API token saved`, { exact: true })).toBeVisible();
    // The token never comes back to the page: the connection view carries only that one is set.
    expect(await connection(world.api)).toMatchObject({ configured: true, site: world.jiraUrl, email: EMAIL, tokenSet: true, accountName: ACCOUNT });
    await expect(page.getByText(TOKEN, { exact: true })).toHaveCount(0);

    // Change edits the saved connection, keeps the token when its field is left empty, and verifies it again.
    await page.getByRole("button", { name: "Change" }).tap();
    await expect(page.getByLabel("Jira site", { exact: true })).toHaveValue(world.jiraUrl!);
    await expect(page.getByLabel("Atlassian account email", { exact: true })).toHaveValue(EMAIL);
    // The token field is left empty, so the save that follows proves a saved token survives an unset field.
    const saving = await hui.intercept("PUT", /\/__hui\/jira$/u);
    await page.getByRole("button", { name: "Save connection" }).tap();
    await saving.arrived();
    await expect(page.getByRole("button", { name: "Verifying…" })).toBeVisible();
    await saving.deliver();
    await expect(page.getByRole("status").filter({ hasText: `Connected as ${ACCOUNT}.` })).toBeVisible();
    expect((await connection(world.api)).tokenSet).toBe(true);
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  } finally {
    await restore(world, seeded);
  }
});

test("the default Jira project picker counts the site's projects, searches the rest, says what a new work item defaults to, survives a reload, preseeds a new work item and clears with No default", { tags: ["SET-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const seeded = await connection(world.api);
  const session = await world.createSession({ title: "Jira defaults" });
  try {
    // The world seeds CI as the default; the site holds six hundred and two projects, so the rest are searched.
    const page = await openJira(screen, hui, world);
    await expect(page.getByText(/602 projects; type to search them all\.$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "Default project: CI Platform (CI)" })).toBeVisible();

    await page.getByRole("button", { name: "Default project: CI Platform (CI)" }).tap();
    const picker = screen.getByTestId("picker-list", { visible: true });
    await expect(picker.getByText("CI Platform (CI)", { exact: true })).toBeVisible();
    await screen.getByLabel("Search projects by name or key").fill("OPS");
    await expect(picker.getByText("Operations (OPS)", { exact: true })).toBeVisible();
    await picker.getByText("Operations (OPS)", { exact: true }).tap();
    await expect(page.getByRole("status").filter({ hasText: "New work items default to OPS." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Default project: Operations (OPS)" })).toBeVisible();
    expect((await connection(world.api)).defaultProject).toBe("OPS");

    // The choice survives a reload…
    await hui.reload();
    await expect(screen.getByRole("button", { name: "Default project: Operations (OPS)" })).toBeVisible();
    expect((await connection(world.api)).defaultProject).toBe("OPS");

    // …and preselects the project of a new work item, which a session's own menu creates.
    await hui.open(`${world.url}/sessions/${session.id}`);
    await hui.sessionList();
    const row = await hui.sessionMenu("Jira defaults");
    await row.getByText("Create Jira work item…", { visible: true }).tap();
    const dialog = screen.getByRole("dialog", { name: "Create Jira work item" });
    await expect(dialog.getByRole("button", { name: "Project: Operations (OPS)" })).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(dialog).toBeHidden();

    // No default clears it.
    await hui.open(`${world.url}/settings/integrations`);
    const settings = screen.getByTestId("settings-page");
    await settings.getByRole("button", { name: "Default project: Operations (OPS)" }).tap();
    const options = screen.getByTestId("picker-list", { visible: true });
    await options.getByText("No default", { exact: true }).tap();
    await expect(settings.getByRole("status").filter({ hasText: "No default project." })).toBeVisible();
    expect((await connection(world.api)).defaultProject).toBe("");
    await expect(settings.getByRole("button", { name: "Default project: No default" })).toBeVisible();
  } finally {
    await restore(world, seeded);
  }
});

test("Disconnect removes the Jira connection, says the token left the machine, and the section returns to Not connected with the connect form", { tags: ["SET-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const seeded = await connection(world.api);
  try {
    const page = await openJira(screen, hui, world);
    await expect(page.getByText(/Connected to Jira Cloud\.$/u)).toBeVisible();
    await expect(page.getByText("Default project", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Disconnect" }).tap();
    await expect(page.getByRole("status").filter({ hasText: "Jira disconnected. The API token was removed from this machine." })).toBeVisible();
    await expect(page.getByText(/Not connected\.$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(page.getByText("Default project", { exact: true })).toHaveCount(0);
    // The token left the machine: the gateway reports no connection, and a reload agrees.
    expect(await connection(world.api)).toEqual({ configured: false, site: "", email: "", tokenSet: false, defaultProject: "" });
    await hui.reload();
    await expect(screen.getByText(/Not connected\.$/u)).toBeVisible();
    expect((await connection(world.api)).configured).toBe(false);
  } finally {
    await restore(world, seeded);
  }
});
