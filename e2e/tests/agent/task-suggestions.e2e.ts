/** The cards an agent's suggest_task calls add to its conversation: the stack in the gutter, their details, copy and
 * dismiss, and starting one in a new session or in this one (AGENT-045, AGENT-046, AGENT-047, AGENT-049, AGENT-050). */
import { basename } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { expectChatTitle } from "../sess/chat-header.ts";

type Suggestion = { title: string; problem: string; fix?: string };

/** The card without a fix, then the card that knows one: each is one turn of its own, so the newest card is the second. */
const NO_FIX: Suggestion = {
  title: "Investigate transcript jump after reconnect",
  problem: "After the event stream reconnects the transcript sometimes scrolls back to the top.\n\n- Seen twice with long sessions\n- Not reproduced on demand yet",
};
const WITH_FIX: Suggestion = {
  title: "Replace the native terminal switcher select",
  problem: "The terminal pane header still switches terminals with a native `<select>`.",
  fix: "Render it with `renderPicker`, as the panel selector already does.",
};

const suggest = (suggestion: Suggestion) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "suggest_task", input: suggestion })).toString("base64url")}`;

/** The prompt a started card sends (`taskSuggestionPrompt`), which is what its session's first turn holds. */
const promptOf = ({ title, problem, fix }: Suggestion) =>
  [`# ${title}`, "## Problem", problem, "## Proposed fix", fix || "Not known yet. Investigate and confirm the root cause before changing code."].join("\n\n");

/** How a turn or a card reads: the prompt as one run of text, and Markdown code as the words it styles. */
const oneLine = (text: string) => text.replaceAll("\n\n", " ");
const styled = (text: string) => text.replaceAll("`", "");

/** A session with both cards: the one without a fix arrived first, so the fixed one is the card shown at 1/2. */
const suggested = async (hui: Hui, screen: Screen, title: string, group?: string) => {
  const session = await hui.createSession({ title, ...(group ? { group } : {}) });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, suggest(NO_FIX));
  await expect(screen.getByRole("article", { name: NO_FIX.title })).toBeVisible();
  await hui.prompt(session, suggest(WITH_FIX));
  await expect(screen.getByRole("article", { name: WITH_FIX.title })).toBeVisible();
  return session;
};

