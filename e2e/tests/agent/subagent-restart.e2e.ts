/** A subagent running when the gateway restarts carries on where it was, and its answer reaches its parent (AGENT-027). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const heldHelper = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "sessions_spawn", input: { task: "E2E_REPLAY", label: "Restarted helper" } })).toString("base64url")}`;

test("a subagent running when the gateway restarts carries on, and its answer reaches its parent", { tags: ["AGENT-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript", { visible: true });
  const parent = await hui.createSession({ title: "Delegates across a restart" });
  await hui.open(`/sessions/${parent.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill(heldHelper);
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await hui.restartGateway();
  await hui.reload();
  await hui.open(`/sessions/${parent.id}`);
  await hui.provider.held();
  await hui.provider.release();

  await expect(transcript.getByText("Subagent finished: Restarted helper")).toBeVisible();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(transcript.getByText("The HUI gateway restarted before this subagent finished.")).toBeHidden();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
