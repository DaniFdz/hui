/** `hui doctor`'s chief folders check: a chief that still works in its group's project folder is reported, a chief already
 * in its own folder is not, and `--fix` moves the chat's directory, its session record and its bot record, and nothing
 * else. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationId } from "@earendil-works/pi-durable";
import { afterAll, beforeEach, test } from "vitest";
import type { BotRecord } from "../server/bots-format.ts";
import type { SessionRecord } from "../server/sessions/sessions.ts";

// HUI's configuration directory, the Durable store and PI's agent directory resolve at import time: never the
// operator's own.
const root = await mkdtemp(join(tmpdir(), "hui-doctor-chiefs-"));
const config = join(root, "config", "hui");
const store = join(root, "durable");
const agentDir = join(root, "agent");
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
process.env["HUI_DURABLE_DIR"] = store;
process.env["PI_CODING_AGENT_DIR"] = agentDir;
afterAll(() => rm(root, { recursive: true, force: true }));
await mkdir(agentDir, { recursive: true });

const { createChiefsCheck } = await import("./doctor-chiefs.ts");
const { BOTS_DIR, BOTS_FILE } = await import("../server/bots/bots.ts");
const { readRegistry, writeRegistry } = await import("../server/sessions/sessions.ts");
const { DurableHost, durableContext } = await import("../server/runtimes/durable-host.ts");

const TIME = "2026-10-01T10:00:00.000Z";
const project = join(root, "project");
const own = join(BOTS_DIR, "payments");

type Stored = Record<string, unknown>;

/** A stored bot record: a group chief unless `extra` says otherwise. */
const bot = (id: string, cwd: string, extra: Partial<BotRecord> = {}): BotRecord => ({
  id, handle: id, name: `Chief of Staff · ${id}`, title: "Chief of Staff", cwd, sessionId: `s-${id}`, createdAt: TIME, updatedAt: TIME, ...extra,
}) as BotRecord;

/** A bot's chat record, on the Durable conversation `reference`. */
const chat = (id: string, cwd: string, reference: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id: `s-${id}`, title: id, group: "", cwd, tool: "durable", piSessionFile: reference, createdAt: TIME, updatedAt: TIME, ...extra,
}) as SessionRecord;

async function writeBots(bots: readonly BotRecord[]): Promise<void> {
  await writeFile(BOTS_FILE, JSON.stringify({ version: 1, bots }));
}

/** A Durable conversation in the given directory, as a bot's chat is created. */
async function createConversation(cwd: string): Promise<string> {
  const host = new DurableHost({ dir: store, agentDir, resume: false });
  host.configureDurableBots(null);
  const harness = await host.open();
  try {
    const created = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd } }, durableContext);
    return `durable:${String(created.id)}`;
  } finally {
    await host.close();
  }
}

/** The directory the conversation works in, read back from the store. */
async function conversationCwd(reference: string): Promise<string | undefined> {
  const host = new DurableHost({ dir: store, agentDir, resume: false });
  host.configureDurableBots(null);
  const harness = await host.open();
  try {
    const id = Number(reference.slice("durable:".length)) as ConversationId;
    const conversation = await harness.conversation(id, durableContext);
    return conversation ? (await conversation.agent(durableContext)).cwd : undefined;
  } finally {
    await host.close();
  }
}

beforeEach(async () => {
  await rm(BOTS_FILE, { force: true });
  await rm(BOTS_DIR, { recursive: true, force: true });
  await rm(store, { recursive: true, force: true });
  await rm(join(config, "sessions.json"), { force: true });
  await rm(join(config, "backups"), { recursive: true, force: true });
  await mkdir(project, { recursive: true });
  await mkdir(own, { recursive: true });
});

