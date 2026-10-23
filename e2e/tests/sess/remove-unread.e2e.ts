/** Delete… removes a session and its subagents from HUI after a confirmation that Cancel backs out of, and a background session's unread mark shows until it is opened or set by hand (SESS-037, SESS-018). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const row = (title: string) => new RegExp(`^${title}, status `, "u");

test("Delete… confirms first, Cancel keeps the tree, and Remove from HUI removes it and returns Home", { tags: ["SESS-037"] }, async ({ screen, hui }) => {
  const question = screen.getByText("Remove Retire me from HUI?");
  const parent = await hui.createSession({ title: "Retire me" });
  const child = await hui.createSubagent(parent);
  await hui.createSession({ title: "Keep me" });
  await hui.open(`/sessions/${parent.id}`);

  await hui.sessionMenu("Retire me");
  await screen.getByText("Delete…", { visible: true }).tap();
  await expect(question).toBeVisible();
  await expect(screen.getByText("HUI will remove this session and all its subagents, including nested subagents, and stop their runtimes. Their PI transcripts remain on disk and are not deleted.")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(question).toBeHidden();
  await hui.sessionList();
  await expect(screen.getByLabel(row("Retire me"))).toBeVisible();
  await screen.getByRole("button", "Expand subagents of Retire me").tap();
  await expect(screen.getByLabel(row(child.title))).toBeVisible();

  await hui.open(`/sessions/${parent.id}`);
  await hui.sessionMenu("Retire me");
  await screen.getByText("Delete…", { visible: true }).tap();
  await screen.getByRole("button", "Remove from HUI").tap();
  await expect.poll(() => hui.url()).toMatch(/\/$/u);
  await expect(screen.getByLabel(row("Keep me"))).toBeVisible();
  await expect(screen.getByLabel(row("Retire me"))).toBeHidden();
  await hui.open("/sessions");
  await expect(screen.getByRole("button", "Open Keep me")).toBeVisible();
  await expect(screen.getByRole("button", "Open Retire me")).toBeHidden();
  await expect(screen.getByRole("button", `Open ${child.title}`)).toBeHidden();
});

test("a background session that settles stays unread until it is opened, and the menu marks it by hand", { tags: ["SESS-018"] }, async ({ screen, hui }) => {
  const unread = screen.getByLabel("Background work, status idle, tool durable, stage investigation, unread");
  const read = screen.getByLabel("Background work, status idle, tool durable, stage investigation");
  const background = await hui.createSession({ title: "Background work" });
  const here = await hui.createSession({ title: "Foreground work" });

  await hui.open(`/sessions/${here.id}`);
  await hui.sessionList();
  await expect(read).toBeVisible();
  await hui.prompt(background, "Hello from elsewhere");
  await expect(unread).toBeVisible();
  await hui.reload();
  await hui.sessionList();
  await expect(unread).toBeVisible();
  await hui.open("/sessions");
  await expect(screen.getByText("Unread", { exact: true })).toBeVisible();

  await hui.open(`/sessions/${background.id}`);
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await hui.sessionList();
  await expect(read).toBeVisible();
  await hui.sessionMenu("Background work");
  await screen.getByText("Mark as unread", { visible: true }).tap();
  await expect(screen.getByText("Marked as unread.")).toBeVisible();
  await expect(unread).toBeVisible();
  await hui.sessionMenu("Background work");
  await screen.getByText("Mark as read", { visible: true }).tap();
  await expect(screen.getByText("Marked as read.")).toBeVisible();
  await expect(read).toBeVisible();
});
