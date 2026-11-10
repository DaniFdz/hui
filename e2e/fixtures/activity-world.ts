/**
 * The shared suite's activity world: one Durable conversation whose turns are stamped at the times a test chooses, plus
 * the session record the Calendar tab reads them through. `activity-fixture.ts` seeds two weeks before a launcher
 * starts; this records a single past stretch in a gateway that is already running, through its own harness, which is
 * the only owner of the store. A calendar test can then assert a day boundary or an hour it picked instead of "now".
 * The verified gateway runs it from `/__verification/activity` (`visual-verification-server.mjs`), and
 * `hui.recordWork()` in `hui.ts` asks for it.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { AssistantEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
import { durableContext, durableHost, type DurableHost } from "../../server/runtimes/durable-host.ts";
import { updateRegistry } from "../../server/sessions/sessions.ts";

const MINUTE = 60_000;
const MODEL = "hui-e2e/fixture";

/** A stretch of work: epoch milliseconds to start it, how long it ran, and the message that opened it. */
export type WorkBlock = { from: number; minutes: number; firstMessage: string };
export type RecordedWork = {
  title: string;
  /** The sidebar group the calendar's Group by names; the calendar shows `Other` without one. */
  group?: string;
  /** The session's directory, already absolute: its repository is the calendar's project. */
  cwd: string;
  model?: string;
  blocks: WorkBlock[];
};

const text = (value: string) => [{ type: "text", text: value }];
const usage = { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 1500, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** A turn every few minutes from a block's first message to its end, the shape a real conversation records. */
function turns(model: string, block: WorkBlock, now: number) {
  const [provider, id] = [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)];
  const end = Math.min(block.from + block.minutes * MINUTE, now);
  const answer = (timestamp: number, said: string) => ({ kind: AssistantEntry.kind, model: [{
    role: "assistant", content: text(said), api: "anthropic-messages", provider, model: id, usage, stopReason: "stop", timestamp,
  }] });
  const entries = [
    { kind: UserEntry.kind, model: [{ role: "user", content: text(block.firstMessage), timestamp: block.from }] },
    answer(block.from + MINUTE, "On it."),
  ];
  for (let time = block.from + 7 * MINUTE; time < end; time += 7 * MINUTE) {
    entries.push({ kind: ToolResultEntry.kind, model: [{ role: "toolResult", toolCallId: `call-${time}`, toolName: "bash", content: text("ok"), isError: false, timestamp: time }], data: { diagnostics: [] } } as never);
  }
  entries.push(answer(end, "Done for now."));
  return entries.filter((entry) => entry.model[0]!.timestamp <= now);
}

/** Records `work` as a session the calendar lists, and returns that session's id. */
export async function recordWork(work: RecordedWork, host: DurableHost = durableHost()): Promise<{ id: string }> {
  if (work.blocks.length === 0) throw new Error("recordWork: a session needs at least one block of work.");
  const now = Date.now();
  const blocks = [...work.blocks].sort((a, b) => a.from - b.from);
  // Work in the future would be a block the calendar never draws, which reads as a fixture bug instead of a result.
  if (blocks.some((block) => block.from >= now)) throw new Error("recordWork: work must start in the past.");
  const model = work.model ?? MODEL;
  await mkdir(work.cwd, { recursive: true });
  const harness = await host.open();
  const conversation = await harness.createConversation({
    ownership: { kind: "ownerless" },
    agent: { cwd: work.cwd },
    init: async (tx, id) => {
      for (const entry of blocks.flatMap((block) => turns(model, block, now))) await tx.appendEntry(id, entry as never);
    },
  }, durableContext);
  const id = `e2e-activity-${randomUUID().slice(0, 8)}`;
  const last = Math.max(...blocks.map((block) => Math.min(now, block.from + block.minutes * MINUTE)));
  await updateRegistry((sessions) => [...sessions, {
    id, title: work.title, group: work.group ?? "", cwd: work.cwd, tool: "durable",
    piSessionFile: `durable:${conversation.id}`, model,
    createdAt: new Date(blocks[0]!.from).toISOString(), updatedAt: new Date(last).toISOString(), source: "hui",
  }]);
  return { id };
}
