/**
 * Settings → Models reads each signed-in account's subscription and limits against the fixture's quota world
 * (`hui.world('quota')`: the launcher's `--quota-fixture`, which answers the gateway's own quota route with synthetic
 * upstream payloads for the real parser). The plan, the usage status, one meter per reported period with its reset
 * time or “Reset not reported”, and when the figures were checked; “Refresh limits” reads that account again only, and
 * a read that fails says so instead of drawing zero usage (SET-044).
 */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type World = Awaited<ReturnType<Hui["world"]>>;

const CODEX = "OpenAI · ChatGPT account";
const DEFAULT_ACCOUNT = "alex.personal@example.com";
const BACKUP_ACCOUNT = "alex.long.work.account@example.com";

/** Opens Settings → Models and the folded provider configuration, which every visit starts folded. */
const openProviders = async (screen: Screen, hui: Hui, world: World) => {
  await hui.open(`${world.url}/settings/models`);
  const page = screen.getByTestId("settings-page");
  await expect(page.getByText("Provider configuration · 5 providers", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByText("Provider configuration · 5 providers", { exact: true }).tap();
  return page;
};

/** The card of one provider connection, whose account rows carry their own limits. */
const card = (screen: Screen, name: string) => screen.getByRole("article", { name, exact: true });
/** One signed-in account's row inside a card. */
const account = (card: Locator, name: string) => card.getByRole("article", { name, exact: true });

test("each signed-in account shows its plan, usage status, a meter per reported period with its reset time, and when it was checked; Refresh limits reads that account again, and a failed read says so", { tags: ["SET-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("quota");
  const page = await openProviders(screen, hui, world);

  // Each account of the provider shows its own limits inline, without opening anything per account.
  const codex = card(screen, CODEX);
  await expect(codex).toBeVisible();
  const personal = account(codex, DEFAULT_ACCOUNT);
  const backup = account(codex, BACKUP_ACCOUNT);
  await expect(personal.getByRole("region", { name: "Subscription and limits" })).toBeVisible();
  await expect(backup.getByRole("region", { name: "Subscription and limits" })).toBeVisible();
  await expect(codex.getByText("Subscription and limits", { exact: true })).toHaveCount(2);

  // The plan, the usage status, and a meter per period the provider reported with its percentage and reset time.
  await expect(personal.getByText("plus", { exact: true })).toBeVisible();
  await expect(personal.getByText("Available", { exact: true })).toBeVisible();
  await expect(personal.getByRole("progressbar", { name: "5 hours: 34% used" })).toBeVisible();
  await expect(personal.getByRole("progressbar", { name: "Weekly: 62% used" })).toBeVisible();
  await expect(personal.getByRole("progressbar", { name: "Code review · Weekly: 12% used" })).toBeVisible();
  await expect(personal.getByRole("progressbar", { name: "Spark · 5 hours: 8% used" })).toBeVisible();
  await expect(personal.getByRole("progressbar", { name: "Monthly credits: 18% used" })).toBeVisible();
  await expect(personal.getByRole("progressbar")).toHaveCount(5);
  await expect(personal.getByText(/^Resets /u)).toHaveCount(5);
  await expect(personal.getByText(/^Checked /u)).toBeVisible();
  await expect(personal.getByRole("button", { name: "Refresh limits" })).toBeVisible();

  // An account over its limit says so, with the meter that reached it.
  await expect(backup.getByText("pro", { exact: true })).toBeVisible();
  await expect(backup.getByText("Limit reached", { exact: true })).toBeVisible();
  await expect(backup.getByRole("progressbar", { name: "5 hours: 100% used" })).toBeVisible();

  // A period the provider reported without a reset time says so.
  const claude = account(card(screen, "Claude"), "alex.claude@example.com");
  await expect(claude.getByText("Student", { exact: true })).toHaveCount(0);
  await expect(claude.getByRole("progressbar", { name: "Sonnet weekly: 100% used" })).toBeVisible();
  await expect(claude.getByText("Reset not reported", { exact: true })).toHaveCount(2);

  // A provider with no subscription API is Not supported rather than an empty meter.
  const apiKey = card(screen, "OpenAI · API key");
  await expect(apiKey.getByText("Not supported", { exact: true })).toBeVisible();
  await expect(apiKey.getByText("This provider does not expose a supported subscription quota API.", { exact: true })).toBeVisible();
  await expect(apiKey.getByRole("progressbar")).toHaveCount(0);

  // Refresh limits reads that account again only: its checked time moves, the other account's does not.
  const checkedAt = async (within: Locator) => hui.textOf(within.getByText(/^Checked /u));
  const before = await checkedAt(personal);
  const other = await checkedAt(backup);
  const refreshed = await hui.intercept("GET", /\/__hui\/providers\/openai-codex\/accounts\/default\/quota$/u);
  await personal.getByRole("button", { name: "Refresh limits" }).tap();
  await expect(personal.getByRole("button", { name: "Checking…" })).toBeVisible();
  await refreshed.deliver();
  await expect.poll(() => checkedAt(personal)).not.toBe(before);
  expect(await checkedAt(backup)).toBe(other);
  await expect(personal.getByRole("progressbar", { name: "5 hours: 34% used" })).toBeVisible();

  // A read that fails says so rather than drawing zero usage.
  const failing = await hui.intercept("GET", /\/__hui\/providers\/openai-codex\/accounts\/default\/quota$/u);
  await personal.getByRole("button", { name: "Refresh limits" }).tap();
  await failing.reject(503, "Quota is down.");
  await expect(personal.getByText("Usage could not be retrieved. Try refreshing limits.", { exact: true })).toBeVisible();
  await expect(personal.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(personal.getByRole("progressbar")).toHaveCount(0);
  await expect(backup.getByRole("progressbar")).toHaveCount(5);
});
