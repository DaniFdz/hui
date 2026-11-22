/**
 * What Mute and Speaker do to a call (CALL-006, CALL-007): **Mute** turns pressed and reads *Muted* until it is pressed
 * again, the minimized bar's microphone button mutes and unmutes that same microphone, and **Speaker** turns pressed
 * and reads *Speaker off* until it is pressed again.
 *
 * Both calls here are the surface before a call connects: the fake microphone answers (`hui.allowMedia()`) and the
 * gateway's start is held (`hui.intercept`), which is the only call a browser without a ChatGPT login can have. That
 * leaves two clauses of each outcome to a call that is up (CALL-002): *Microphone muted* is the status of a listening
 * call, not of a connecting one, and only a connected call can show whether the bot hears the caller and whether its
 * voice stops. What a press does to the controls, and that the bar and the view share the one microphone, is proved
 * here.
 */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** What the gateway answers when a ChatGPT login exists, which is what offers Call at all. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

/** Opens a bot's call, held at the gateway's start, and answers with the view of the call it opened. */
async function connecting(hui: Hui, screen: Screen, name: string) {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await hui.allowMedia();
  const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
  await screen.getByTestId("chat-header").getByRole("button", `Call ${name}`).tap();
  const view = screen.getByLabel(`Call with ${name}`);
  await expect(view).toBeVisible();
  await start.arrived();
  return { start, view };
}

test("Mute turns pressed and reads Muted until it is pressed again, and the bar's microphone button mutes and unmutes the same microphone", { tags: ["CALL-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  try {
    const { start, view } = await connecting(hui, screen, "Juno");
    const mute = () => view.getByRole("toolbar", "Call controls").getByRole("button", "Mute microphone");
    await expect(mute()).toHaveAttribute("aria-pressed", "false");
    await expect(mute()).toHaveText("Mute");

    // Pressed, the same control reads Muted and stays pressed.
    await mute().tap();
    await expect(mute()).toHaveAttribute("aria-pressed", "true");
    await expect(mute()).toHaveText("Muted");

    // The call's own bar carries the microphone too, and it reads the state the view left: pressed, so still muted.
    await view.getByRole("button", "Minimize the call").tap();
    const bar = screen.getByLabel("Call with Juno, minimized");
    await expect(bar).toBeVisible();
    const inBar = bar.getByRole("button", "Mute microphone");
    await expect(inBar).toHaveAttribute("aria-pressed", "true");
    // Unmuted from the bar, the call's microphone is back on in its view as well: one microphone, two controls.
    await inBar.tap();
    await expect(inBar).toHaveAttribute("aria-pressed", "false");
    await bar.getByRole("button", "Return to the call with Juno").tap();
    await expect(mute()).toHaveText("Mute");
    await expect(mute()).toHaveAttribute("aria-pressed", "false");
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
  } finally {
    await signedIn.stop();
  }
});

test("Speaker turns pressed and reads Speaker off until it is pressed again", { tags: ["CALL-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  try {
    const { start, view } = await connecting(hui, screen, "Rhea");
    const controls = view.getByRole("toolbar", "Call controls");
    const speaker = controls.getByRole("button", "Mute speaker");
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    await expect(speaker).toHaveText("Speaker");

    // Pressed, it reads Speaker off and stays pressed…
    await speaker.tap();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    await expect(speaker).toHaveText("Speaker off");
    // …and the microphone's own control is untouched: each button owns its half of the call's audio.
    await expect(controls.getByRole("button", "Mute microphone")).toHaveAttribute("aria-pressed", "false");

    // Pressed again, the speaker comes back.
    await speaker.tap();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    await expect(speaker).toHaveText("Speaker");
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
  } finally {
    await signedIn.stop();
  }
});
