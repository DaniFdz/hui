/** Watching another of the conversation's browser tabs: the view follows the agent's current tab, the Browser tab picker
 * switches it to another tab the conversation opened, and Follow agent returns it to the agent's tab (WORK-040). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { backToChat, openWork, reopenWork } from "./work-views.ts";

const call = (calls: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

test("the Browser tab picker switches the view to another tab the conversation opened, and Follow agent returns it to the agent's", { tags: ["WORK-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Two browser tabs" });
  const pane = screen.getByLabel("Work pane");
  const picker = pane.getByRole("button", /^Browser tab: /u);
  const frame = (title: string) => pane.getByRole("img", { name: `Live view of ${title}` });
  const followAgent = pane.getByRole("button", "Follow agent");
  const fixturePage = `${hui.provider.url}/browser-fixture`;
  const handoffPage = `${hui.provider.url}/browser-handoff-fixture`;

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Browser");

  // The agent opens two tabs in one turn, and the view follows whichever of them the agent left current.
  await hui.prompt(session, call([
    { name: "browser", input: { action: "open", url: fixturePage } },
    { name: "browser", input: { action: "open", url: handoffPage } },
  ]));
  // A phone shows the Work destination instead of the chat, so the settled turn is read from the chat and the view is
  // then shown again from the chooser.
  await backToChat(screen);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await reopenWork(screen, "Browser");
  await expect(picker).toHaveAttribute("aria-label", /^Browser tab: t\d+ · HUI (browser|handoff) fixture$/u);
  const agentTitle = ((await picker.getAttribute("aria-label")) ?? "").split(" · ")[1] ?? "";
  const agentPage = agentTitle === "HUI handoff fixture" ? handoffPage : fixturePage;
  // Following the agent is the default, and the view names the agent's own tab, draws it and shows its address.
  await expect(followAgent).toHaveCount(0);
  await expect(pane.getByText(agentPage, { exact: true }).first()).toBeVisible();
  await expect(frame(agentTitle)).toBeVisible();

  // Another tab of the same conversation is one picker step away, under the name the picker gives it.
  const otherTitle = agentTitle === "HUI handoff fixture" ? "HUI browser fixture" : "HUI handoff fixture";
  await picker.tap();
  const options = screen.getByRole("listbox", "Browser tab").getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: agentTitle })).toHaveCount(1);
  await expect(options.filter({ hasText: otherTitle })).toHaveCount(1);
  await options.filter({ hasText: otherTitle }).tap();

  // The view is watching the tab picked: its name, its frame, and Follow agent offered to come back.
  await expect(picker).toHaveAttribute("aria-label", new RegExp(`^Browser tab: t\\d+ · ${otherTitle}$`, "u"));
  await expect(frame(otherTitle)).toBeVisible();
  await expect(frame(agentTitle)).toHaveCount(0);
  await expect(followAgent).toBeVisible();

  // Follow agent drops the picked tab and follows the agent's own again.
  await followAgent.tap();
  await expect(picker).toHaveAttribute("aria-label", new RegExp(`^Browser tab: t\\d+ · ${agentTitle}$`, "u"));
  await expect(frame(agentTitle)).toBeVisible();
  await expect(frame(otherTitle)).toHaveCount(0);
  await expect(followAgent).toHaveCount(0);
});
