/**
 * The gateway's own limit on calls (CALL-012): a page that asks for a call while the gateway already holds two — from
 * other tabs or devices — reads *Call failed* with *2 calls are already running. Hang up before starting another.*
 *
 * The browser's half of this outcome, a second bot's Call refusing with *Hang up the call with <bot> first.*, is
 * `one-call.e2e.ts`. The gateway's half needs two live calls, which needs a ChatGPT login and GPT-Live's realtime
 * route, so the call route's answer is replayed at the status it gives (`server/bots/calls.ts`) into the one held
 * start: what is proved here is the view a browser shows when the gateway refuses a call for its limit.
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

/** The broker's refusal at its limit of two calls (`CallBroker.start`, 429). */
const AT_THE_LIMIT = "2 calls are already running. Hang up before starting another.";

test("a call the gateway refuses because two are already running shows Call failed with the limit named", { tags: ["CALL-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  try {
    await hui.open(`/bots/${bot.id}`);
    await hui.allowMedia();
    const transcript = screen.getByTestId("transcript");
    // A fresh bot's chat is read once it has drawn its empty state, so what the call leaves is compared with the chat.
    await expect(transcript.getByText("Say hi to Juno")).toBeVisible();
    const chat = await hui.textOf(transcript);

    const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
    await screen.getByTestId("chat-header").getByRole("button", "Call Juno").tap();
    const view = screen.getByLabel("Call with Juno");
    await expect(view).toBeVisible();
    await start.arrived();
    await expect(view.getByRole("status")).toHaveText("Connecting…");

    // The gateway's refusal: the call fails with its words, and says nothing else went wrong.
    await start.reject(429, AT_THE_LIMIT);
    await expect(view.getByText("Call failed")).toBeVisible();
    await expect(view.getByRole("alert")).toHaveText(AT_THE_LIMIT);
    await expect(view.getByRole("alert")).toHaveCount(1);

    // The chat a refused call leaves is the chat it covered: no card and nothing said.
    await view.getByRole("button", "Back to the chat").tap();
    await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);
    await expect.poll(async () => hui.textOf(transcript)).toBe(chat);
    await expect(transcript.getByText(/^Call with Juno/u)).toHaveCount(0);
  } finally {
    await signedIn.stop();
  }
});
