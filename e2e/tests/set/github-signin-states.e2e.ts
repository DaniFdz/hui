/**
 * Settings → Integrations → GitHub against the fixture's GitHub world (`hui.world("github")`: the fake `gh` signed in to
 * two accounts). Its connected section is real; the other states are the payloads the gateway answers for a rejected
 * login, an unreachable GitHub and a refused sign-in, replayed over the one read the section makes, because those are
 * the gateway's own readings of gh and not states the fake CLI can be moved into (SET-025).
 *
 * Every quoted label is unique on the page: Jira's line ends its own sentence ("Not connected.") and the Datadog
 * section has no `pup` here, so the GitHub status pill is the only "Not connected" in the page.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type GitHubConnection = {
  cli: { installed: false } | { installed: true; version: string };
  status: "connected" | "disconnected" | "invalid" | "unknown";
  account?: { host: string; login: string; scopes: string[] };
  message?: string;
  login: { phase: "idle" } | { phase: "starting" } | { phase: "failed"; message: string };
};

test("the GitHub section names each state of the gateway's login: connected, not connected, sign-in required, unverified, a refused sign-in, and no gh", { tags: ["SET-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const page = screen.getByTestId("settings-page");
  await hui.open(`${world.url}/settings/integrations`);
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible({ timeout: 60_000 });

  // The signed-in account: Connected, the account's own row with its host, gh version and scopes, and Reconnect.
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("hui-e2e", { exact: true })).toBeVisible();
  await expect(page.getByText("github.com · gh 9.9.9 · gist, read:org, repo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();

  /** Reloads the section on a connection the gateway could have answered, the way it answers its own. */
  const reading = async (connection: GitHubConnection) => {
    const read = await hui.intercept("GET", /\/__hui\/github$/u);
    await hui.reload();
    await read.arrived();
    await read.answer(JSON.stringify(connection));
    await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  };
  const gh = { installed: true, version: "9.9.9" } as const;

  // Signed out: Not connected, the sign-in row, and Connect GitHub.
  await reading({ cli: gh, status: "disconnected", login: { phase: "idle" } });
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Sign in with GitHub", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();

  // A rejected login: the status says Sign-in required over a row titled Sign in again, gh's reason below it, and
  // Connect GitHub is still the button it offers.
  await reading({ cli: gh, status: "invalid", message: "gh: To get started with GitHub CLI, please run: gh auth login", login: { phase: "idle" } });
  await expect(page.getByText("Sign-in required", { exact: true })).toBeVisible();
  await expect(page.getByText("Sign in again", { exact: true })).toBeVisible();
  await expect(page.getByText("gh: To get started with GitHub CLI, please run: gh auth login", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();

  // An unreachable GitHub: Could not verify over GitHub could not be verified, with the reason it could not.
  await reading({ cli: gh, status: "unknown", message: "GitHub could not be reached: connection reset.", login: { phase: "idle" } });
  await expect(page.getByText("Could not verify", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub could not be verified", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub could not be reached: connection reset.", { exact: true })).toBeVisible();

  // A sign-in gh refused: its own reason, with Try again to start another.
  await reading({ cli: gh, status: "disconnected", login: { phase: "failed", message: "gh: device flow was denied." } });
  await expect(page.getByText("gh: device flow was denied.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();

  // Without gh on the gateway's PATH there is nothing to connect with: the install row, and no Connect button.
  await reading({ cli: { installed: false }, status: "disconnected", login: { phase: "idle" } });
  await expect(page.getByText("GitHub CLI required", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub CLI not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Install gh/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toHaveCount(0);
});
