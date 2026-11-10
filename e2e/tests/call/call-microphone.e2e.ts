/**
 * A call that cannot reach a microphone says so on the call view and leaves the chat as it was (CALL-004): *Call failed*,
 * the reason under it in the browser's own words, and **Back to the chat** closes the view without adding anything to
 * the bot's chat. This world has no audio input, which is what a browser answers when none is connected.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

test("a call without a microphone shows Call failed with the reason and Back to the chat closes it with nothing left in the chat", { tags: ["CALL-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Hush", soul: "# Who I am\nA bot the CALL area calls.\n" })).bot;
  await hui.chatGptLogin(true);
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Hush");
  const header = screen.getByTestId("chat-header");
  const transcript = screen.getByTestId("transcript");

  // A bot nobody has talked to yet: what the chat holds before the call is the empty conversation.
  await expect(transcript.getByText("Say hi to Hush")).toBeVisible();
  const before = await hui.textOf(transcript);

  await header.getByRole("button", "Call Hush").tap();
  const call = screen.getByLabel("Call with Hush");
  await expect(call).toBeVisible();
  await expect(call.getByText("Voice call")).toBeVisible();
  await expect(call.getByRole("status")).toHaveText("Call failed");
  await expect(call.getByRole("alert")).toHaveText("No microphone was found. Connect one and try again.");
  // A failed call offers nothing to hang up or minimize, only the way back.
  await expect(call.getByRole("button", "Minimize the call")).toHaveCount(0);
  await expect(call.getByRole("button", "Hang up")).toHaveCount(0);
  await expect(call.getByRole("button", "Back to the chat")).toBeVisible();
  await expect(call.getByText(/GPT-Live through your ChatGPT account/u)).toBeVisible();
  await expect(call.getByText(/HUI stores no audio/u)).toBeVisible();

  await call.getByRole("button", "Back to the chat").tap();
  await expect(call).toHaveCount(0);
  // The chat is where it was: no call card, no message, and the header's Call is focused again.
  await expect(screen.getByLabel("About Hush")).toBeVisible();
  await expect(panel.getByRole("button", "Call Hush")).toBeVisible();
  await expect(header.getByRole("button", "Call Hush")).toBeFocused();
  expect(await hui.textOf(transcript)).toBe(before);
  await expect(screen.getByText("Call with Hush", { exact: false })).toHaveCount(0);

  // HUI's own desktop app hands the page no microphone at all, and the call says that instead of blaming a device.
  await hui.spoofUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HUI/0.1.6 Chrome/141.0.0.0 Electron/39.0.0 Safari/537.36");
  await hui.reload();
  await panelOverview(screen, "Hush");
  await header.getByRole("button", "Call Hush").tap();
  await expect(call.getByRole("alert")).toHaveText("HUI's desktop app does not allow the microphone yet. Open HUI in a browser to talk to bots.");
  await call.getByRole("button", "Back to the chat").tap();
  await expect(call).toHaveCount(0);
});
