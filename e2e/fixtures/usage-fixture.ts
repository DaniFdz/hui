/**
 * Seeds an isolated HUI configuration with synthetic recorded usage for the Usage page: five Durable sessions (one
 * archived, one a subagent) over three providers and three models, priced, priced at zero and unpriced, with an error
 * tool result and one compaction whose summarization is recorded only in the spend ledger, plus one legacy PI
 * transcript. All sessions reopen with the deterministic fixture model.
 *
 * `HUI_E2E_USAGE_PROFILE` swaps the six sessions for a bounded set of another shape, and `HUI_E2E_USAGE_SESSIONS`
 * sets its session count: `roots` is mostly independent conversations with a handful of true
 * history forks, while `forks` (ten multi-year roots and many forked children) and `dense` (the same forks with a
 * recorded day on every child across the last 90 days) are adversarial shapes for repeated history parsing and
 * browser scaling, not the recorded distribution.
 *
 * Run by `visual-verification.mjs launch --usage-fixture` before the gateway starts; requires XDG_CONFIG_HOME,
 * PI_CODING_AGENT_DIR and HUI_E2E_WORKSPACE.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AssistantEntry, CompactionEntry, ToolResultEntry, UsageDoc, UserEntry, type ConversationId, type EntryId, type Tx } from "@earendil-works/pi-durable";
import { DurableHost, durableContext } from "../../server/runtimes/durable-host.ts";
import { CONFIG_DIR } from "../../server/paths.ts";

const MINUTE = 60_000;
const workspace = process.env["HUI_E2E_WORKSPACE"];
const agentDir = process.env["PI_CODING_AGENT_DIR"];
if (!workspace || !agentDir || !process.env["XDG_CONFIG_HOME"]) throw new Error("Usage fixtures require isolated HUI, PI and workspace directories.");
const now = Date.now();
const ago = (days: number, hour: number, minute = 0) => {
  const day = new Date(now);
  day.setDate(day.getDate() - days);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).valueOf();
};

const PROFILES = ["default", "roots", "forks", "dense"];
const profile = process.env["HUI_E2E_USAGE_PROFILE"]?.trim() || "default";
if (!PROFILES.includes(profile)) throw new Error(`HUI_E2E_USAGE_PROFILE must be one of ${PROFILES.join(", ")}.`);
const sessionsWanted = Number(process.env["HUI_E2E_USAGE_SESSIONS"]?.trim() || 2000);
if (!Number.isInteger(sessionsWanted) || sessionsWanted < 20 || sessionsWanted > 2000) {
  throw new Error("HUI_E2E_USAGE_SESSIONS must be a whole number of sessions from 20 to 2000.");
}

const OPUS = ["anthropic", "claude-opus-5-5"] as const;
const GPT = ["openai", "gpt-5.5"] as const;
const FIXTURE = ["hui-e2e", "fixture"] as const;
type Model = readonly [provider: string, model: string];
type Turn = { at: number; model: Model; input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number; error?: boolean; tool?: string; alone?: boolean; said: string };
type Seed = { title: string; project: string; turns: Turn[]; archived?: boolean; parent?: string };

const used = (input: number, output: number, cacheRead: number, cacheWrite: number, cost?: number) => ({
  input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
  ...(cost === undefined ? {} : { cost: { input: cost / 2, output: cost / 4, cacheRead: cost / 4, cacheWrite: 0, total: cost } }),
});

const seeds: Seed[] = [
  { title: "Retry-safe checkout", project: "checkout-api", turns: [
    { at: ago(2, 9, 12), model: OPUS, input: 1200, output: 480, cacheRead: 5200, cacheWrite: 900, cost: 0.84, said: "Making the charge endpoint idempotent." },
    { at: ago(2, 14, 30), model: OPUS, input: 700, output: 300, cacheRead: 2100, cacheWrite: 400, cost: 0.41, error: true, said: "The retry test fails on the second charge." },
  ] },
  { title: "Webhook double charge", project: "checkout-api", turns: [
    { at: ago(9, 10, 5), model: GPT, input: 900, output: 350, cacheRead: 1400, cacheWrite: 0, cost: 0.19, said: "Storing the processed webhook ids." },
    { at: ago(9, 16, 40), model: GPT, input: 600, output: 220, cacheRead: 800, cacheWrite: 0, cost: 0.12, said: "The double charge test passes now." },
  ] },
  { title: "Pricing page redesign", project: "marketing-site", turns: [
    { at: ago(20, 11, 20), model: FIXTURE, input: 400, output: 180, cacheRead: 0, cacheWrite: 0, cost: 0, said: "Rewriting the pricing copy." },
  ] },
  { title: "Offline sync spike", project: "ios-app", archived: true, turns: [
    { at: ago(35, 13, 0), model: OPUS, input: 1100, output: 500, cacheRead: 3000, cacheWrite: 600, cost: 0.72, said: "Spiking a local queue for offline sync." },
  ] },
  { title: "Grader subagent", project: "evals", parent: "Webhook double charge", turns: [
    { at: ago(9, 16, 45), model: GPT, input: 300, output: 120, cacheRead: 500, cacheWrite: 0, cost: 0.06, said: "Scoring the refusals set." },
  ] },
];

const text = (value: string) => [{ type: "text", text: value }];

function sumSpend(total: ReturnType<typeof used> & { cost?: Record<string, number> }, turn: Turn) {
  const added = used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost ?? 0);
  total.cost ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) total[key] = (total[key] ?? 0) + added[key];
  for (const key of Object.keys(added.cost)) total.cost[key] = (total.cost[key] ?? 0) + added.cost[key];
  return total;
}

const host = new DurableHost({ dir: join(CONFIG_DIR, "durable"), agentDir, resume: false, lookupCaller: async () => undefined });
host.configureDurableBots(null);
const harness = await host.open();
const createdAt = new Date(ago(40, 8)).toISOString();
const sessions: Record<string, unknown>[] = [];
let appended = 0;
let summary = "";

async function appendTurns(tx: Tx, id: ConversationId, turns: readonly Turn[], ledgerOnly?: Turn): Promise<EntryId | undefined> {
  let last: EntryId | undefined;
  for (const turn of turns) {
    const [provider, model] = turn.model;
    if (!turn.alone) {
      last = (await tx.appendEntry(id, { kind: UserEntry.kind, model: [{ role: "user", content: text(turn.said), timestamp: turn.at }] } as never)).id;
      appended += 1;
    }
    last = (await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [{
      role: "assistant", content: text(turn.said), api: "anthropic-messages", provider, model,
      usage: used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost), stopReason: "stop", timestamp: turn.at + MINUTE,
    }] } as never)).id;
    appended += 1;
    if (turn.error || turn.tool) {
      last = (await tx.appendEntry(id, { kind: ToolResultEntry.kind, model: [{
        role: "toolResult", toolCallId: `call-${turn.at}`, toolName: turn.tool ?? "bash",
        content: text(turn.error ? "exit 1" : "ok"), isError: turn.error === true, timestamp: turn.at + 2 * MINUTE,
      }], data: { diagnostics: [] } } as never)).id;
      appended += 1;
    }
    const spend = await tx.doc(UsageDoc, id);
    spend.models[`${provider}/${model}`] = spend.models[`${provider}/${model}`] === undefined
      ? used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost) as never
      : sumSpend(spend.models[`${provider}/${model}`] as never, turn) as never;
  }
  if (ledgerOnly) {
    const key = `${ledgerOnly.model[0]}/${ledgerOnly.model[1]}`;
    const spend = await tx.doc(UsageDoc, id);
    spend.models[key] = spend.models[key] === undefined
      ? used(ledgerOnly.input, ledgerOnly.output, ledgerOnly.cacheRead, ledgerOnly.cacheWrite, ledgerOnly.cost) as never
      : sumSpend(spend.models[key] as never, ledgerOnly) as never;
  }
  return last;
}

function lastActivity(turns: readonly Turn[]): number {
  return turns.reduce((last, { at }) => Math.max(last, at), 0);
}

if (profile === "default") {
  for (const [index, seed] of seeds.entries()) {
    const cwd = join(workspace, seed.project);
    await mkdir(cwd, { recursive: true });
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd }, init: async (tx, id) => {
      await appendTurns(tx, id, seed.turns, seed.title === "Retry-safe checkout" ? {
        at: seed.turns.at(-1)!.at, model: OPUS, input: 7_200, output: 1_200, cacheRead: 0, cacheWrite: 0, cost: 0.26, said: "summary",
      } : undefined);
      if (seed.title === "Retry-safe checkout") {
        await tx.appendEntry(id, { kind: CompactionEntry.kind, data: { reason: "manual" }, model: [{
          role: "user", content: text("Summary: the charge endpoint is idempotent; the retry test still fails."), timestamp: seed.turns.at(-1)!.at,
        }] } as never);
      }
    } }, durableContext);
    sessions.push({
      id: `e2e-usage-${index + 1}`, title: seed.title, group: "", cwd, tool: "durable",
      piSessionFile: `durable:${conversation.id}`, model: FIXTURE.join("/"),
      createdAt, updatedAt: new Date(lastActivity(seed.turns)).toISOString(), source: "hui",
      ...(seed.archived ? { archived: true } : {}),
      ...(seed.parent ? { parentId: `e2e-usage-${seeds.findIndex(({ title }) => title === seed.parent) + 1}` } : {}),
    });
  }
} else {
  const dense = profile === "dense";
  const forked = profile !== "roots";
  const ROOTS = forked ? 10 : sessionsWanted - 10;
  const FORKS = forked ? sessionsWanted - ROOTS - 1 : 9;
  const MODELS = [OPUS, GPT, FIXTURE] as const;
  const TOOLS = ["bash", "read", "grep"] as const;
  const costOf = (index: number) => (index % 7 === 3 ? undefined : index % 11 === 5 ? 0 : 0.37);
  const rootTurns = (root: number): Turn[] => {
    if (!forked) {
      const start = 30 + (root % 1100);
      const turns: Turn[] = Array.from({ length: 3 }, (_, index) => ({
        at: ago(start - index * 9, 9 + index), model: MODELS[(root + index) % MODELS.length]!,
        input: 900, output: 300, cacheRead: 1200, cacheWrite: 100, cost: costOf(root + index),
        ...(index === 0 ? { tool: TOOLS[root % TOOLS.length]! } : {}), said: `Usage root ${root + 1} turn ${index + 1}.`,
      }));
      turns.push({ at: ago(2 + (root % 20), 12), model: OPUS, input: 200, output: 60, cacheRead: 0, cacheWrite: 0, cost: costOf(root + 3), said: "Usage root recent turn." });
      return turns;
    }
    const turns: Turn[] = Array.from({ length: 100 }, (_, index) => ({
      at: ago(1150 - index * 11, 9),
      model: MODELS[(root + index) % MODELS.length]!,
      input: 900, output: 300, cacheRead: 1200, cacheWrite: 100,
      cost: costOf(index),
      ...(index % 10 === 0 ? { tool: TOOLS[(index / 10) % TOOLS.length]!, error: index % 30 === 0 } : {}),
      said: `Stress root ${root + 1} turn ${index + 1}.`,
    }));
    if (dense) turns.push({ at: ago(2, 12), model: OPUS, input: 600, output: 200, cacheRead: 400, cacheWrite: 0, cost: 0.52, said: "Stress root recent turn." });
    return turns;
  };
  const forkTurns = (fork: number): Turn[] => {
    const model = MODELS[fork % MODELS.length]!;
    if (dense) {
      return Array.from({ length: 90 }, (_, day) => ({
        at: ago(89 - day, 6 + (day % 12)), model, input: 120, output: 40, cacheRead: 0, cacheWrite: 0,
        cost: day % 20 === 0 ? 0.002 : undefined, alone: true, said: "ok",
      }));
    }
    const start = 64 + (fork % 1000);
    const turns: Turn[] = [
      { at: ago(start, 10), model, input: 400, output: 150, cacheRead: 200, cacheWrite: 0, cost: costOf(fork), said: "Stress fork start." },
      { at: ago(start - 12, 11), model, input: 300, output: 90, cacheRead: 100, cacheWrite: 0, cost: costOf(fork + 1), said: "Stress fork end." },
    ];
    turns.push({ at: ago(3 + (fork % 20), 13), model, input: 200, output: 60, cacheRead: 0, cacheWrite: 0, cost: costOf(fork + 2), said: "Stress fork recent." });
    return turns;
  };

  const roots: { conversationId: ConversationId; head: EntryId | undefined; sessionId: string; cwd: string }[] = [];
  for (let root = 0; root < ROOTS; root++) {
    const cwd = join(workspace, forked ? `stress-root-${root + 1}` : "usage-roots");
    await mkdir(cwd, { recursive: true });
    const turns = rootTurns(root);
    let head: EntryId | undefined;
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd }, init: async (tx, id) => {
      head = await appendTurns(tx, id, turns, forked && root === 0 ? {
        at: turns[0]!.at, model: OPUS, input: 7_200, output: 1_200, cacheRead: 0, cacheWrite: 0, cost: 0.26, said: "summary",
      } : undefined);
    } }, durableContext);
    const sessionId = `e2e-usage-${sessions.length + 1}`;
    roots.push({ conversationId: conversation.id, head, sessionId, cwd });
    sessions.push({
      id: sessionId, title: forked ? `Stress root ${root + 1}` : `Usage root ${root + 1}`, group: "", cwd, tool: "durable",
      piSessionFile: `durable:${conversation.id}`, model: FIXTURE.join("/"),
      createdAt: new Date(turns[0]!.at).toISOString(), updatedAt: new Date(lastActivity(turns)).toISOString(), source: "hui",
      ...(root === 3 ? { archived: true } : {}),
    });
  }

  for (let fork = 0; fork < FORKS; fork++) {
    const root = roots[fork % ROOTS]!;
    if (root.head === undefined) throw new Error("A seeded root has no entry to fork at.");
    const parent = await harness.conversation(root.conversationId, durableContext);
    if (!parent) throw new Error("A seeded root conversation is missing.");
    const turns = forkTurns(fork);
    const conversation = await parent.fork(root.head, { ownership: { kind: "ownerless" }, agent: { cwd: root.cwd }, init: async (tx, id) => {
      await appendTurns(tx, id, turns);
    } }, durableContext);
    sessions.push({
      id: `e2e-usage-${sessions.length + 1}`, title: forked ? `Stress fork ${fork + 1}` : `Usage fork ${fork + 1}`, group: "", cwd: root.cwd, tool: "durable",
      piSessionFile: `durable:${conversation.id}`, model: FIXTURE.join("/"),
      createdAt: new Date(turns[0]!.at).toISOString(), updatedAt: new Date(lastActivity(turns)).toISOString(), source: "hui",
      parentId: root.sessionId, ...(fork % 7 === 0 ? { archived: true } : {}),
    });
  }
  summary = `Usage profile ${profile}: ${sessions.length} Durable sessions, ${appended} entries, ${forked
    ? `adversarial shape: ${ROOTS} roots with ${FORKS} forked children${dense ? ", 90 recorded days per child" : ""}`
    : `${FORKS} true history forks beside ${ROOTS} independent roots`}.`;
}
await host.close();

const transcript = join(agentDir, "sessions", "usage-fixture.jsonl");
await mkdir(join(agentDir, "sessions"), { recursive: true });
const history = [
  { at: ago(60, 12), usage: used(2000, 800, 1000, 200, 1.5) },
  { at: ago(20, 12, 5), usage: used(500, 200, 0, 0) },
  { at: ago(1, 12), usage: used(1600, 600, 900, 0, 0.55) },
];
await writeFile(transcript, [
  JSON.stringify({ type: "session", version: 3, id: "00000000-0000-4000-8000-000000000006", cwd: workspace, timestamp: new Date(ago(61, 12)).toISOString() }),
  ...history.map(({ at, usage }, index) => JSON.stringify({
    type: "message", id: `fixture-${at}`, parentId: index === 0 ? null : `fixture-${history[index - 1]!.at}`, timestamp: new Date(at).toISOString(),
    message: { role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "claude-haiku-5", content: text("Notes from the design review."), usage, stopReason: "stop", timestamp: at },
  })),
].join("\n") + "\n");
sessions.push({
  id: `e2e-usage-${sessions.length + 1}`, title: "Design notes", group: "", cwd: workspace, tool: "pi", piSessionFile: transcript,
  model: FIXTURE.join("/"), createdAt: new Date(ago(61, 12)).toISOString(),
  updatedAt: new Date(ago(1, 12)).toISOString(), source: "hui",
});

await mkdir(CONFIG_DIR, { recursive: true });
await writeFile(join(CONFIG_DIR, "sessions.json"), JSON.stringify({ version: 2, groups: [], sessions }));
process.stdout.write(summary ? `${summary}\n` : `Seeded ${sessions.length} sessions of recorded usage from ${new Date(ago(60, 12)).toDateString()}.\n`);
