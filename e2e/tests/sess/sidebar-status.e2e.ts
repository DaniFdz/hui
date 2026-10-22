/** Every sidebar row reads its session's live status without being opened, on the web and on iOS (SESS-017). */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const heldHelper = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "sessions_spawn", input: { task: "E2E_REPLAY", label: "Held helper" } })).toString("base64url")}`;
const question = { questions: [{ header: "Pick", question: "Which colour?", options: [{ label: "Red", description: "Warm." }, { label: "Blue", description: "Cool." }] }] };

test("rows read running, waiting and failed sessions and a parent's watcher or subagent live, and idle again once each settles", { tags: ["SESS-017"] }, async ({ screen, hui }) => {
  const row = (title: string, status: string) => screen.getByLabel(new RegExp(`^${title}, status ${status}, tool durable, stage investigation(, unread)?$`, "u"));
  const runs = await hui.createSession({ title: "Runs a turn" });
  const asks = await hui.createSession({ title: "Asks a question" });
  const watches = await hui.createSession({ title: "Keeps a watcher" });
  const delegates = await hui.createSession({ title: "Delegates work" });
  const ask = join(hui.workspace, "ask-sidebar.json");
  await writeFile(ask, JSON.stringify(question));

  try {
    await hui.open("/");
    await expect(row("Runs a turn", "idle")).toBeVisible();

    await hui.prompt(runs, "E2E_REPLAY");
    await hui.provider.held();
    await expect(row("Runs a turn", "running")).toBeVisible();
    await hui.provider.release();
    await expect(row("Runs a turn", "idle")).toBeVisible();

    await hui.prompt(asks, "E2E_ASK_USER:sidebar");
    await expect(row("Asks a question", "waiting")).toBeVisible();

    await hui.createSession({ title: "Fails to start", model: "missing/model" });
    await expect(row("Fails to start", "error")).toBeVisible();

    await hui.prompt(watches, "E2E_WATCHER");
    await expect(screen.getByLabel(/^Keeps a watcher, status idle, watcher or subagent running, tool durable, stage investigation/u)).toBeVisible();

    await hui.prompt(delegates, heldHelper);
    await hui.provider.held();
    await expect(screen.getByLabel(/^Delegates work, status idle, watcher or subagent running, tool durable, stage investigation/u)).toBeVisible();
    await hui.provider.release();
    await expect(row("Delegates work", "idle")).toBeVisible();
  } finally {
    await rm(ask, { force: true });
  }
});
