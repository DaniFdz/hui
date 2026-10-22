/** A sidebar row opens its session at /sessions/:id, every row shows its session's live status as a glyph without being opened, and the list shows its loading, empty and failed states (SESS-016, SESS-072, SESS-073). */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const heldHelper = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "sessions_spawn", input: { task: "E2E_REPLAY", label: "Held helper" } })).toString("base64url")}`;
const question = { questions: [{ header: "Pick", question: "Which colour?", options: [{ label: "Red", description: "Warm." }, { label: "Blue", description: "Cool." }] }] };

test("selecting a row loads its conversation with its header and models, a failed load offers Try again, and the URL opens the same session", { tags: ["SESS-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const heading = screen.getByTestId("session-title", { visible: true });
  const target = await hui.createSession({ title: "Open from the sidebar", group: "Inbox" });
  await hui.prompt(target, "Hello from the sidebar");
  const other = await hui.createSession({ title: "Start elsewhere" });

  await hui.open(`/sessions/${other.id}`);
  await expect(heading).toHaveText("Start elsewhere");
  const row = screen.getByLabel(/^Open from the sidebar, status idle, tool durable, stage investigation/u);
  await expect(row).toBeVisible();
  const load = await hui.intercept("POST", new RegExp(`/__hui/sessions/${target.id}/open$`, "u"));
  await row.tap();
  await load.arrived();
  await expect(screen.getByText("Loading the conversation…")).toBeVisible();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${target.id}$`, "u"));
  await load.reject(503, "The runtime is not ready yet.");
  await expect(screen.getByText("Could not load this conversation")).toBeVisible();
  await expect(screen.getByText("The runtime is not ready yet.")).toBeVisible();

  await screen.getByRole("button", "Try again").tap();
  await expect(transcript.getByText("Hello from the sidebar")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(heading).toHaveText("Open from the sidebar");
  await expect(screen.getByText("durable · INBOX · Idle", { visible: true })).toBeVisible();
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { visible: true })).toBeVisible();

  await hui.open(`/sessions/${target.id}`);
  await expect(heading).toHaveText("Open from the sidebar");
  await expect(transcript.getByText("Hello from the sidebar")).toBeVisible();
  await expect(screen.getByText("durable · INBOX · Idle", { visible: true })).toBeVisible();
});

test("rows show running, waiting and failed sessions and a parent's watcher or subagent live without being opened, and idle rows have no decoration", { tags: ["SESS-072"] }, async ({ screen, hui }) => {
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
    expect(await hui.glyph("Runs a turn")).toEqual({ label: "", animated: false });

    await hui.prompt(runs, "E2E_REPLAY");
    await hui.provider.held();
    await expect(row("Runs a turn", "running")).toBeVisible();
    expect(await hui.glyph("Runs a turn")).toEqual({ label: "", animated: true });
    await hui.provider.release();
    await expect(row("Runs a turn", "idle")).toBeVisible();

    await hui.prompt(asks, "E2E_ASK_USER:sidebar");
    await expect(row("Asks a question", "waiting")).toBeVisible();
    expect(await hui.glyph("Asks a question")).toEqual({ label: "Waiting for your answer", animated: false });

    await hui.createSession({ title: "Fails to start", model: "missing/model" });
    await expect(row("Fails to start", "error")).toBeVisible();
    expect(await hui.glyph("Fails to start")).toEqual({ label: "Session failed", animated: false });

    await hui.prompt(watches, "E2E_WATCHER");
    await expect(screen.getByLabel(/^Keeps a watcher, status idle, watcher or subagent running, tool durable, stage investigation/u)).toBeVisible();
    expect(await hui.glyph("Keeps a watcher")).toEqual({ label: "Watcher or subagent running", animated: true });

    await hui.prompt(delegates, heldHelper);
    await hui.provider.held();
    await expect(screen.getByLabel(/^Delegates work, status idle, watcher or subagent running, tool durable, stage investigation/u)).toBeVisible();
    expect(await hui.glyph("Delegates work")).toEqual({ label: "Watcher or subagent running", animated: true });
    await hui.provider.release();
    await expect(row("Delegates work", "idle")).toBeVisible();
  } finally {
    await rm(ask, { force: true });
  }
});

test("the list shows Loading sessions… and a failed first load, retries once the gateway is back, and keeps its rows when a later refresh fails", { tags: ["SESS-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const list = await hui.intercept("GET", /\/__hui\/sessions$/u);
  const stream = await hui.intercept("GET", /\/__hui\/sessions\/events$/u);
  await hui.open("/");
  await list.arrived();
  await expect(screen.getByText("Loading sessions…")).toBeVisible();
  await list.reject(503, "The gateway is unavailable.");
  await expect(screen.getByText("The gateway is unavailable.")).toBeVisible();
  await stream.reject(503, "The gateway is unavailable.");
  await expect(screen.getByText("No sessions yet.")).toBeVisible();

  await hui.createSession({ title: "Kept through a failed refresh" });
  const row = screen.getByTestId("session-row").filter({ hasText: "Kept through a failed refresh" });
  await expect(screen.getByLabel("Kept through a failed refresh, status idle, tool durable, stage investigation")).toBeVisible();
  const refresh = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.peek(row);
  await row.getByRole("button", "Pin session").tap();
  await refresh.reject(503, "Could not reach the session registry.");
  const pinned = screen.getByLabel("Kept through a failed refresh, status idle, tool durable, stage investigation, pinned");
  await pinned.tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Kept through a failed refresh");
  await expect(pinned).toBeVisible();
  await expect(screen.getByText("Could not reach the session registry.")).toBeHidden();
  await expect(screen.getByText("No sessions yet.")).toBeHidden();
});
