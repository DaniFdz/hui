/** Two panes hold their own transcript, composer, draft, queue and stream, run at the same time with their own Stop, and a pane with an unsent draft marks its sidebar row (SESS-049). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("each pane keeps its own transcript, composer, draft, queue and stream, two run at once with their own Stop, and a draft marks its row", { tags: ["SESS-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const shown = async (pane: Locator) => {
    const title = pane.getByTestId("session-title", { visible: true });
    return (await title.count()) > 0 ? ((await title.textContent()) ?? "").trim() : "";
  };
  const paneShowing = async (title: string) => {
    for (let index = 0; index < await panes.count(); index += 1) {
      if (await shown(panes.nth(index)) === title) return panes.nth(index);
    }
    throw new Error(`no pane shows ${title}`);
  };
  const send = async (pane: Locator, text: string) => {
    await pane.getByLabel("Message").fill(text);
    await pane.getByRole("button", "Send message").tap();
  };

  const alpha = await hui.createSession({ title: "Alpha chat" });
  await hui.createSession({ title: "Bravo chat" });
  await hui.wideScreen(2200);
  await hui.open(`/sessions/${alpha.id}`);
  await (await hui.sessionMenu("Bravo chat")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  const left = await paneShowing("Alpha chat");
  const right = await paneShowing("Bravo chat");

  await send(left, "E2E_REPLAY from alpha");
  await hui.provider.held();
  await send(right, "E2E_REPLAY from bravo");
  await expect(left.getByLabel("Session status: Running")).toBeVisible();
  await expect(right.getByLabel("Session status: Running")).toBeVisible();
  await expect(left.getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect(right.getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect(left.getByText("E2E_REPLAY from alpha")).toBeVisible();
  await expect(left.getByText("E2E_REPLAY from bravo")).toHaveCount(0);
  await expect(right.getByText("E2E_REPLAY from bravo")).toBeVisible();
  await expect(right.getByText("E2E_REPLAY from alpha")).toHaveCount(0);

  await left.getByLabel("Message").fill("Follow up in alpha");
  await hui.hold(left.getByRole("button", "Steer message; touch and hold to enqueue"), left.getByText("Enqueue"));
  await left.getByText("Enqueue").tap();
  await expect(left.getByLabel("Queued messages").getByText("Follow up in alpha")).toBeVisible();
  await expect(right.getByLabel("Queued messages")).toHaveCount(0);
  await left.getByRole("button", "Remove queued message").tap();
  await expect(left.getByLabel("Queued messages")).toHaveCount(0);

  await left.getByRole("button", "Stop").tap();
  await expect(left.getByLabel("Session status: Idle")).toBeVisible();
  await expect(left.getByRole("button", "Stop")).toBeHidden();
  await expect(right.getByLabel("Session status: Running")).toBeVisible();
  await expect(right.getByRole("button", "Stop")).toBeVisible();

  await hui.provider.release();
  await expect(right.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(right.getByLabel("Session status: Idle")).toBeVisible();

  await left.getByLabel("Message").fill("Half-written note");
  await expect(left.getByLabel("Message")).toHaveValue("Half-written note");
  await expect(right.getByLabel("Message")).toHaveValue("");
  await expect(screen.getByLabel(/^Alpha chat, status idle, .*stage investigation, draft,/u)).toBeVisible();
  await expect(screen.getByLabel(/^Bravo chat, status idle, .*stage investigation, open in split pane$/u)).toBeVisible();
});
