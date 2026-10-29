/** The session menu's Copy submenu copies the session link, its ID or the open conversation as Markdown, and reports a failed clipboard write (SESS-038). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Copy puts the session link, the session ID and the open conversation on the clipboard", { tags: ["SESS-038"] }, async ({ screen, hui }) => {
  const copy = async (choice: string) => {
    const menu = await hui.sessionMenu("Copy source");
    await menu.getByText("Copy", { exact: true, visible: true }).tap();
    await menu.getByText(choice, { exact: true, visible: true }).tap();
  };
  const session = await hui.createSession({ title: "Copy source" });
  await hui.clipboard();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message", { visible: true }).fill("Copy this conversation");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();

  await copy("Session link");
  await expect(screen.getByText("Session link copied.")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe(new URL(`/sessions/${session.id}`, await hui.url()).href);
  await copy("Session ID");
  await expect(screen.getByText("Session ID copied.")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe(session.id);
  await copy("Conversation as Markdown");
  await expect(screen.getByText("Conversation copied as Markdown.")).toBeVisible();
  await expect.poll(() => hui.copied()).toContain("Copy this conversation");
  await expect.poll(() => hui.copied()).toContain("Fixture response.");
});

test("a refused clipboard write reports that it could not copy", { tags: ["SESS-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Copy refused" });
  await hui.clipboard({ refuse: true });
  await hui.open(`/sessions/${session.id}`);
  await hui.sessionMenu("Copy refused");
  await screen.getByText("Copy", { exact: true, visible: true }).tap();
  await screen.getByText("Session ID", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Could not copy to the clipboard.")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("");
});
