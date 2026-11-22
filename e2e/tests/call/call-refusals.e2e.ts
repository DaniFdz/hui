/**
 * Why ChatGPT would not take a call (CALL-013): the call view shows *Call failed* with the gateway's own message, which
 * says what to do, and **Back to the chat** returns to the chat it covered with no card left behind.
 *
 * The page has the web target's fake microphone here (`hui.allowMedia()`), so the microphone is not the obstacle: the
 * gateway's start is. The shared gateway holds no ChatGPT login, which is CALL-013's first reason, for real. The other
 * reasons come from the broker's own answers (`server/bots/calls.ts`): this fixture has one signed-in account at most,
 * so its route cannot refuse a call for a quota, an account, a voice limit or an unreachable ChatGPT, and each is
 * replayed at the status the route gives it. The call never connects, which CALL-002 and CALL-014 keep as their own
 * gap: what is proved here is the view a refused start leaves, and that the chat keeps no record of it.
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

/** The broker's answer when no account is signed in: the shared gateway's own, which the page reads word for word. */
const NO_LOGIN = "Sign in to ChatGPT in Settings → Models → OpenAI → ChatGPT account to call bots with GPT-Live.";

/**
 * The reasons the call route refuses a start beyond the login, with the message and the status it gives each
 * (`server/bots/calls.ts`): every signed-in account waiting for its quota, an account or voice ChatGPT refuses, the
 * voice limit, and a ChatGPT that cannot be reached.
 */
const REFUSALS = [
  { status: 409, message: "Every ChatGPT account is waiting for its quota until 1/1/2030, 9:00:00 AM." },
  { status: 502, message: "GPT-Live is not available on this ChatGPT account or plan, or it refused the call voice." },
  { status: 502, message: "The ChatGPT limit for voice calls was reached. Try again later." },
  { status: 504, message: "ChatGPT could not be reached. Check this machine's connection." },
];

test("a call ChatGPT will not take shows Call failed with the gateway's message, and Back to the chat leaves no card", { tags: ["CALL-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  const header = screen.getByTestId("chat-header");
  try {
    await hui.open(`/bots/${bot.id}`);
    // The fake microphone answers, so a call gets as far as asking the gateway to start it.
    await hui.allowMedia();
    const transcript = screen.getByTestId("transcript");
    await expect(transcript.getByText("Say hi to Juno")).toBeVisible();
    const chat = await hui.textOf(transcript);
    const call = header.getByRole("button", "Call Juno");

    // The gateway's own refusal, unasked for: this fixture has no ChatGPT login, and its message is what a caller reads.
    await call.tap();
    const view = screen.getByLabel("Call with Juno");
    await expect(view.getByText("Call failed")).toBeVisible();
    await expect(view.getByRole("alert")).toHaveText(NO_LOGIN);
    await view.getByRole("button", "Back to the chat").tap();
    await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);

    // Every other reason, each its own answer from the call route: the same view, the gateway's words, and the way back.
    for (const refusal of REFUSALS) {
      const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
      await call.tap();
      // The start is this attempt's own: the call is connecting, waiting on the answer the refusal then replaces.
      await start.arrived();
      await expect(view.getByRole("status")).toHaveText("Connecting…");
      await start.reject(refusal.status, refusal.message);
      await expect(view.getByText("Call failed")).toBeVisible();
      await expect(view.getByRole("alert")).toHaveText(refusal.message);
      await view.getByRole("button", "Back to the chat").tap();
      await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);
    }

    // A call that never started leaves nothing in the chat, and the focus goes back to the button that offers it.
    await expect(transcript).toBeVisible();
    await expect.poll(async () => hui.textOf(transcript)).toBe(chat);
    await expect(transcript.getByText(/^Call with Juno/u)).toHaveCount(0);
    await expect(call).toBeFocused();
  } finally {
    await signedIn.stop();
  }
});
