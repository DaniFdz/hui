/**
 * Escape minimizes a call where **Minimize the call** would (CALL-010): pressed inside the call view it shrinks the call
 * to the same bar, and a call that failed stays on screen instead, since there is nothing left to keep in a bar.
 *
 * The keyboard is the web's: the phone's catalogue entry excludes this outcome, because a phone has no Escape and the
 * view's own **Minimize the call** is the control there. The call is the surface before it connects (`hui.intercept`
 * holds the gateway's start), and the failed one is the shared gateway's own answer: this fixture has no ChatGPT login.
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

/** The broker's answer with no ChatGPT account signed in, which is what this fixture's gateway gives a call. */
const NO_LOGIN = "Sign in to ChatGPT in Settings → Models → OpenAI → ChatGPT account to call bots with GPT-Live.";

test("Escape in the call view minimizes the call as its own Minimize does, and a failed call does not minimize", { tags: ["CALL-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  const header = screen.getByTestId("chat-header");
  try {
    await hui.open(`/bots/${bot.id}`);
    // The fake microphone answers, so the call is waiting on the gateway rather than on a device.
    await hui.allowMedia();
    const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
    await header.getByRole("button", "Call Juno").tap();

    // The call opens with the focus on Hang up, inside the view that owns the chord.
    const view = screen.getByLabel("Call with Juno");
    await expect(view).toBeVisible();
    await start.arrived();
    const hangUp = view.getByRole("button", "Hang up");
    await expect(hangUp).toBeFocused();
    await expect(view.getByRole("button", "Minimize the call")).toBeVisible();

    // Escape stands in for that button: the view goes and the call is in its bar, still the same call.
    await hangUp.press("Escape");
    await expect(view).toHaveCount(0);
    const bar = screen.getByLabel("Call with Juno, minimized");
    await expect(bar).toBeVisible();
    await expect(bar.getByText("Juno")).toBeVisible();
    await expect(bar.getByText("Connecting…")).toBeVisible();
    await expect(bar.getByRole("button", "Mute microphone")).toBeVisible();
    await expect(bar.getByRole("button", "Hang up")).toBeVisible();

    // The bar's own way back shows the call Escape minimized, and not a second one.
    await bar.getByRole("button", "Return to the call with Juno").tap();
    await expect(view).toBeVisible();
    await expect(view.getByRole("status")).toHaveText("Connecting…");

    // A call that failed keeps its view: with the focus inside it, Escape leaves the failure on screen and no bar.
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
    await expect(view.getByRole("alert")).toHaveText(NO_LOGIN);
    await expect(view.getByRole("button", "Minimize the call")).toHaveCount(0);
    const back = view.getByRole("button", "Back to the chat");
    await back.focus();
    await back.press("Escape");
    await expect(view.getByText("Call failed")).toBeVisible();
    await expect(screen.getByLabel("Call with Juno, minimized")).toHaveCount(0);
    await expect(back).toBeVisible();
  } finally {
    await signedIn.stop();
  }
});