test("each suggest_task call adds a card in the conversation's gutter, newest first, and the cards survive a reload", { tags: ["AGENT-045"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = (title: string) => screen.getByRole("article", { name: title });
  const session = await hui.createSession({ title: "Suggested cards" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, suggest(NO_FIX));
  await expect(card(NO_FIX.title)).toBeVisible();
  await expect(card(NO_FIX.title).getByText("1/1")).toBeHidden();
  await hui.prompt(session, suggest(WITH_FIX));

  // Newest first: the call of the latest turn is the card shown, and the older one is a Next away.
  await expect(card(WITH_FIX.title)).toBeVisible();
  await expect(card(WITH_FIX.title).getByText(`Suggested task · in ${basename(hui.workspace)}`)).toBeVisible();
  await expect(card(WITH_FIX.title).getByText("1/2")).toBeVisible();
  await expect(card(WITH_FIX.title).getByRole("button", "Previous suggestion")).toBeDisabled();
  await expect(card(WITH_FIX.title).getByRole("button", "Next suggestion")).toBeEnabled();
  // The gutter is the conversation's own column: the card is not a transcript row and never covers the composer.
  await expect(transcript.getByRole("article")).toHaveCount(0);
  expect((await card(WITH_FIX.title).boundingBox())!.y + (await card(WITH_FIX.title).boundingBox())!.height)
    .toBeLessThan((await screen.getByLabel("Message").boundingBox())!.y);

  await card(WITH_FIX.title).getByRole("button", "Next suggestion").tap();
  await expect(card(NO_FIX.title)).toBeVisible();
  await expect(card(NO_FIX.title).getByText("2/2")).toBeVisible();
  await expect(card(NO_FIX.title).getByText(`Suggested task · in ${basename(hui.workspace)}`)).toBeVisible();
  await expect(card(NO_FIX.title).getByRole("button", "Next suggestion")).toBeDisabled();
  await card(NO_FIX.title).getByRole("button", "Previous suggestion").tap();
  await expect(card(WITH_FIX.title)).toBeVisible();

  // The call itself stays in the turn's activity disclosure.
  const used = transcript.getByText("Used 1 tool");
  await expect(used).toHaveCount(2);
  await used.first().tap();
  await expect(transcript.getByRole("button", /^Used suggest task/u)).toHaveCount(2);
  await expect(transcript.getByRole("button", /^Used suggest task/u).first()).toBeVisible();

  await hui.reload();
  await expect(card(WITH_FIX.title)).toBeVisible();
  await expect(card(WITH_FIX.title).getByText("1/2")).toBeVisible();
  await expect(card(NO_FIX.title)).toBeHidden();
});

test("Show details reveals the problem and proposed fix as Markdown, Hide details folds them, and Copy task copies both", { tags: ["AGENT-046"] }, async ({ screen, hui }) => {
  const card = (title: string) => screen.getByRole("article", { name: title });
  await hui.clipboard();
  await suggested(hui, screen, "Suggestion details");

  await expect(card(WITH_FIX.title).getByText("Show details")).toBeVisible();
  await expect(card(WITH_FIX.title).getByRole("heading", { name: "Problem" })).toBeHidden();
  await card(WITH_FIX.title).getByText("Show details").tap();
  await expect(card(WITH_FIX.title).getByText("Hide details")).toBeVisible();
  await expect(card(WITH_FIX.title).getByRole("heading", { name: "Problem" })).toBeVisible();
  await expect(card(WITH_FIX.title).getByRole("heading", { name: "Proposed fix" })).toBeVisible();
  const details = card(WITH_FIX.title).getByLabel("Problem and proposed fix");
  await expect(details.getByText(styled(WITH_FIX.problem))).toBeVisible();
  await expect(details.getByText(styled(WITH_FIX.fix!))).toBeVisible();
  await expect(card(WITH_FIX.title).getByText(hui.workspace)).toBeVisible();
  await expect(card(WITH_FIX.title).getByText("Not known yet.")).toBeHidden();

  await card(WITH_FIX.title).getByText("Hide details").tap();
  await expect(card(WITH_FIX.title).getByText("Show details")).toBeVisible();
  await expect(card(WITH_FIX.title).getByRole("heading", { name: "Problem" })).toBeHidden();

  // A card whose agent gave no fix says so, and its Markdown problem renders as a list.
  await card(WITH_FIX.title).getByRole("button", "Next suggestion").tap();
  await card(NO_FIX.title).getByText("Show details").tap();
  const noFix = card(NO_FIX.title).getByLabel("Problem and proposed fix");
  await expect(noFix.getByText("Not known yet.")).toBeVisible();
  await expect(noFix.getByRole("list")).toHaveCount(1);
  await expect(noFix.getByText("Seen twice with long sessions")).toBeVisible();

  await card(NO_FIX.title).getByRole("button", "Copy task").tap();
  await expect(card(NO_FIX.title).getByRole("button", "Copied task")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe(promptOf(NO_FIX));
  // "Copied task" is brief: the control reads Copy task again on its own.
  await expect(card(NO_FIX.title).getByRole("button", "Copy task")).toBeVisible();
});

test("Dismiss suggestion removes the shown card and its counter, and the agent can withdraw its own card", { tags: ["AGENT-050"] }, async ({ screen, hui }) => {
  const card = (title: string) => screen.getByRole("article", { name: title });
  const session = await suggested(hui, screen, "Dismissed suggestions");

  await card(WITH_FIX.title).getByRole("button", "Dismiss suggestion").tap();
  await expect(card(WITH_FIX.title)).toBeHidden();
  await expect(card(NO_FIX.title)).toBeVisible();
  await expect(card(NO_FIX.title).getByText("1/2")).toBeHidden();
  await expect(card(NO_FIX.title).getByRole("button", "Previous suggestion")).toBeHidden();
  await expect(card(NO_FIX.title).getByRole("button", "Next suggestion")).toBeHidden();

  // A card being started is not dismissed: the operator's own control is disabled for as long as the start is in flight.
  const start = await hui.intercept("POST", /\/suggestions\/[^/]+\/start$/u);
  await card(NO_FIX.title).getByRole("button", "Start in a new session").tap();
  await start.arrived();
  await expect(card(NO_FIX.title).getByRole("button", "Dismiss suggestion")).toBeDisabled();
  await start.reject(409, "That suggestion is already starting.");
  await expect(card(NO_FIX.title).getByRole("button", "Dismiss suggestion")).toBeEnabled();
  await expect(card(NO_FIX.title)).toBeVisible();

  // The card's own id is what the agent's dismiss_task names; the agent withdraws it from the same conversation.
  const remaining = await card(NO_FIX.title).getAttribute("data-suggestion-id");
  await hui.prompt(session, `E2E_CALL:${Buffer.from(JSON.stringify({ name: "dismiss_task", input: { task_id: remaining, reason: "Superseded." } })).toString("base64url")}`);
  await expect(card(NO_FIX.title)).toBeHidden();
  await expect(screen.getByText("Suggested task", { exact: false })).toHaveCount(0);
});

test("Start in this session sends the card as a new turn in the same conversation and removes it", { tags: ["AGENT-049"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByRole("article", { name: WITH_FIX.title });
  await suggested(hui, screen, "Started in this session");
  const url = await hui.url();

  await card.getByRole("button", "More start options").tap();
  await screen.getByRole("menuitem", { name: "Start in this session" }).tap();

  await expect(card).toBeHidden();
  expect(await hui.url()).toBe(url);
  await expectChatTitle(screen, "Started in this session");
  // A user turn is the card's prompt as sent, not Markdown the browser re-rendered.
  await expect(transcript.getByText(oneLine(promptOf(WITH_FIX)))).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});

test("Start in a new session reads Starting…, keeps the card when it fails, then opens the new session with the card as its first turn", { tags: ["AGENT-047"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByRole("article", { name: WITH_FIX.title });
  const source = await suggested(hui, screen, "Suggestion source", "Suggestion group");

  const start = await hui.intercept("POST", /\/suggestions\/[^/]+\/start$/u);
  await card.getByRole("button", "Start in a new session").tap();
  await start.arrived();
  await expect(card.getByText("Starting…")).toBeVisible();
  await start.reject(500, "Could not create the session.");
  await expect(screen.getByText("Could not create the session.")).toBeVisible();
  await expect(card).toBeVisible();
  expect(await hui.url()).toContain(`/sessions/${source.id}`);

  await card.getByRole("button", "Start in a new session").tap();
  await expectChatTitle(screen, WITH_FIX.title);
  expect(await hui.url()).not.toContain(`/sessions/${source.id}`);
  await expect(transcript.getByText(oneLine(promptOf(WITH_FIX)))).toBeVisible();
  // The session lands in the card's directory and the source conversation's group; the chat header shows the group
  // only as an upper-cased label beside a status that moves, so the registry is what this reads.
  const created = (await hui.api<{ groups: { sessions: { id: string; title: string; cwd: string; group: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find(({ title }) => title === WITH_FIX.title);
  expect(created?.cwd).toBe(hui.workspace);
  expect(created?.group).toBe("Suggestion group");

  await hui.open(`/sessions/${source.id}`);
  // The started card left the source conversation and the card nobody started is still there to start: the gutter
  // draws one card at a time, so the count of articles alone is a check that passes before the page has drawn any.
  await expect(screen.getByRole("article", { name: NO_FIX.title })).toBeVisible();
  await expect(screen.getByRole("article", { name: WITH_FIX.title })).toHaveCount(0);
});
