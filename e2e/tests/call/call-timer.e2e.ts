/**
 * The call a bot's Call opens, and the timer it runs (CALL-002): the view over the bot's chat in the bot's own colour,
 * *Voice call*, the bot's face and name, *Connecting…*, the timer counting from 0:00, the controls with the focus on
 * Hang up, and the privacy line that says where the audio goes.
 *
 * The web target's fake microphone answers (`hui.allowMedia()`), so the call reaches the gateway's start, and the start
 * is held (`hui.intercept`), which is what keeps the call on the surface it has before it connects — the only call a
 * browser without a ChatGPT login can have. Three clauses of CALL-002 therefore stay with a call that is really up: the
 * status *Listening*, the greeting GPT-Live says, and the voice the privacy line names once GPT-Live has chosen it.
 * The timer is read on the app's own clock, so a minute and an hour of it are asserted without waiting for either.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** What the gateway answers when a ChatGPT login exists, which is what offers Call at all. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

/** The privacy line of a call that has not connected yet: no voice is named, because GPT-Live has not chosen one. */
const PRIVACY = "GPT-Live through your ChatGPT account. Audio goes to OpenAI; Juno's chat keeps the call's summary and transcript. HUI stores no audio.";

test("Call over a bot's chat draws its colour, face, name, Connecting…, the timer from 0:00 through 1:05 and 1:02:05, the controls with focus on Hang up and the privacy line", { tags: ["CALL-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  try {
    await hui.open(`/bots/${bot.id}`);
    const transcript = screen.getByTestId("transcript");
    await expect(transcript.getByText("Say hi to Juno")).toBeVisible();
    const composer = screen.getByLabel("Message");
    // With no call up, the chat's composer is the control a press reaches.
    await expect.poll(async () => hui.reachable(composer)).toBe(true);

    await hui.allowMedia();
    await hui.controllableClock();
    const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
    await screen.getByTestId("chat-header").getByRole("button", "Call Juno").tap();

    const view = screen.getByLabel("Call with Juno");
    await expect(view).toBeVisible();
    await start.arrived();
    // The call is drawn over the bot's chat, not instead of it: the chat is still there, and the view covers it.
    await expect(transcript).toBeAttached();
    await expect.poll(async () => hui.reachable(composer)).toBe(false);

    await expect(view.getByText("Voice call")).toBeVisible();
    await expect(view.getByRole("heading", "Juno")).toBeVisible();
    // The face on the stage is the bot's own, and the call takes its colour: the view's stage is that colour.
    const stage = (await hui.faces()).find((face) => face.size === "xl")!;
    expect(stage.color).toMatch(/^#[0-9a-f]{6}$/u);
    await expect(view).toHaveAttribute("style", `--bot-color: ${stage.color}`);
    await expect(view.getByRole("status")).toHaveText("Connecting…");

    // The timer starts at nothing and counts up, with the focus on the button that ends the call.
    await expect(view.getByLabel("Call time 0:00")).toBeVisible();
    await expect(view.getByRole("button", "Hang up")).toBeFocused();
    const controls = view.getByRole("toolbar", "Call controls");
    await expect(controls.getByRole("button", "Mute microphone")).toBeVisible();
    await expect(controls.getByRole("button", "Mute speaker")).toBeVisible();
    await expect(controls.getByRole("button", "Hang up")).toBeVisible();

    // A minute and five seconds of the app's own clock: one minute and five seconds on the call.
    await hui.advanceClock(65_000);
    await expect(view.getByLabel("Call time 1:05")).toBeVisible();
    // An hour later the timer reads hours as well: 1:01:05, then 1:02:05.
    await hui.advanceClock(3_600_000);
    await expect(view.getByLabel("Call time 1:01:05")).toBeVisible();
    await hui.advanceClock(60_000);
    await expect(view.getByLabel("Call time 1:02:05")).toBeVisible();

    // The privacy line names where the call runs, whose chat keeps what was said, and that no audio is stored.
    await expect(view.getByText(/HUI stores no audio\.$/u)).toHaveText(PRIVACY);
    await expect(view.getByRole("alert")).toHaveCount(0);
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
  } finally {
    await signedIn.stop();
  }
});
