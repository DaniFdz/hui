/** The chat header's Run status panel: it stays shut through every run until the operator opens it, their open and close
 * outlive runs, and the pill morphs into it and back with its top pinned and its right edge travelling while the head reads the same state
 * as the pill (CHAT-090). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

const heldEcho = `E2E_HOLD:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "held" } })).toString("base64url")}`;
/** The turn that leaves the conversation waiting for the operator: the longest Run status phrase a pill ever draws. */
const askDatabase = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "ask_user_question", input: { questions: [{
  header: "Database",
  question: "Which database should the service use?",
  options: [
    { label: "Postgres", description: "Relational, already deployed." },
    { label: "SQLite", description: "One file, no server." },
  ],
}] } })).toString("base64url")}`;
/** The pill's box and the words it shows: read by selector, because a clipped label carries no name of its own. */
const TRIGGER = ".chat-run-status__trigger";
/** The panel itself: the only card the morph paints. */
const PANEL = "[data-testid=\"run-status\"]";
const LABEL = `${TRIGGER} .chat-run-status__label`;
const HEAD_LABEL = `.chat-run-status__head .chat-run-status__label`;
/** The head's whole copy — mark, the one state word and the count — the panel's own title line. */
const HEAD_COPY = `.chat-run-status__head .chat-run-status__state`;
/** The mark that opens that title line, and the close chevron that keeps the box's right edge. */
const HEAD_MARK = `.chat-run-status__head .chat-run-status__state-mark`;
const CLOSE = ".chat-run-status__collapse";
/** A section's own title, the rows' left padding the head's title has to line up with. */
const SECTION_TITLE = `${PANEL} .chat-run-status__section-title`;

test("Run status stays shut through a run until the operator opens it, and then holds", { tags: ["CHAT-090"], platforms: ["web"] }, async ({ screen, hui }) => {
  // HUI writes the plan with the utility model; this instance points it at the fixture.
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Run status panel" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");
  const idle = screen.getByLabel("Session status: Idle");
  /** The panel's own close, the chevron in its head: one press of it is the operator's close. */
  const close = () => screen.getByLabel("Close run status");
  // A held turn: its tool call keeps the run streaming until `hui.provider.release()`. It starts only from an idle
  // session, because a send during a run would steer that run instead of starting the next one.
  const hold = async () => {
    await message.fill(heldEcho);
    await message.press("Enter");
    await hui.provider.held();
  };

  // The first turn writes the plan that keeps the trigger alive, and the run leaves the panel shut: nothing a send does
  // opens it.
  await message.fill("E2E_PROGRESS");
  await send.tap();
  await expect(transcript.getByText("Working through the fixture.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status:/u);
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();

  // The next turn holds the provider, and the run streams with the pill drawn for all of it: still shut, and the send
  // opened nothing. Sent from the keyboard, so the textarea is where the caret comes back once the post lands — HUI
  // disables the composer while a send posts, and nothing else would give it back — while the panel's own state, hidden
  // and collapsed, is what says nothing was pushed over the composer.
  await hold();
  await expect(message).toBeFocused();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Working 1/2");
  await expect(trigger).not.toBeExpanded();
  await expect(popover).toBeHidden();
  // The send landed: the composer took the prompt and emptied itself, and it is usable again.
  await expect(message).toHaveValue("");
  await expect(message).toBeEnabled();

  // The operator's own press is what opens it, and the pill morphs into the panel it opens: the head reads the same state
  // as the trigger — mark, word and count — so one control visibly becomes the other. The panel's settled top-right corner
  // is the actions group's and the pill itself is not painted while the panel is out, so the two boxes never show together; the
  // trigger keeps its box as the anchor and the aria-expanded, word and summary it gives back on close.
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, 1 of 2 steps done$/u);
  // One box: the trigger keeps its box and its aria-expanded as the anchor, but the pill is not painted under or above
  // the panel, whose head is the converted pill.
  await expect(trigger).not.toBeVisible();
  await expect(popover.getByText("Working", { exact: true })).toBeVisible();
  await expect(popover.getByText("1/2", { exact: true })).toBeVisible();

  // Escape closes it, and the focus the show moved into the panel comes back to the pill that anchors it once the box has
  // drawn itself back. The pill paints again, still reading the running state it carried into the panel.
  await close().press("Escape");
  await expect(trigger).not.toBeExpanded();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Working 1/2");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  // That press closed the panel and stopped nothing: the provider is still holding the turn, so Escape never reached
  // the pane's Stop. The status word alone cannot say so, because a stopped run whose provider is still held keeps
  // reading Running; the Stop control is what shows the press asked for a stop, and stays disabled while it waits.
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeEnabled();

  // The operator's close holds past the run it was made in: the panel stays shut when that run is released, and when the
  // run after it starts — which hands the composer its caret back again, since that send started in it too.
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeHidden();
  await hold();
  await expect(message).toBeFocused();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Working 1/2");
  await expect(trigger).not.toBeExpanded();
  await expect(popover).toBeHidden();

  // A press elsewhere in the app is the operator's outside-click close.
  await trigger.tap();
  await expect(popover).toBeVisible();
  await message.tap();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toBeExpanded();

  // An operator's open is theirs too: no run opens or shuts it, so it outlives the run it was made in and stays out
  // through the next one as well.
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeVisible();
  await expect(trigger).not.toBeVisible();
  await hold();
  await expect(popover.getByText("Working", { exact: true })).toBeVisible();
  await expect(popover).toBeVisible();

  // Close run status folds it back into the pill and gives the focus back to the trigger, and that close holds into the
  // run after it too: the one this ends is released first, so the next turn is a run of its own.
  await close().tap();
  await expect(trigger).not.toBeExpanded();
  await expect(trigger).toBeVisible();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await hold();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Working 1/2");
  await expect(trigger).not.toBeExpanded();
  await expect(popover).toBeHidden();

  // One control: a closed panel's pill opens it, and the panel's own chevron closes it, with Escape and an outside click
  // as the other ways out. Each direction draws one painted card — the panel itself — whose width, height and corner grow
  // out of the trigger's own box, read here from the frames the browser drew. The pill is not painted in any of them: the
  // panel's head is the converted pill, and the chevron it turns into is the close. Close run status starts the fold, and
  // its first frame is already on the pinned corner.
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  const chrome = await hui.cardChrome(PANEL);
  expect(chrome?.wrapper).not.toBeNull();
  expect(chrome?.wrapper?.background, "Web Awesome's shadow body paints no card of its own").toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/u);
  expect(chrome?.wrapper?.shadow, "and casts no shadow of its own").toBe("none");
  expect(chrome?.wrapper?.border, "nor draws a border of its own").toBe(0);
  expect(chrome?.node?.border, "the panel is the card, and the box the morph moves").toBeGreaterThan(0);
  expect(chrome?.node?.shadow).not.toBe("none");

  const actions = await hui.rect(".chat-pane__header-actions");
  expect(actions).not.toBeNull();
  const actionsRight = actions!.x + actions!.width;
  const actionsTop = actions!.y;
  const closing = await hui.morphFrames(PANEL, TRIGGER, () => screen.getByLabel("Close run status").tap(), [HEAD_COPY, CLOSE]);
  const shrinking = closing.filter((frame) => frame.box.painted && frame.box.width > 0);
  const settledWidth = Math.max(...shrinking.map((frame) => frame.box.width));
  expect(shrinking.some((frame) => frame.box.width < settledWidth - 20), "the close draws the box shrinking").toBe(true);
  const leaving = shrinking[0];
  expect(leaving?.trigger.painted, "the close starts with no pill beside the panel").toBe(false);
  expect(Math.abs((leaving?.box.top ?? 0) - (leaving?.trigger.top ?? 0)), "the close starts on the pill's own top edge").toBeLessThanOrEqual(1);
  expect(Math.abs((leaving?.box.right ?? 0) - actionsRight), "on the actions group's right edge").toBeLessThanOrEqual(1);
  const arrived = shrinking.at(-1);
  expect(Math.abs((arrived?.box.width ?? 0) - (arrived?.trigger.width ?? 0)), "it arrives as the pill's own box").toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.box.right ?? 0) - (arrived?.trigger.right ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.box.top ?? 0) - (arrived?.trigger.top ?? 0))).toBeLessThanOrEqual(1);
  expect(arrived?.trigger.painted, "and the pill returns only once the close has landed").toBe(false);
  // The title's copy is left-aligned, so a box folding back to the right would carry it with its left edge: it leaves with
  // the fold's first frame instead, and the frames it is painted in all show it at the one x it had while settled.
  const closeTitle = closing.filter((frame) => frame.box.painted && (frame.tracked?.[HEAD_COPY]?.opacity ?? 0) > 0.05);
  expect(closeTitle.length, "the close paints the title before it goes").toBeGreaterThan(0);
  const closeTitleX = closeTitle.map((frame) => frame.tracked?.[HEAD_COPY]?.x ?? Number.NaN);
  expect(Math.max(...closeTitleX) - Math.min(...closeTitleX), "a closing box never carries the title's copy with it").toBeLessThanOrEqual(1);
  expect(arrived?.tracked?.[HEAD_COPY]?.opacity ?? 0, "and the box arrives as the chevron alone").toBeLessThanOrEqual(0.05);
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();
  // The pill paints again once the box has arrived.
  await expect(trigger).toBeVisible();

  const opening = await hui.morphFrames(PANEL, TRIGGER, () => trigger.tap(), [HEAD_COPY, CLOSE]);
  const travelling = opening.filter((frame) => frame.box.painted && frame.box.width > 0);
  const start = travelling[0];
  expect(start?.trigger.painted, "from the first frame only the panel is painted").toBe(false);
  expect(Math.abs((start?.box.width ?? 0) - (start?.trigger.width ?? 0)), "the first frame is the pill's own width").toBeLessThanOrEqual(1);
  expect(Math.abs((start?.box.right ?? 0) - (start?.trigger.right ?? 0)), "on the pill's own top-right corner").toBeLessThanOrEqual(1);
  expect(Math.abs((start?.box.top ?? 0) - (start?.trigger.top ?? 0))).toBeLessThanOrEqual(1);
  expect(travelling.some((frame) => frame.box.width > (start?.trigger.width ?? 0) + 20 && frame.box.width < settledWidth - 20), "the box travels between the two").toBe(true);
  expect(Math.max(...travelling.map((frame) => frame.box.width)), "and ends on the panel's settled width").toBeGreaterThanOrEqual(settledWidth - 1);
  // The top is pinned in every frame; the right edge travels from the pill to the group's fixed edge.
  const arrival = travelling.at(-1);
  expect(Math.abs((arrival?.box.right ?? 0) - actionsRight), "arrival is the actions group's right edge").toBeLessThanOrEqual(1);
  for (const frame of travelling) {
    expect(frame.trigger.painted, `the frame ${frame.box.width}px wide draws no second box`).toBe(false);
    expect(Math.abs(frame.box.top - frame.trigger.top), `the frame ${frame.box.width}px wide keeps the pill's top edge`).toBeLessThanOrEqual(1);
    expect(frame.box.right).toBeGreaterThanOrEqual(frame.trigger.right - 1);
    expect(frame.box.right).toBeLessThanOrEqual(actionsRight + 1);
  }
  // No glide: the head's copy is left-aligned, so a box widening to the left would carry the word with its left edge. The
  // copy is held for the whole growth instead — the chevron, already at the box's right edge, carries the first frame —
  // and written once the box has arrived, where every painted frame shows it at the same x.
  const firstDrawn = opening.filter((frame) => frame.box.painted)[0];
  expect(firstDrawn?.tracked?.[CLOSE]?.opacity ?? 0, "the chevron carries the first frame").toBeGreaterThan(0.5);
  expect(firstDrawn?.tracked?.[HEAD_COPY]?.opacity ?? 0, "while the title waits for the box").toBeLessThanOrEqual(0.05);
  for (const frame of travelling) {
    const copy = frame.tracked?.[HEAD_COPY]?.opacity ?? 0;
    if (frame.box.width < settledWidth - 2) expect(copy, `the ${frame.box.width}px-wide box paints no travelling title`).toBeLessThanOrEqual(0.05);
  }
  const openingTitle = opening.filter((frame) => frame.box.painted && (frame.tracked?.[HEAD_COPY]?.opacity ?? 0) > 0.05);
  expect(openingTitle.length, "the title's copy is written once the box has arrived").toBeGreaterThan(0);
  const openingTitleX = openingTitle.map((frame) => frame.tracked?.[HEAD_COPY]?.x ?? Number.NaN);
  expect(Math.max(...openingTitleX) - Math.min(...openingTitleX), "and it never travels while the box grows").toBeLessThanOrEqual(1);
  // The settled panel reaches the group's fixed top-right; the trigger remains unpainted.
  const settled = await popover.boundingBox();
  const pill = await trigger.boundingBox();
  expect(settled, "the panel is on screen").not.toBeNull();
  expect(pill, "the trigger keeps its box").not.toBeNull();
  expect(Math.abs((settled?.y ?? 0) - (pill?.y ?? 0)), "the settled panel's top is the trigger's").toBeLessThanOrEqual(1);
  expect(Math.abs(((settled?.x ?? 0) + (settled?.width ?? 0)) - actionsRight), "its right edge is the actions group's").toBeLessThanOrEqual(1);
  expect(Math.abs((settled?.y ?? 0) - actionsTop), "and its top edge is the actions group's").toBeLessThanOrEqual(1);
  expect((settled?.x ?? Number.POSITIVE_INFINITY), "the panel reaches left of the pill").toBeLessThan((pill?.x ?? 0) - 20);
  expect((settled?.y ?? 0) + (settled?.height ?? 0), "and its box covers the pill's").toBeGreaterThanOrEqual((pill?.y ?? 0) + (pill?.height ?? 0));
  // The settled panel reads like a card: its first line is the panel's own title — the mark, the one state word and the
  // count — left-aligned on the card's padding, where the section rows below it start, with the close chevron keeping the
  // box's right edge. No word floats alone at the right, and no second title line is added above or below it.
  const headMark = await hui.rect(HEAD_MARK);
  const headWord = await hui.rect(HEAD_LABEL);
  const rowTitle = await hui.rect(SECTION_TITLE);
  const closeChevron = await hui.rect(CLOSE);
  expect(headMark, "the head draws its mark").not.toBeNull();
  expect(rowTitle, "a section row draws its title").not.toBeNull();
  expect(closeChevron, "the close sits in the head").not.toBeNull();
  expect(Math.abs((headMark?.x ?? 0) - (rowTitle?.x ?? 0)), "the head's mark sits on the rows' own left padding").toBeLessThanOrEqual(1);
  expect((headWord?.x ?? 0) - (headMark?.x ?? 0), "the word follows its mark inside the card").toBeGreaterThan(4);
  expect(((settled?.x ?? 0) + (settled?.width ?? 0)) - ((headWord?.x ?? 0) + (headWord?.width ?? 0)), "and it stands clear of the box's right edge").toBeGreaterThan(60);
  expect(((settled?.x ?? 0) + (settled?.width ?? 0)) - ((closeChevron?.x ?? 0) + (closeChevron?.width ?? 0)), "the close chevron keeps the box's right edge").toBeLessThanOrEqual(6);
  await expect(popover.getByText("Working", { exact: true })).toHaveCount(1);
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  await close().tap();
  await expect(trigger).not.toBeExpanded();
  await expect(trigger).toBeVisible();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  await hui.provider.release();
  await expect(idle).toBeVisible();

  // The state's own words are never the part that gets cut. A question turn prints the longest phrase a pill draws —
  // "Waiting for your answer" — with the plan's count beside it, and the label has to hold all of it: a scroll width
  // wider than its box means the pill ellipsizes its own state, which a visibility read would never show.
  await message.fill(askDatabase);
  await send.tap();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status: Waiting for your answer, 1 of 2 steps done$/u);
  await expect(trigger).toBeVisible();
  await expect(popover).toBeHidden();
  await expect.poll(async () => {
    const label = await hui.textOverflow(LABEL);
    return label ? label.scrollWidth - label.clientWidth : Number.NaN;
  }).toBeLessThanOrEqual(1);

  // The panel the operator opens on that same state repeats the phrase in its head, in the pill's own type, and the head
  // must not clip its copy either: it is the only place the state is written while the panel is out.
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect.poll(async () => {
    const head = await hui.textOverflow(HEAD_LABEL);
    return head ? head.scrollWidth - head.clientWidth : Number.NaN;
  }).toBeLessThanOrEqual(1);

  // A resize is not a close: the operator's open survives the phone's narrower window, and the panel is still out. Their
  // own close paints the pill again, where a phone keeps only its mark and the count on one header row and the words move
  // into the accessible name (the labels are the view's own media queries, not this test's).
  await hui.phoneScreen();
  await expect(popover).toBeVisible();
  await close().tap();
  await expect(trigger).not.toBeExpanded();
  await expect(trigger).toBeVisible();
  await expect(popover).toBeHidden();
  await expect.poll(() => hui.drawn(LABEL)).toBe(false);
  await expect.poll(() => hui.drawn(`${TRIGGER} .chat-run-status__mark`)).toBe(true);
  await expect(trigger.getByText("1/2", { exact: true })).toBeVisible();
  await hui.wideScreen();
});
