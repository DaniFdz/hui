/** A message reached from the keyboard opens its copy menu and names its footer actions, and Escape dismisses a tooltip without stopping the run (CHAT-031). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const shown = async (hui: Hui, transcript: Locator, label: string) => hui.opacity(transcript.getByText(label, { exact: true }).first());

test("a focused message opens its copy menu from the keyboard", { tags: ["CHAT-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const session = await hui.createSession({ title: "Keyboard message actions" });
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await screen.getByLabel("Message").fill("Keyboard actions prompt");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  for (const [modifier, key] of [[null, "ContextMenu"], ["Shift", "F10"]] as const) {
    await transcript.getByRole("button", "Reply to message").first().focus();
    await hui.keyboard.down("Shift");
    await hui.keyboard.down("Tab");
    await hui.keyboard.up("Tab");
    await hui.keyboard.up("Shift");
    if (modifier) await hui.keyboard.down(modifier);
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
    if (modifier) await hui.keyboard.up(modifier);
    await expect(screen.getByText("Copy as markdown")).toBeVisible();
    await screen.getByText("Copy as markdown").tap();
    await expect.poll(() => hui.copied()).toBe("Keyboard actions prompt");
    await expect(screen.getByText("Copy as markdown")).toBeHidden();
  }
});

test("footer actions name themselves on keyboard focus and Escape dismisses a tooltip without stopping the run", { tags: ["CHAT-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Footer tooltips" });
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await screen.getByLabel("Message").fill("First prompt");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  for (const [control, label] of [["Reply to message", "Reply"], ["Copy prompt", "Copy"], ["Rewind to here", "Rewind"], ["Fork into a new session from here", "Fork from here"]] as const) {
    await transcript.getByRole("button", control).first().focus();
    await expect.poll(async () => shown(hui, transcript, label)).toBe(1);
  }

  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect.poll(async () => shown(hui, transcript, "Fork from here")).toBe(0);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await transcript.getByRole("button", "Reply to message").first().focus();
  await expect.poll(async () => shown(hui, transcript, "Reply")).toBe(1);
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect.poll(async () => shown(hui, transcript, "Reply")).toBe(0);
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