test("a chief that works in its group's project folder is reported with both paths", async () => {
  const reference = await createConversation(project);
  await writeBots([bot("payments", project, { group: "Payments", description: "Keeps payments." })]);
  await writeRegistry([chat("payments", project, reference)]);

  const result = await createChiefsCheck().inspect();
  assert.equal(result.status, "issue");
  assert.equal(result.summary, "1 chief still works outside its own folder");
  assert.deepEqual(result.items.map(({ id, status }) => [id, status]), [["payments", "issue"]]);
  assert.equal(result.items[0]!.label, "Chief of Staff · payments (@payments)");
  const detail = result.items[0]!.detail ?? "";
  assert.ok(detail.includes(project) && detail.includes(own), detail);
  assert.match(detail, /--fix moves its chat there/u);
  assert.ok(result.notes.some((note) => /hui doctor --fix moves each chief's chat/u.test(note)));
});

test("a chief already in its own folder is not reported, and a chief on a worker is left to its machine", async () => {
  await writeBots([
    bot("payments", own, { group: "Payments" }),
    bot("search", "/home/devbox/work/search", { title: "Chief of Staff · Search", group: "Search", worker: "devbox" }),
  ]);
  const result = await createChiefsCheck().inspect();
  assert.deepEqual([result.status, result.items], ["ok", []]);
  assert.equal(result.summary, "Every Chief of Staff on this machine works in its own folder");
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0]!, /@search/u);
  assert.match(result.notes[0]!, /does not read a worker's home offline/u);
});

test("--fix moves the conversation, its session record and its bot record, and nothing else", async () => {
  const reference = await createConversation(project);
  const otherReference = await createConversation(project);
  const helper = bot("helper", project, { title: "Release helper", group: "Releases", handle: "helper", description: "Not a chief." });
  await writeBots([bot("payments", project, { group: "Payments", description: "Keeps payments.", model: "hui-e2e/fixture" }), helper]);
  const unrelated = chat("helper", project, otherReference, { title: "Release helper" });
  await writeRegistry([chat("payments", project, reference), unrelated]);
  const before = JSON.parse(await readFile(BOTS_FILE, "utf8")) as { bots: Stored[] };

  const check = createChiefsCheck();
  assert.ok(check.fix);
  const fixed = await check.fix();
  assert.equal(fixed.status, "fixed");
  assert.deepEqual(fixed.items.map(({ id, status }) => [id, status]), [["payments", "fixed"]]);
  assert.ok(fixed.notes.some((note) => note.startsWith("Registry backup: ")));
  assert.ok(fixed.notes.some((note) => note.startsWith("Bot registry backup: ")));

  // The bot record: its directory and timestamp change, every other field stays, and no other record moves.
  const after = JSON.parse(await readFile(BOTS_FILE, "utf8")) as { bots: Stored[] };
  assert.deepEqual(after.bots[1], before.bots[1]);
  assert.deepEqual(after.bots[0], { ...before.bots[0], cwd: own, updatedAt: after.bots[0]!["updatedAt"] });
  assert.equal(after.bots[0]!["cwd"], own);
  assert.notEqual(after.bots[0]!["updatedAt"], TIME);

  // The chat's session record moves with it; the ordinary bot's chat is untouched.
  const records = await readRegistry();
  assert.deepEqual(records.map((record) => [record.id, record.cwd]), [["s-payments", own], ["s-helper", project]]);

  // The conversation itself works in the new folder, which is what the next gateway start reads.
  assert.equal(await conversationCwd(reference), own);
  assert.equal(await conversationCwd(otherReference), project);

  // Both registries were copied before the first write.
  const backups = await readdir(join(config, "backups"));
  assert.equal(backups.filter((name) => name.startsWith("sessions-")).length, 1);
  assert.equal(backups.filter((name) => name.startsWith("bots-")).length, 1);

  // Idempotent: once moved, nothing is reported and a second --fix changes nothing.
  const again = await check.fix();
  assert.deepEqual([again.status, again.items], ["ok", []]);
  assert.deepEqual(JSON.parse(await readFile(BOTS_FILE, "utf8")), after);
});

test("a chief with an interrupted run is blocked and --fix leaves its records as they were", async () => {
  const reference = await createConversation(project);
  await writeBots([bot("payments", project, { group: "Payments" })]);
  await writeRegistry([chat("payments", project, reference, { runStartedAt: TIME, runPrompt: "continue" })]);
  const bots = await readFile(BOTS_FILE, "utf8");
  const check = createChiefsCheck();
  const result = await check.inspect();
  assert.deepEqual(result.items.map(({ id, status }) => [id, status]), [["payments", "blocked"]]);
  assert.match(result.items[0]!.detail ?? "", /interrupted run/u);
  assert.ok(check.fix);
  const fixed = await check.fix();
  assert.equal(fixed.status, "issue");
  assert.equal(await readFile(BOTS_FILE, "utf8"), bots, "the bot record is not written");
  assert.equal((await readRegistry())[0]!.cwd, project);
  assert.equal(await conversationCwd(reference), project);
});
