/**
 * Minimizing a call and going back to it (CALL-009): **Minimize the call** shrinks the view to a bar above the chat with
 * the bot's face, its name, the call's status, its timer, a microphone button and Hang up, the chat underneath stays
 * usable, and either the bar's *Return to the call with <bot>* or the header's button of that name opens the view again
 * with the same call still up.
 *
 * The gateway's start is held (`hui.intercept`), so the call keeps the surface it has before it connects — status
 * *Connecting…*, the timer running — which is all this outcome is about: the bar, the way back and the chat under it.
 * A connected call needs the gateway's GPT-Live session (CALL-002), and this test lets the held start through at the end
 * only to close the call it opened.
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

test("Minimize the call leaves a bar with the bot's face, name, status and timer over a usable chat, and either Return opens the view again", { tags: ["CALL-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  const header = screen.getByTestId("chat-header");
  const smaller = async (size: string) => (await hui.faces()).filter((face) => face.size === size).length;
  try {
    await hui.open(`/bots/${bot.id}`);
    // The fake microphone answers, so the call opens and waits on the gateway instead of failing on the microphone.
    await hui.allowMedia();
    // The call's timer is read on the app's own clock, so both sides of a minute are asserted instead of waited out.
    await hui.controllableClock();
    const start = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/calls$/u);
    await header.getByRole("button", "Call Juno").tap();

    const view = screen.getByLabel("Call with Juno");
    await expect(view).toBeVisible();
    await start.arrived();
    // The call's own face is on its stage, at the size only the call view draws.
    await expect.poll(async () => await smaller("xl")).toBe(1);
    const smallFaces = await smaller("sm");

    await view.getByRole("button", "Minimize the call").tap();
    const bar = screen.getByLabel("Call with Juno, minimized");
    await expect(bar).toBeVisible();
    await expect(view).toHaveCount(0);
    // The bar carries the bot's face — the call's own gone, one small one added — and its name, status and timer.
    await expect.poll(async () => await smaller("xl")).toBe(0);
    await expect.poll(async () => await smaller("sm")).toBe(smallFaces + 1);
    await expect(bar.getByText("Juno")).toBeVisible();
    await expect(bar.getByText("Connecting…")).toBeVisible();
    await expect(bar.getByText("0:00", { exact: true })).toBeVisible();
    await expect(bar.getByRole("button", "Mute microphone")).toBeVisible();
    await expect(bar.getByRole("button", "Hang up")).toBeVisible();

    // It takes a band of its own: the chat starts below it, so the page under it is usable rather than covered.
    const band = (await bar.boundingBox())!;
    const below = (await header.boundingBox())!;
    expect(below.y).toBeGreaterThanOrEqual(band.y + band.height);
    const composer = screen.getByLabel("Message");
    await composer.fill("A note while the call waits");
    await expect(composer).toHaveValue("A note while the call waits");

    // The call goes on while it is minimized: its timer counts a minute and five seconds.
    await hui.advanceClock(65_000);
    await expect(bar.getByText("1:05", { exact: true })).toBeVisible();

    // The bar's way back opens the same call, at the time it has reached, in its own view.
    await bar.getByRole("button", "Return to the call with Juno").tap();
    await expect(view).toBeVisible();
    await expect(view.getByLabel("Call time 1:05")).toBeVisible();
    await expect(view.getByRole("status")).toHaveText("Connecting…");
    await expect(screen.getByLabel("Call with Juno, minimized")).toHaveCount(0);

    // Minimized again, the header's button of the same name is the other way back, and it too keeps the call up.
    await view.getByRole("button", "Minimize the call").tap();
    await expect(bar).toBeVisible();
    await header.getByRole("button", "Return to the call with Juno").tap();
    await expect(view).toBeVisible();
    await expect(view.getByLabel("Call time 1:05")).toBeVisible();

    // The start this test held is the real one: let through, it fails on the fixture's missing ChatGPT login.
    await start.deliver();
    await expect(view.getByText("Call failed")).toBeVisible();
    await view.getByRole("button", "Back to the chat").tap();
    await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);
  } finally {
    await signedIn.stop();
  }
});
