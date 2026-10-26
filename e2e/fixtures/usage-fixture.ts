/**
 * Seeds an isolated HUI configuration with eight weeks of synthetic recorded usage for the Usage page: five Durable
 * sessions (one archived, one a subagent) over three providers and three models, priced, priced at zero and unpriced,
 * with an error tool result, plus one legacy PI transcript. All sessions reopen with the deterministic fixture model.
 * Run by `visual-verification.mjs launch --usage-fixture` before the gateway starts; requires XDG_CONFIG_HOME,
 * PI_CODING_AGENT_DIR and HUI_E2E_WORKSPACE.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AssistantEntry, ToolResultEntry, UsageDoc, UserEntry } from "@earendil-works/pi-durable";
import { DurableHost, durableContext } from "../../server/runtimes/durable-host.ts";
import { CONFIG_DIR } from "../../server/paths.ts";

const MINUTE = 60_000;
const workspace = process.env["HUI_E2E_WORKSPACE"]!;
const agentDir = process.env["PI_CODING_AGENT_DIR"]!;
const now = Date.now();
const ago = (days: number, hour: number, minute = 0) => {
  const day = new Date(now);
  day.setDate(day.getDate() - days);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).valueOf();
};

const OPUS = ["anthropic", "claude-opus-5-5"] as const;
const GPT = ["openai", "gpt-5.5"] as const;
const FIXTURE = ["hui-e2e", "fixture"] as const;
type Model = readonly [provider: string, model: string];
type Turn = { at: number; model: Model; input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number; error?: boolean; said: string };
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

function sumSpend(total: ReturnType<typeof used> & { cost: Record<string, number> }, turn: Turn) {
  const added = used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost ?? 0);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) total[key] = (total[key] ?? 0) + added[key];
  for (const key of Object.keys(added.cost)) total.cost[key] = (total.cost[key] ?? 0) + added.cost[key];
  return total;
}

const host = new DurableHost({ dir: join(CONFIG_DIR, "durable"), agentDir, resume: false, lookupCaller: async () => undefined });
host.configureDurableBots(null);
const harness = await host.open();
const createdAt = new Date(ago(40, 8)).toISOString();
const sessions: Record<string, unknown>[] = [];
for (const [index, seed] of seeds.entries()) {
  const cwd = join(workspace, seed.project);
  await mkdir(cwd, { recursive: true });
  const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd }, init: async (tx, id) => {
    for (const turn of seed.turns) {
      const [provider, model] = turn.model;
      await tx.appendEntry(id, { kind: UserEntry.kind, model: [{ role: "user", content: text(turn.said), timestamp: turn.at }] } as never);
      await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [{
        role: "assistant", content: text(turn.said), api: "anthropic-messages", provider, model,
        usage: used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost), stopReason: "stop", timestamp: turn.at + MINUTE,
      }] } as never);
      if (turn.error) await tx.appendEntry(id, { kind: ToolResultEntry.kind, model: [{
        role: "toolResult", toolCallId: `call-${turn.at}`, toolName: "bash", content: text("exit 1"), isError: true, timestamp: turn.at + 2 * MINUTE,
      }], data: { diagnostics: [] } } as never);
      const spend = await tx.doc(UsageDoc, id);
      spend.models[`${provider}/${model}`] = spend.models[`${provider}/${model}`] === undefined
        ? used(turn.input, turn.output, turn.cacheRead, turn.cacheWrite, turn.cost) as never
        : sumSpend(spend.models[`${provider}/${model}`] as never, turn) as never;
    }
  } }, durableContext);
  const last = Math.max(...seed.turns.map(({ at }) => at));
  sessions.push({
    id: `e2e-usage-${index + 1}`, title: seed.title, group: "", cwd, tool: "durable",
    piSessionFile: `durable:${conversation.id}`, model: FIXTURE.join("/"),
    createdAt, updatedAt: new Date(last).toISOString(), source: "hui",
    ...(seed.archived ? { archived: true } : {}),
    ...(seed.parent ? { parentId: `e2e-usage-${seeds.findIndex(({ title }) => title === seed.parent) + 1}` } : {}),
  });
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
  id: "e2e-usage-6", title: "Design notes", group: "", cwd: workspace, tool: "pi", piSessionFile: transcript,
  model: FIXTURE.join("/"), createdAt: new Date(ago(61, 12)).toISOString(),
  updatedAt: new Date(ago(1, 12)).toISOString(), source: "hui",
});

await mkdir(CONFIG_DIR, { recursive: true });
await writeFile(join(CONFIG_DIR, "sessions.json"), JSON.stringify({ version: 2, groups: [], sessions }));
process.stdout.write(`Seeded ${sessions.length} sessions of recorded usage from ${new Date(ago(60, 12)).toDateString()}.\n`);