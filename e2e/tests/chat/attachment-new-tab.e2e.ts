/** A sent PDF opens in a new tab from its transcript card instead of downloading, and HUI itself never leaves the
 * session (CHAT-071). The tab is read from the address the page asked the browser for (`hui.tab()`): the suite's engine
 * drives one page, so the request is what a test asserts, not a second page's contents. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("opening a sent PDF from its transcript card asks for the attachment in a new tab and leaves HUI where it was", { tags: ["CHAT-071"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`);

  const session = await hui.createSession({ title: "Open a sent PDF" });
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();

  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), [{ name: "report.pdf", bytes: 2_048 }]);
  await expect(screen.getByLabel("Attached files").getByRole("button", "Remove report.pdf")).toBeVisible();
  await message.fill("Here is the report");
  await screen.getByRole("button", "Send message").tap();

  const open = transcript.getByLabel("Open report.pdf");
  await expect(open).toBeVisible();
  await expect(status("Idle")).toBeVisible();
  // Nothing in the session has asked for a tab yet, so the step has nothing to report: it never invents a request.
  expect(await hui.tabs()).toEqual([]);

  const here = await hui.url();
  await open.tap();
  // The address is the attachment's own route on this gateway, asked for as a link that keeps no opener and downloads
  // nothing: the gateway serves a PDF inline, so the tab shows the file (CHAT-071).
  const tab = await hui.tab();
  expect(tab?.via).toBe("link");
  expect(new URL(tab!.url).pathname).toMatch(new RegExp(`^/__hui/sessions/${session.id}/attachments/\\d+/files/\\d+$`, "u"));
  expect(tab?.noopener).toBe(true);
  // HUI stays on the session while the file opens elsewhere.
  expect(await hui.url()).toBe(here);
  await expect(transcript.getByLabel("Open report.pdf")).toBeVisible();
});
