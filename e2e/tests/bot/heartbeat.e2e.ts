/** The gateway heartbeat continues an idle watched session without a bot turn (BOT-077), and never queues its report in a busy watcher's chat (BOT-079). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const reply = (text: string) => `E2E_REPLY:${Buffer.from(text, "utf8").toString("base64url")}`;

type Listed = { id: string; title: string; status: string };
type Found = { hits: Array<{ id: string; matches: number }> };

test("the gateway heartbeat continues an idle watched session", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Heartbeat target" });
  const watcher = await hui.createSession({ title: "Heartbeat watcher" });
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const run = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(run.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle; decide the next step")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await hui.stored("Continue the task and report progress")).toHaveLength(0);
});

test("the heartbeat does not report the same facts twice", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Heartbeat repeat target" });
  const watcher = await hui.createSession({ title: "Heartbeat repeat watcher" });
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const first = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(first.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle; decide the next step")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // The report's turn settles before its transcript is counted, so the count that follows is the first report's alone.
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const reports = async () => (await hui.api<Found>("GET", `/__hui/sessions/search?q=${encodeURIComponent("is idle; decide the next step")}`))
    .hits.find((hit) => hit.id === watcher.id)?.matches ?? 0;
  // The first report is in the watcher's transcript, so the count that follows is a report's to raise.
  await expect.poll(reports, { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await reports();

  const second = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(second.notified).not.toContain(target.id);
  expect(await reports()).toBe(before);
});

test("an idle decision is sent to the watcher, not continued", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Decision target" });
  await hui.prompt(target, `E2E_REPLY:${Buffer.from("The migration is ready. Should I deploy it?", "utf8").toString("base64url")}`);
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  const watcher = await hui.createSession({ title: "Decision watcher" });
  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const run = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(run.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle and waiting for a decision")).length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("a heartbeat report is never queued in a busy chief's chat", { tags: ["BOT-079"], platforms: ["web"] }, async ({ screen, hui }) => {
  const due = /is idle; decide the next step/u;
  // What the target says when the report is made, and what it says by the time the chief's turn ends.
  const then = "The migration is ready on staging.";
  const newest = "The migration is deployed to production.";
  const chief = await hui.createChief();
  const chiefChat = { id: chief.sessionId };
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const idle = (id: string) => expect.poll(async () => (await sessions()).find((session) => session.id === id)?.status, { timeout: 30_000 }).toBe("idle");

  // An ordinary session the chief's chat watches by name, never an Autonomous one: an Autonomous session starts a scan
  // whenever its own turn ends, which would deliver a refused report without the chief's chat finishing a turn. Nothing
  // but the end of the chief's own turn can scan here, so the delivery this test sees is the one it proves.
  const lead = await hui.createSession({ title: "Heartbeat busy target" });
  await hui.prompt(lead, reply(then));
  await idle(lead.id);
  await expect.poll(async () => (await hui.stored(then)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  await hui.prompt(chiefChat, call("watch_session", { action: "add", session: lead.id }));
  await idle(chiefChat.id);

  // The target's first stop reaches the idle chat, so the next report has to differ from it.
  const first = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  // The chat that refused a report is only found through a watch it really holds, so this names the assertion's subject.
  expect(first.notified).toContain(lead.id);
  await hui.open(`/bots/${chief.id}`);
  const transcript = screen.getByTestId("transcript");
  // One message row per report, so a row that holds the phrase is one report in the chat.
  const rows = (text: string | RegExp) => transcript.getByTestId("message-row").filter({ hasText: text }).count();
  const reports = () => rows(due);
  await expect.poll(reports, { timeout: 60_000 }).toBe(1);
  await idle(chiefChat.id);
  const said = await rows(then);

  // A fact of the target changes while nothing reports it, so the heartbeat below has a report to make.
  await hui.api("PATCH", `/__hui/sessions/${lead.id}`, { stage: "testing" });
  // A turn of the chief's own chat, held by the provider, so its chat is not idle when the report is made.
  await hui.prompt(chiefChat, "E2E_REPLAY");
  await hui.provider.held();
  await expect(transcript.getByText(/Replay prefix/u)).toBeVisible();

  await hui.api("POST", "/__hui/heartbeat");
  // A busy chat gets nothing at all: no report to read, and nothing waiting behind its turn to answer stale.
  expect(await reports()).toBe(1);
  await expect(screen.getByLabel("Queued messages")).toBeHidden();

  // The target's newest reply moves on while the chief's turn is held, and its own turn ending reports nothing: the
  // report the busy chat refused is still undelivered.
  await hui.prompt(lead, reply(newest));
  await idle(lead.id);
  await expect.poll(async () => (await hui.stored(newest)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await reports()).toBe(1);

  await hui.provider.release();
  // One report, recomputed when the chief's turn ended: it names the newest reply, not the one the chat was busy for.
  await expect.poll(() => rows(newest), { timeout: 60_000 }).toBe(1);
  expect(await reports()).toBe(2);
  expect(await rows(then)).toBe(said);
});
