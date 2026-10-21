/** A send locks the composer until the gateway answers; a rejected one gives the draft back once, and a resend of one the gateway took runs once (CHAT-012). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const PROMPT = /\/__hui\/sessions\/[^/]+\/prompt$/u;

test("a send locks the composer until the gateway answers, and one it rejects gives its text and attachment back once, with the reason", { tags: ["CHAT-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message", { visible: true });
  const send = screen.getByRole("button", "Send message", { visible: true });
  const attached = screen.getByRole("button", "Remove fixture.txt", { visible: true });
  const transcript = screen.getByTestId("transcript", { visible: true });

  const session = await hui.createSession({ title: "Rejected send" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Recover me");
  await hui.attach([`${hui.workspace}/fixture.txt`]);
  await expect(attached).toBeVisible();

  const held = await hui.intercept("POST", PROMPT);
  await send.tap();
  await held.arrived();
  await expect(message).toBeDisabled();
  await expect(screen.getByLabel("Choose files")).toBeDisabled();
  await expect(screen.getByLabel("Choose photos")).toBeDisabled();
  await expect(attached).toBeHidden();
  await expect(send).toBeHidden();

  await held.reject(503, "The session runtime is restarting.");
  await expect(transcript.getByText("Not sent — draft recovered.")).toBeVisible();
  await expect(screen.getByText("The session runtime is restarting.")).toBeVisible();
  await expect(message).toHaveValue("Recover me");
  await expect(attached).toBeVisible();
});

test("resending a send whose answer was lost doesn't run it twice", { tags: ["CHAT-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");

  const session = await hui.createSession({ title: "Lost answer" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Run me once");

  const lost = await hui.intercept("POST", PROMPT);
  await send.tap();
  await lost.deliverAndDrop();
  await expect(transcript.getByText("Not sent — draft recovered.")).toBeVisible();
  await expect(message).toHaveValue("Run me once");
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await send.tap();
  await expect(message).toHaveValue("");
  await message.fill("And then this");
  await send.tap();
  await expect(transcript.getByText("And then this")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText("Run me once")).toHaveCount(1);
  await expect(transcript.getByText("Not sent — draft recovered.")).toBeHidden();
});
