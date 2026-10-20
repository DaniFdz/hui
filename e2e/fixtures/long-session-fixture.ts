/**
 * Seeds an isolated HUI configuration with one long Durable session: many turns
 * that each run a bash command whose result carries a few kilobytes of log text,
 * so opening it moves a transcript of about two megabytes, like a day-long coding session.
 * Requires XDG_CONFIG_HOME, PI_CODING_AGENT_DIR and HUI_E2E_WORKSPACE; run it
 * before the gateway starts. HUI_E2E_TURNS overrides the turn count (default 160).
 * HUI_E2E_SUBAGENTS adds that many finished subagent sessions, each with a long
 * task and report: one in nine under it, the rest under an archived earlier
 * session, three in four archived. HUI_E2E_WATCHER=1 gives it a watcher that
 * logs a line every two seconds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AssistantEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
import { DurableHost, durableContext } from "../../server/runtimes/durable-host.ts";
import { CONFIG_DIR, WATCHER_LOG_DIR, WATCHERS_FILE } from "../../server/paths.ts";

const workspace = process.env["HUI_E2E_WORKSPACE"]!;
const agentDir = process.env["PI_CODING_AGENT_DIR"]!;
const turns = Number(process.env["HUI_E2E_TURNS"] ?? 160);
const subagents = Number(process.env["HUI_E2E_SUBAGENTS"] ?? 0);
const start = Date.now() - turns * 60_000;
const text = (value: string) => [{ type: "text", text: value }];
const usage = { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 1500, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = { api: "anthropic-messages", provider: "hui-e2e", model: "fixture", usage };
const token = (seed: number) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0).toString(36);
const prose = (seed: number, words: number) => Array.from({ length: words }, (_, index) => token(seed * 131 + index)).join(" ");
const log = (turn: number) => Array.from({ length: 60 }, (_, line) =>
  `src/module-${turn % 17}/file-${line}.ts:${line + 1}:${(turn * line) % 80} ok ${prose(turn * 61 + line, 6)} in ${(turn * line) % 997} ms${line % 7 === 0 ? " warning: unused import" : ""}`).join("\n");

const entries: unknown[] = [];
for (let turn = 0; turn < turns; turn++) {
  const at = start + turn * 60_000;
  entries.push({ kind: UserEntry.kind, model: [{ role: "user", content: text(`Step ${turn + 1}: run the checks for module ${turn % 17} and fix what fails.`), timestamp: at }] });
  entries.push({ kind: AssistantEntry.kind, model: [{
    role: "assistant", content: [{ type: "toolCall", id: `call-${turn}`, name: "bash", arguments: { command: `cd "${workspace}" && npm test -- src/module-${turn % 17} --reporter=dot 2>&1 | tail -60` } }],
    ...reply, stopReason: "toolUse", timestamp: at + 10_000,
  }] });
  entries.push({ kind: ToolResultEntry.kind, model: [{ role: "toolResult", toolCallId: `call-${turn}`, toolName: "bash", content: text(log(turn)), isError: false, timestamp: at + 20_000 }], data: { diagnostics: [] } });
  entries.push({ kind: AssistantEntry.kind, model: [{
    role: "assistant", content: text(`Module ${turn % 17} passes now. I tightened the types in two files and removed the unused import the checker flagged.`),
    ...reply, stopReason: "stop", timestamp: at + 40_000,
  }] });
}

await mkdir(workspace, { recursive: true });
const host = new DurableHost({ dir: join(CONFIG_DIR, "durable"), agentDir, resume: false, lookupCaller: async () => undefined });
host.configureDurableBots(null);
const harness = await host.open();
const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd: workspace }, init: async (tx, id) => {
  for (const entry of entries) await tx.appendEntry(id, entry as never);
} }, durableContext);
await host.close();
const session = {
  id: "e2e-long-session", title: "Long remote session", group: "Remote", cwd: workspace, tool: "durable",
  piSessionFile: `durable:${conversation.id}`, model: "hui-e2e/fixture", createdAt: new Date(start).toISOString(),
  updatedAt: new Date(start + turns * 60_000).toISOString(), source: "hui",
};
const earlier = {
  id: "e2e-earlier-session", title: "Earlier research", group: "Remote", cwd: workspace, tool: "durable", archived: true,
  createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString(), source: "hui",
};
const children = Array.from({ length: subagents }, (_, index) => {
  const at = new Date(start + index * 1_000).toISOString();
  return {
    id: `e2e-subagent-${index}`, title: `Research task ${index}`, group: "Remote", cwd: workspace, tool: "durable",
    parentId: index % 9 ? earlier.id : session.id,
    ...(index % 4 ? { archived: true } : {}), createdAt: at, updatedAt: at, source: "hui",
    subagent: {
      taskId: `task-${index}`, label: `research-${index}`, status: "completed", startedAt: at, updatedAt: at, endedAt: at, completionDelivery: "delivered",
      task: `Research task ${index} (read-only): ${prose(index, 360)}`,
      summary: `Report ${index}: ${prose(index + 100_000, 210)}`,
    },
  };
});
await mkdir(CONFIG_DIR, { recursive: true });
await writeFile(join(CONFIG_DIR, "sessions.json"), JSON.stringify({ version: 2, groups: [], sessions: [session, ...(subagents ? [earlier] : []), ...children] }));
if (process.env["HUI_E2E_WATCHER"] === "1") {
  const goneProcess = 999_999;
  await mkdir(WATCHER_LOG_DIR, { recursive: true });
  await writeFile(WATCHERS_FILE, JSON.stringify({ version: 1, watchers: [{
    id: "e2e-watcher", sessionId: session.id, cwd: workspace, purpose: "Log a line every two seconds", target: "", outcome: "",
    command: "while true; do date; sleep 2; done", logPath: join(WATCHER_LOG_DIR, "e2e-watcher.log"), pid: goneProcess,
    startedAt: new Date(start).toISOString(), keepRunning: true,
  }] }));
}
process.stdout.write(`Seeded one session with ${turns} turns and ${subagents} subagents.\n`);
