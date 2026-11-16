/** The chat header's Run status panel: the pill morphs into it and back from one pinned top-right corner, the head reads
 * the same state as the pill, and a wide window's automatic open, Close run status, Escape and an outside click own it
 * (CHAT-090). */
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

test("Run status opens by itself while a run works, and its chevron folds it back", { tags: ["CHAT-090"], platforms: ["web"] }, async ({ screen, hui }) => {
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
  // A wide window opens the panel by itself while a turn streams; sent from the keyboard, so the composer keeps the
  // focus that automatic open must not steal.
  const hold = async () => {
    await message.fill(heldEcho);
    await message.press("Enter");
    await hui.provider.held();
  };

  // The first turn writes the plan that keeps the trigger alive. Wait for it to settle before reading the panel: a wide
  // window has that panel open while a run streams, so a closed panel is only provable once the run is over.
  await message.fill("E2E_PROGRESS");
  await send.tap();
  await expect(transcript.getByText("Working through the fixture.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status:/u);
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();

  // The next turn holds the provider, and the pill morphs into the panel it opens: the head reads the same state as the
  // trigger — mark, word and count — so one control visibly becomes the other. The panel's settled top-right corner is
  // the pill's and the pill itself is not painted while the panel is out, so the two boxes never show together; the
  // trigger keeps its box as the anchor and the aria-expanded, word and summary it gives back on close.
  await hold();
  await expect(popover).toBeVisible();
  await expect(message).toBeFocused();
  await expect(trigger).toBeExpanded();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, 1 of 2 steps done$/u);
  // One box: the trigger keeps its box and its aria-expanded as the anchor, but the pill is not painted under or above
  // the panel, whose head is the converted pill.
  await expect(trigger).not.toBeVisible();
  await expect(popover.getByText("Working", { exact: true })).toBeVisible();
  await expect(popover.getByText("1/2", { exact: true })).toBeVisible();

  // Escape closes it. The panel auto-opened onto the composer's focus and the pill is not painted, so a hidden trigger
  // cannot take the focus back: the operator's caret stays in the composer, which is also where Escape must not reach
  // the pane's Stop.
  await message.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();
  await expect(message).toBeFocused();
  // The pill paints again once the close has landed, still reading the running state it carried into the panel.
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Working 1/2");

  // That press closed the panel and stopped nothing: the provider is still holding the turn, so Escape never reached
  // the pane's Stop. The status word alone cannot say so, because a stopped run whose provider is still held keeps
  // reading Running; the Stop control is what shows the press asked for a stop, and stays disabled while it waits.
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeEnabled();

  // The operator's close holds for the run it was made in, and the next run starts from the default again.
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeHidden();

  // The next run opens the panel by itself and closes it when it settles, with no press from the operator. That close is
  // HUI's own, so the run after it opens the panel again instead of finding the panel shut by a choice nobody made.
  await hold();
  await expect(popover).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeHidden();

  await hold();
  await expect(popover).toBeVisible();

  // One control: a closed panel's pill opens it, and the panel's own chevron closes it, with Escape and an outside click
  // as the other ways out. Each direction draws one painted card — the panel itself — whose width, height and corner grow
  // out of the trigger's own box, read here from the frames the browser drew. The pill is not painted in any of them: the
  // panel's head is the converted pill, and the chevron it turns into is the close. Close run status starts the fold, and
  // its first frame is already on the pinned corner.
  const chrome = await hui.cardChrome(PANEL);
  expect(chrome?.wrapper).not.toBeNull();
  expect(chrome?.wrapper?.background, "Web Awesome's shadow body paints no card of its own").toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/u);
  expect(chrome?.wrapper?.shadow, "and casts no shadow of its own").toBe("none");
  expect(chrome?.wrapper?.border, "nor draws a border of its own").toBe(0);
  expect(chrome?.node?.border, "the panel is the card, and the box the morph moves").toBeGreaterThan(0);
  expect(chrome?.node?.shadow).not.toBe("none");

  const closing = await hui.morphFrames(PANEL, TRIGGER, () => screen.getByLabel("Close run status").tap());
  const shrinking = closing.filter((frame) => frame.box.painted && frame.box.width > 0);
  const settledWidth = Math.max(...shrinking.map((frame) => frame.box.width));
  expect(shrinking.some((frame) => frame.box.width < settledWidth - 20), "the close draws the box shrinking").toBe(true);
  const leaving = shrinking[0];
  expect(leaving?.trigger.painted, "the close starts with no pill beside the panel").toBe(false);
  expect(Math.abs((leaving?.box.top ?? 0) - (leaving?.trigger.top ?? 0)), "the close starts on the pill's own top edge").toBeLessThanOrEqual(1);
  expect(Math.abs((leaving?.box.right ?? 0) - (leaving?.trigger.right ?? 0)), "and on its right edge").toBeLessThanOrEqual(1);
  const arrived = shrinking.at(-1);
  expect(Math.abs((arrived?.box.width ?? 0) - (arrived?.trigger.width ?? 0)), "it arrives as the pill's own box").toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.box.right ?? 0) - (arrived?.trigger.right ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.box.top ?? 0) - (arrived?.trigger.top ?? 0))).toBeLessThanOrEqual(1);
  expect(arrived?.trigger.painted, "and the pill returns only once the close has landed").toBe(false);
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();
  // The pill paints again once the box has arrived.
  await expect(trigger).toBeVisible();

  const opening = await hui.morphFrames(PANEL, TRIGGER, () => trigger.tap());
  const travelling = opening.filter((frame) => frame.box.painted && frame.box.width > 0);
  const start = travelling[0];
  expect(start?.trigger.painted, "from the first frame only the panel is painted").toBe(false);
  expect(Math.abs((start?.box.width ?? 0) - (start?.trigger.width ?? 0)), "the first frame is the pill's own width").toBeLessThanOrEqual(1);
  expect(Math.abs((start?.box.right ?? 0) - (start?.trigger.right ?? 0)), "on the pill's own top-right corner").toBeLessThanOrEqual(1);
  expect(Math.abs((start?.box.top ?? 0) - (start?.trigger.top ?? 0))).toBeLessThanOrEqual(1);
  expect(travelling.some((frame) => frame.box.width > (start?.trigger.width ?? 0) + 20 && frame.box.width < settledWidth - 20), "the box travels between the two").toBe(true);
  expect(Math.max(...travelling.map((frame) => frame.box.width)), "and ends on the panel's settled width").toBeGreaterThanOrEqual(settledWidth - 1);
  // The corner is pinned for every frame of the growth, not only its first: the panel settles on the pill's top-right
  // corner, so the box only widens left and its top and right edges never move — and the pill is painted in none of them.
  for (const frame of travelling) {
    expect(frame.trigger.painted, `the frame ${frame.box.width}px wide draws no second box`).toBe(false);
    expect(Math.abs(frame.box.top - frame.trigger.top), `the frame ${frame.box.width}px wide keeps the pill's top edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.box.right - frame.trigger.right), `the frame ${frame.box.width}px wide keeps the pill's right edge`).toBeLessThanOrEqual(1);
  }
  // And the settled panel is that corner, covering the pill's whole box: no fragment of the pill is left above it.
  const settled = await popover.boundingBox();
  const pill = await trigger.boundingBox();
  expect(settled, "the panel is on screen").not.toBeNull();
  expect(pill, "the trigger keeps its box").not.toBeNull();
  expect(Math.abs((settled?.y ?? 0) - (pill?.y ?? 0)), "the settled panel's top is the trigger's").toBeLessThanOrEqual(1);
  expect(Math.abs(((settled?.x ?? 0) + (settled?.width ?? 0)) - ((pill?.x ?? 0) + (pill?.width ?? 0))), "and its right edge is the trigger's").toBeLessThanOrEqual(1);
  expect((settled?.x ?? Number.POSITIVE_INFINITY), "the panel reaches left of the pill").toBeLessThan((pill?.x ?? 0) - 20);
  expect((settled?.y ?? 0) + (settled?.height ?? 0), "and its box covers the pill's").toBeGreaterThanOrEqual((pill?.y ?? 0) + (pill?.height ?? 0));
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  await screen.getByLabel("Close run status").tap();
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
  await expect.poll(async () => {
    const label = await hui.textOverflow(LABEL);
    return label ? label.scrollWidth - label.clientWidth : Number.NaN;
  }).toBeLessThanOrEqual(1);

  // The panel the waiting run opened repeats that phrase in its head, in the pill's own type, and the head must not
  // clip its copy either: it is the only place the state is written while the panel is out.
  await expect(popover).toBeVisible();
  await expect.poll(async () => {
    const head = await hui.textOverflow(HEAD_LABEL);
    return head ? head.scrollWidth - head.clientWidth : Number.NaN;
  }).toBeLessThanOrEqual(1);

  // A phone spends the pill's words on its accessible name and keeps the mark and the count, so one header row reads
  // the state without wrapping (the labels are the view's own media queries, not this test's).
  await hui.phoneScreen();
  await expect.poll(() => hui.drawn(LABEL)).toBe(false);
  await expect.poll(() => hui.drawn(`${TRIGGER} .chat-run-status__mark`)).toBe(true);
  await expect(trigger.getByText("1/2", { exact: true })).toBeVisible();
  await hui.wideScreen();
});
