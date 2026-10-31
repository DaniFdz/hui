/** A session on a worker HUI cannot reach keeps its draft and says so once, under the composer (SESS-014, CHAT-016). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const WORKER = "Frontend box";

test("a session whose worker is out of reach says so once under the composer, keeps its draft and reconnects from there", { tags: ["SESS-014", "CHAT-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker(WORKER);
  const folder = join(worker.home, "work");
  await mkdir(folder, { recursive: true });
  const created = await hui.api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: folder, worker: worker.id, title: "Remote review" });

  await hui.open(`/sessions/${created.session.id}`);
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  await message.fill("Hello");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  await hui.api("POST", `/__hui/workers/${worker.id}/disconnect`);
  const statusLine = screen.getByTestId("composer-status");
  await expect(statusLine).toContainText(`Disconnected from ${WORKER}`);
  // The header carries it too; the chat itself never repeats it a second time.
  await expect(screen.getByText(`Disconnected from ${WORKER}`)).toHaveCount(2);
  await expect(message).toHaveAttribute("placeholder", "Send a message…");
  await expect(statusLine.getByRole("button", { name: "Reconnect" })).toBeVisible();

  // Drafting stays open; only sending waits.
  await message.fill("Draft kept while the worker is away");
  await expect(send).toBeDisabled();

  await statusLine.getByRole("button", { name: "Reconnect" }).tap();
  await expect(statusLine).toHaveCount(0);
  await expect(idle).toBeVisible();
  await expect(message).toHaveValue("Draft kept while the worker is away");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
});
