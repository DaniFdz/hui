/** A login another browser exported, imported through Settings → Tools → Browser, signs HUI's own managed browser in.
 * The fixture's server reads the incoming request's Cookie header, so its page says "signed out" before the import and
 * "signed in" after a reload, while the page and the chat never hold the cookie's value (SET-101). */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Tool calls the fixture provider runs in one answer, the way a model would. One call at a time: HUI runs sibling
 * calls of one answer in parallel, so a second call would race the navigation that gives it a tab, while `open` and
 * `reload` already answer with the page's own snapshot. */
const calls = (list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("an imported login signs the managed browser in without showing its value", { tags: ["SET-101"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A fresh token for this run: it exists only in the file this test writes and in the cookie the browser keeps, so
  // finding it on the page or in the chat would mean a cookie's value was reported back.
  const value = randomUUID();
  const file = join(hui.workspace, "cookie-import.json");
  await writeFile(file, JSON.stringify({
    cookies: [{ name: "hui_import", value, domain: "127.0.0.1", path: "/", expires: -1, sameSite: "Lax" }],
    origins: [],
  }));
  const page = `${hui.provider.url}/browser-cookie-fixture`;
  const transcript = screen.getByTestId("transcript");
  const replies = transcript.getByTestId("message-row").filter({ hasText: "tool answered:" });
  const session = await hui.createSession({ title: "Cookie import" });

  // Before the import the fixture's own server sees no cookie, so the page it renders says so.
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls([{ name: "browser", input: { action: "open", url: page } }]));
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => hui.textOf(replies.last())).toContain("signed out");

  // Settings takes the absolute path and hands the file to the gateway, which reads it and reports a count, a domain and
  // nothing of a cookie. The browser is running, so the cookies apply now and nothing waits for a later start.
  await hui.open("/settings/tools");
  await screen.getByLabel("Cookies file").fill(file);
  await screen.getByRole("button", "Import cookies").click();
  await expect(screen.getByText("imported 1 cookie for 1 domain (0 expired dropped)", { exact: true })).toBeVisible();
  await expect(screen.getByText("domains: 127.0.0.1", { exact: true })).toBeVisible();
  await expect(screen.getByText("They apply when the managed browser next starts.", { exact: true })).toHaveCount(0);
  await expect(screen.getByText(value)).toHaveCount(0);

  // The same tab reloads: its server now sees the cookie, so one real page proves both answers and the live path.
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls([{ name: "browser", input: { action: "reload" } }]));
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => hui.textOf(replies.last())).toContain("signed in");
  await expect(transcript.getByText(value)).toHaveCount(0);
});
