import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

// The store, HUI's directory and PI's agent directory resolve at import time: never the operator's own.
const root = await mkdtemp(join(tmpdir(), "hui-doctor-optchat-"));
const store = join(root, "durable");
const agentDir = join(root, "agent");
const workspace = join(root, "workspace");
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
afterAll(() => rm(root, { recursive: true, force: true }));
await mkdir(agentDir, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: "http://127.0.0.1:9", api: "anthropic-messages", apiKey: "fixture-key", models: [{
    id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture" }));

const { createOptChatCheck } = await import("./doctor-optchat.ts");
const { DurableHost, durableContext } = await import("../server/runtimes/durable-host.ts");
const { enableOptChat, OptChatDoc } = await import("../server/runtimes/durable-optchat.ts");
const { defineDoc, Harness } = await import("@earendil-works/pi-durable");
const { createRegistry } = await import("@earendil-works/pi-durable");
const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
type DurableHarness = import("@earendil-works/pi-durable").Harness;
type Tx = import("@earendil-works/pi-durable").Tx;
type ConversationId = import("@earendil-works/pi-durable").ConversationId;

/** OptChat's document as an older HUI stored it. */
const LegacyOptChatDoc = defineDoc<{ enabled: boolean; name: string }>({
  kind: "hui.optchat", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ enabled: false, name: "" }),
  checkpointWhen: () => false,
});

const models = { getAuth: () => undefined } as unknown as import("@earendil-works/pi-ai").Models;

async function rawHarness(): Promise<DurableHarness> {
  return Harness.open(await openNodeSqliteStorage(join(store, "harness.sqlite")), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
}

/** A store with one bot chat, whose OptChat document an older HUI wrote, and one without OptChat. */
async function setup(): Promise<{ bot: ConversationId; plain: ConversationId }> {
  await rm(store, { recursive: true, force: true });
  const host = new DurableHost({ dir: store, agentDir, resume: false });
  host.configureDurableBots(null);
  const harness = await host.open();
  const bot = await harness.createConversation({
    ownership: { kind: "ownerless" },
    agent: { cwd: workspace, model: { provider: "hui-e2e", modelId: "fixture" } },
    init: (tx: Tx, id) => enableOptChat(tx, id, { name: "Grok" }),
  }, durableContext);
  const plain = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd: workspace } }, durableContext);
  await host.close();

  const raw = await rawHarness();
  try {
    await raw.commit(async (tx) => {
      const current = await tx.doc(OptChatDoc, bot.id);
      const kept = { enabled: current.enabled, name: current.name };
      await tx.retireDoc(OptChatDoc, bot.id);
      Object.assign(await tx.doc(LegacyOptChatDoc, bot.id), kept);
    }, BACKGROUND_CONTEXT);
  } finally {
    await raw.close(BACKGROUND_CONTEXT);
  }
  return { bot: bot.id, plain: plain.id };
}

test("the report names every conversation whose OptChat document an older HUI wrote, and writes nothing", async () => {
  const { bot } = await setup();
  const check = createOptChatCheck({ dir: store });
  const report = await check.inspect();
  assert.equal(report.status, "issue");
  assert.deepEqual(report.items.map((item) => [item.id, item.label, item.status]), [
    [String(bot), `"Grok" (conversation ${bot})`, "issue"],
  ], "the plain conversation has no document, so only the bot's is named");
  assert.equal(report.summary, "found 1 OptChat document an older HUI wrote");

  // Reading the current document still fails: the report changed nothing.
  const raw = await rawHarness();
  await assert.rejects(raw.snapshot(OptChatDoc, bot, BACKGROUND_CONTEXT), /does not match the supplied definition semantics/u);
  await raw.close(BACKGROUND_CONTEXT);
});

test("--fix rewrites the document as the current one, keeping its value", async () => {
  const { bot } = await setup();
  const check = createOptChatCheck({ dir: store });
  const fixed = await check.fix!();
  assert.equal(fixed.status, "fixed");
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [[String(bot), "fixed"]]);

  const raw = await rawHarness();
  try {
    assert.deepEqual(await raw.snapshot(OptChatDoc, bot, BACKGROUND_CONTEXT), { enabled: true, name: "Grok" }, "the legacy incarnation became the current one, its value kept");
  } finally {
    await raw.close(BACKGROUND_CONTEXT);
  }
  const after = await check.inspect();
  assert.equal(after.status, "ok");
  assert.deepEqual(after.items, []);
});

