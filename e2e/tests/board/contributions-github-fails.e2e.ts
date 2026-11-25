/** Contributions keeps its charts readable when one gh account cannot be read, reports the error with Retry when nothing could be read, and offers Connect GitHub while no account is signed in (BOARD-049, BOARD-050). */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Lines the fake `gh` appended for its contribution searches: one per read of one account. */
const reads = async (log: string) => (await readFile(log, "utf8").catch(() => "")).split("\n").filter((line) => line.trim()).length;

test("one account gh cannot read is warned about above the charts the other accounts still draw, and a read that fails outright shows its error with Retry while Refresh reads GitHub again", { tags: ["BOARD-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const gh = join(world.runDir, "gh");
  const contributions = join(gh, "contributions.json");
  await hui.open(`${world.url}/contributions`);
  const total = screen.getByText(/^[\d,]+ commits in the last year$/u);
  const account = screen.getByRole("button", { name: /^Account: /u });
  await expect(total).toBeVisible();
  const everyone = await hui.textOf(total);
  // What the one account that will stay readable counts on its own.
  await account.tap();
  await screen.getByRole("option", { name: "hui-e2e", exact: true }).tap();
  await expect(account).toHaveAccessibleName("Account: hui-e2e");
  await expect.poll(() => hui.textOf(total)).not.toBe(everyone);
  const readable = await hui.textOf(total);
  await account.tap();
  await screen.getByRole("option", { name: "All accounts", exact: true }).tap();
  await expect(account).toHaveAccessibleName("Account: All accounts");
  await expect.poll(() => hui.textOf(total)).toBe(everyone);
  const before = await reads(join(gh, "search-log"));

  // One account's gh refuses, and the page names it with gh's own message instead of hiding the other one.
  const data = JSON.parse(await readFile(contributions, "utf8")) as Record<string, unknown>;
  await writeFile(contributions, JSON.stringify({ ...data, "hui-e2e-personal": "gh: HTTP 403: API rate limit exceeded for user ID 1." }));
  await screen.getByRole("button", "Refresh").tap();
  const warning = screen.getByRole("alert").filter({ hasText: "hui-e2e-personal" });
  await expect(warning).toContainText("hui-e2e-personal");
  await expect(warning).toContainText("gh: HTTP 403: API rate limit exceeded for user ID 1.");
  // The account that answered is still charted; the one that did not contributes nothing.
  await expect(total).toBeVisible();
  await expect.poll(() => hui.textOf(total)).toBe(readable);
  await expect(screen.getByRole("img", { name: /^[\d,]+ commits per week in the last year$/u })).toBeVisible();
  // Refresh asks gh again rather than replaying what it answered before.
  await expect.poll(() => reads(join(gh, "search-log"))).toBeGreaterThan(before);

  // Nothing read at all: the page reports the failure with Retry, and Retry reads GitHub again.
  const failed = await hui.intercept("GET", /\/__hui\/github\/contributions/u);
  await hui.reload();
  await failed.arrived();
  await failed.reject(502, "gh is not installed on the HUI machine.");
  const error = screen.getByRole("alert").filter({ hasText: "gh is not installed on the HUI machine." });
  await expect(error).toBeVisible();
  await expect(total).toBeHidden();
  await error.getByRole("button", "Retry").tap();
  await expect(total).toBeVisible();
  await expect(warning).toBeVisible();
});

test("with no GitHub account signed in the page says so and Connect GitHub opens Settings → Integrations at the GitHub section", { tags: ["BOARD-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  await rm(join(world.runDir, "gh", "account"), { force: true });
  await rm(join(world.runDir, "gh", "accounts"), { force: true });
  await hui.open(`${world.url}/contributions`);

  await expect(screen.getByText(/^No GitHub account is signed in to/u)).toBeVisible();
  await screen.getByRole("button", "Connect GitHub").tap();
  await expect.poll(() => hui.url()).toContain("/settings/integrations");
  await expect(screen.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  await expect(screen.getByText("Sign in with GitHub")).toBeVisible();
});
