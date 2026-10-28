/** A session's menu offers its current group as a choice that does nothing, and Copy's Conversation as Markdown only for the open session (SESS-069). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Move to group offers the session's current group disabled and moves it to another one", { tags: ["SESS-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Grouped session", group: "Inbox" });
  await hui.createSession({ title: "Shipping anchor", group: "Shipping" });

  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByText("durable · INBOX · Idle", { visible: true })).toBeVisible();
  const menu = await hui.sessionMenu("Grouped session");
  await screen.getByText("Move to group", { visible: true }).tap();
  await menu.getByText("INBOX", { exact: true, visible: true }).tap();
  await expect(menu.getByText("SHIPPING", { exact: true, visible: true })).toBeVisible();
  await expect(screen.getByText(/^Moved /u)).toBeHidden();
  await expect(screen.getByText("durable · INBOX · Idle", { visible: true })).toBeVisible();

  await menu.getByText("SHIPPING", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Moved Grouped session to SHIPPING.")).toBeVisible();
  await expect(screen.getByText("durable · SHIPPING · Idle", { visible: true })).toBeVisible();
});

test("Conversation as Markdown is offered disabled unless its session is the open one", { tags: ["SESS-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  const source = await hui.createSession({ title: "Copy source" });
  const bystander = await hui.createSession({ title: "Copy bystander" });
  const copied = screen.getByText("Conversation copied as Markdown.");

  await hui.clipboard();
  await hui.prompt(source, "Keep this transcript");
  await hui.open(`/sessions/${bystander.id}`);
  await expect(screen.getByTestId("transcript")).toBeVisible();
  const away = await hui.sessionMenu("Copy source");
  await away.getByText("Copy", { exact: true, visible: true }).tap();
  await away.getByText("Conversation as Markdown", { visible: true }).tap();
  await expect(away.getByText("Session ID", { visible: true })).toBeVisible();
  await expect(copied).toBeHidden();
  await expect.poll(() => hui.copied()).toBe("");
  await away.getByText("Session ID", { visible: true }).press("Escape");
  await expect(away.getByText("Session ID", { visible: true })).toBeHidden();

  await hui.open(`/sessions/${source.id}`);
  await expect(screen.getByTestId("transcript").getByText("Keep this transcript")).toBeVisible();
  const menu = await hui.sessionMenu("Copy source");
  await menu.getByText("Copy", { exact: true, visible: true }).tap();
  await menu.getByText("Conversation as Markdown", { visible: true }).tap();
  await expect(copied).toBeVisible();
  await expect.poll(() => hui.copied()).toContain("Keep this transcript");
});
