/** A session moves to another custom group by dragging its row onto the group or through Move to group, keeps its group across a reload, and a failed move shows its error (SESS-030). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("dragging a row onto a group or choosing Move to group moves the session, and it stays there after a reload", { tags: ["SESS-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const meta = (group: string) => screen.getByText(`durable · ${group} · Idle`, { visible: true });
  const dragged = await hui.createSession({ title: "Drag me", group: "Inbox" });
  await hui.createSession({ title: "Research anchor", group: "Research" });
  const moved = await hui.createSession({ title: "Move me", group: "Inbox" });
  await hui.createSession({ title: "Shipping anchor", group: "Shipping" });

  await hui.open(`/sessions/${dragged.id}`);
  await expect(meta("INBOX")).toBeVisible();
  await screen.getByTestId("session-row").filter({ hasText: "Drag me" }).dragTo(screen.getByText("RESEARCH", { exact: true, visible: true }));
  await expect(screen.getByText("Moved Drag me to RESEARCH.")).toBeVisible();
  await expect(meta("RESEARCH")).toBeVisible();

  await hui.open(`/sessions/${moved.id}`);
  const groups = screen.getByTestId("session-row").filter({ hasText: "Move me" });
  await hui.sessionMenu("Move me");
  await screen.getByText("Move to group", { visible: true }).tap();
  await groups.getByText("SHIPPING", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Moved Move me to SHIPPING.")).toBeVisible();
  await expect(meta("SHIPPING")).toBeVisible();

  await hui.reload();
  await expect(meta("SHIPPING")).toBeVisible();
  await hui.open(`/sessions/${dragged.id}`);
  await expect(meta("RESEARCH")).toBeVisible();
});

test("a failed move shows its error and leaves the session where it was", { tags: ["SESS-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Stuck session", group: "Inbox" });
  await hui.createSession({ title: "Elsewhere anchor", group: "Elsewhere" });
  await hui.open(`/sessions/${session.id}`);
  await hui.failNextRequest("PATCH", `/__hui/sessions/${session.id}`, "The registry is read-only right now.");
  await hui.sessionMenu("Stuck session");
  await screen.getByText("Move to group", { visible: true }).tap();
  await screen.getByTestId("session-row").filter({ hasText: "Stuck session" }).getByText("ELSEWHERE", { exact: true, visible: true }).tap();
  await expect(screen.getByText("The registry is read-only right now.")).toBeVisible();
  await expect(screen.getByText("durable · INBOX · Idle", { visible: true })).toBeVisible();
});
