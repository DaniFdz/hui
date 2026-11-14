/**
 * A call gets past the microphone (CALL-003's first half): with the page allowed a microphone, tapping Call opens the
 * call view over the bot's chat and asks the gateway to start the call, showing the surface a call has before it is
 * connected — the status *Connecting…*, the timer, the controls and the privacy line — and no microphone alert.
 *
 * The web target's Chromium carries a fake camera and microphone (`fixtures/web-browser.ts`), so `hui.allowMedia()`
 * grants a device that answers instead of a headless "No microphone was found". What is still out of reach is a
 * connected call: GPT-Live needs a ChatGPT login and the gateway's realtime route, so the held start is let through at
 * the end and the call fails on the missing login, which is what says the microphone was no longer the obstacle.
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

/** What the gateway says when a call reaches it with no ChatGPT login: the obstacle left once the microphone opened. */
const NO_LOGIN = "Sign in to ChatGPT in Settings → Models → OpenAI → ChatGPT account to call bots with GPT-Live.";

test("a call opens its view and asks the gateway to start once the microphone is allowed", { tags: ["CALL-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  try {
    await hui.open(`/bots/${bot.id}`);
    // The fake camera and microphone answer only once the page is allowed them; without this the call would fail on a
    // refused microphone, as CALL-004 proves it does.
    await hui.allowMedia();

    // The gateway's start is held, so the call stays in the state it has before it connects: what a test can read
    // without a ChatGPT login and its realtime route.
    const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
    await screen.getByTestId("chat-header").getByRole("button", "Call Juno").tap();

    const view = screen.getByLabel("Call with Juno");
    await expect(view).toBeVisible();
    // Reaching this means the microphone opened: the page only asks the gateway to start a call after that.
    await start.arrived();
    await expect(view.getByText("Voice call")).toBeVisible();
    await expect(view.getByRole("heading", "Juno")).toBeVisible();
    await expect(view.getByRole("status")).toHaveText("Connecting…");
    await expect(view.getByLabel(/^Call time 0:/u)).toBeVisible();
    const controls = view.getByRole("toolbar", "Call controls");
    await expect(controls.getByRole("button", "Mute microphone")).toBeVisible();
    await expect(controls.getByRole("button", "Mute speaker")).toBeVisible();
    await expect(controls.getByRole("button", "Hang up")).toBeVisible();
    // Nothing has failed: no microphone alert, and the privacy line says where the audio goes.
    await expect(view.getByRole("alert")).toHaveCount(0);
    await expect(view.getByText(/GPT-Live through your ChatGPT account\./u)).toBeVisible();
    await expect(view.getByText(/HUI stores no audio\.$/u)).toBeVisible();

    // Let the start through: the gateway has no ChatGPT login for this fixture, so the call fails for that reason and
    // not for the microphone, and Back to the chat returns to the chat it covered.
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
    await expect(view.getByRole("alert")).toHaveText(NO_LOGIN);
    await view.getByRole("button", "Back to the chat").tap();
    await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);
  } finally {
    await signedIn.stop();
  }
});
