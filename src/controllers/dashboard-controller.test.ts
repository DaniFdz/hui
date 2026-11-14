import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import type { WorkerMetrics } from "../api/workers.ts";
import { EMPTY_FILTERS } from "../lib/dashboard.ts";
import { DASHBOARD_POLL_MS, DashboardController, GATEWAY_MACHINE } from "./dashboard-controller.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const at = (seconds: number) => new Date(NOW + seconds * 1_000).toISOString();

function sample(seconds: number): HostMetrics {
  return {
    sampledAt: at(seconds),
    host: { platform: "darwin", cores: 8 },
    cpu: { percent: 10, load: [1, 1, 1] },
    memory: { totalBytes: 100, usedBytes: 50 },
    disk: null,
    network: null,
    gpu: null,
    gateway: { cpuPercent: 1, rssBytes: 1 },
  };
}

type Read<T> = { resolve: (value: T) => void; reject: (error: Error) => void };
type HistoryRead = Read<readonly HostMetrics[]> & { minutes: number };
type WorkerHistoryRead = Read<Map<string, readonly HostMetrics[]>> & { minutes: number; ids: readonly string[] };
type AnswerCall = Read<void> & { id: string; questionId: string; answer: { value: string } | { confirmed: boolean } };
type ResumeCall = Read<void> & { id: string };

function setup() {
  const reads: Read<HostMetrics>[] = [];
  const workerReads: Read<readonly WorkerMetrics[]>[] = [];
  const historyReads: HistoryRead[] = [];
  const workerHistoryReads: WorkerHistoryRead[] = [];
  const answerReads: AnswerCall[] = [];
  const resumeReads: ResumeCall[] = [];
  const host = { updates: 0, requestUpdate() { this.updates += 1; }, addController() {} };
  const page = { shown: true, groups: [] as readonly SessionGroup[] };
  const controller = new DashboardController(
    host, () => page.shown, () => page.groups,
    () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    () => new Promise((resolve, reject) => workerReads.push({ resolve, reject })),
    (minutes) => new Promise((resolve, reject) => historyReads.push({ minutes, resolve, reject })),
    (minutes, ids) => new Promise((resolve, reject) => workerHistoryReads.push({ minutes, ids, resolve, reject })),
    (id, questionId, answer) => new Promise((resolve, reject) => answerReads.push({ id, questionId, answer, resolve, reject })),
    (id) => new Promise((resolve, reject) => resumeReads.push({ id, resolve, reject })),
  );
  return { controller, host, reads, workerReads, historyReads, workerHistoryReads, answerReads, resumeReads, page };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the dashboard poll asks again only once the gateway answered its last read, and redraws only for a new sample", async () => {
  const { controller, host, reads } = setup();
  controller.refresh();
  controller.refresh();
  assert.equal(reads.length, 1, "a slow gateway is not asked twice");
  reads[0]!.resolve(sample(0));
  await settle();
  assert.equal(controller.metrics?.sampledAt, at(0));
  assert.equal(host.updates, 1);
  controller.refresh();
  assert.equal(reads.length, 2);
  reads[1]!.resolve(sample(0));
  await settle();
  assert.equal(host.updates, 1, "the gateway's cached sample changes nothing");
  assert.equal(controller.samples.get(GATEWAY_MACHINE)?.length, 1);
});

test("a failed read keeps the last metrics with its error until a read succeeds", async () => {
  const { controller, host, reads } = setup();
  controller.refresh();
  reads[0]!.resolve(sample(0));
  await settle();
  controller.refresh();
  reads[1]!.reject(new Error("gateway unreachable"));
  await settle();
  assert.equal(controller.error, "gateway unreachable");
  assert.equal(controller.metrics?.sampledAt, at(0));
  const updates = host.updates;
  controller.refresh();
  reads[2]!.reject(new Error("gateway unreachable"));
  await settle();
  assert.equal(host.updates, updates, "the same failure redraws nothing");
  controller.refresh();
  reads[3]!.resolve(sample(5));
  await settle();
  assert.equal(controller.error, "");
  assert.deepEqual(controller.samples.get(GATEWAY_MACHINE)?.map((entry) => entry.sampledAt), [at(0), at(5)]);
});

test("the poll reads every five seconds while the document is visible, and stops with the page", async () => {
  vi.useFakeTimers();
  const document = { hidden: false };
  vi.stubGlobal("document", document);
  const { controller, reads, page } = setup();
  controller.start();
  controller.start();
  assert.equal(reads.length, 1, "opening the page reads at once");
  reads[0]!.resolve(sample(0));
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS);
  assert.equal(reads.length, 2);
  reads[1]!.resolve(sample(5));
  document.hidden = true;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 2, "a hidden document is not polled");
  document.hidden = false;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS);
  assert.equal(reads.length, 3);
  reads[2]!.resolve(sample(25));
  page.shown = false;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 3, "a page the app left by any path is not polled");
  page.shown = true;
  controller.start();
  assert.equal(reads.length, 4, "the poll stopped itself, so opening the page again starts it");
  reads[3]!.resolve(sample(40));
  controller.stop();
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 4, "a stopped poll reads nothing");
});

test("a machine's line keeps thirty minutes of samples and drops what is older", async () => {
  const { controller, reads } = setup();
  for (const [index, secondsAgo] of [40 * 60, 20 * 60, 60].entries()) {
    controller.refresh();
    reads[index]!.resolve(sample(-secondsAgo));
    await settle();
  }
  assert.deepEqual(controller.samples.get(GATEWAY_MACHINE)?.map((entry) => entry.sampledAt), [at(-20 * 60), at(-60)], "the sample from forty minutes ago is dropped");
});

test("a worker's samples join the chart, a failed read keeps the last answer, and a renamed worker redraws", async () => {
  const { controller, host, reads, workerReads } = setup();
  const worker = (seconds: number, overrides: Partial<WorkerMetrics> = {}): WorkerMetrics => ({ id: "w", name: "Box", state: "connected", metrics: sample(seconds), ...overrides });
  controller.refresh();
  reads[0]!.resolve(sample(0));
  workerReads[0]!.resolve([worker(0)]);
  await settle();
  assert.deepEqual(controller.samples.get("w")?.map((entry) => entry.sampledAt), [at(0)]);
  const updates = host.updates;
  controller.refresh();
  reads[1]!.resolve(sample(0));
  workerReads[1]!.resolve([worker(5)]);
  await settle();
  assert.equal(host.updates, updates + 1, "a worker's newer sample redraws even when the host's didn't move");
  assert.deepEqual(controller.samples.get("w")?.map((entry) => entry.sampledAt), [at(0), at(5)]);
  controller.refresh();
  reads[2]!.resolve(sample(0));
  workerReads[2]!.reject(new Error("workers unreachable"));
  await settle();
  assert.equal(controller.workersError, "workers unreachable");
  assert.equal(controller.workers.length, 1, "the last answer stays on screen");
  controller.refresh();
  reads[3]!.resolve(sample(0));
  workerReads[3]!.resolve([{ id: "w", name: "Box", state: "disconnected" }]);
  await settle();
  assert.equal(controller.workersError, "");
  assert.equal(controller.workers[0]?.state, "disconnected");
  assert.deepEqual(controller.samples.get("w")?.map((entry) => entry.sampledAt), [at(0), at(5)], "the samples it had stay while it cannot report");
  controller.refresh();
  reads[4]!.resolve(sample(0));
  workerReads[4]!.resolve([worker(5, { name: "Renamed box", state: "disconnected", metrics: undefined })]);
  await settle();
  assert.equal(host.updates, updates + 4, "a renamed worker redraws");
  assert.equal(controller.workers[0]?.name, "Renamed box");
});

test("opening the page reads each shown machine's samples once, including a worker that reports later", async () => {
  const { controller, historyReads, workerReads, reads, workerHistoryReads } = setup();
  controller.start();
  controller.start();
  await settle();
  assert.deepEqual(historyReads.map((read) => read.minutes), [5], "one read for the window the chart starts on");
  reads[0]!.resolve(sample(0));
  historyReads[0]!.resolve([sample(-120)]);
  await settle();
  assert.deepEqual(controller.samples.get(GATEWAY_MACHINE)?.map((entry) => entry.sampledAt), [at(-120), at(0)], "the history and the poll's sample share one line");
  assert.equal(workerHistoryReads.length, 0, "no worker had reported yet");
  workerReads[0]!.resolve([{ id: "w", name: "Box", state: "connected", metrics: sample(0) }]);
  await settle();
  assert.deepEqual(workerHistoryReads.at(-1)?.ids, ["w"], "a worker that reported later is asked for its own samples");
  historyReads[1]!.resolve([sample(-120)]);
  workerHistoryReads[0]!.resolve(new Map([["w", [sample(-90)]]]));
  await settle();
  assert.deepEqual(controller.samples.get("w")?.map((entry) => entry.sampledAt), [at(-90), at(0)], "its line joins the chart");

  const before = historyReads.length;
  controller.setChartWindow(30);
  await settle();
  assert.equal(historyReads.length, before + 1, "the wider window reads again");
  assert.equal(historyReads.at(-1)?.minutes, 30);
  assert.equal(workerHistoryReads.at(-1)?.minutes, 30);
  controller.setChartWindow(15);
  assert.equal(controller.chartWindow, 15);
  controller.stop();
});

test("hiding a machine takes it off the chart and the cards, and it is not asked for samples again", async () => {
  const { controller, historyReads, workerHistoryReads, workerReads, reads } = setup();
  controller.start();
  await settle();
  reads[0]!.resolve(sample(0));
  historyReads[0]!.resolve([]);
  workerReads[0]!.resolve([{ id: "w", name: "Box", state: "connected", metrics: sample(0) }]);
  await settle();
  assert.deepEqual(workerHistoryReads.at(-1)?.ids, ["w"]);
  historyReads[1]!.resolve([]);
  workerHistoryReads[0]!.resolve(new Map([["w", [sample(0)]]]));
  await settle();

  const hostReads = historyReads.length;
  const workerReads_ = workerHistoryReads.length;
  controller.toggleMachine("w");
  assert.equal(controller.shows("w"), false);
  await settle();
  assert.equal(workerHistoryReads.length, workerReads_, "a hidden worker is not asked for samples");
  assert.equal(historyReads.length, hostReads + 1, "the gateway host still is");
  historyReads.at(-1)!.resolve([]);
  await settle();
  const hostReadsAfter = historyReads.length;
  controller.toggleMachine(GATEWAY_MACHINE);
  assert.equal(controller.shows(GATEWAY_MACHINE), false);
  await settle();
  assert.equal(historyReads.length, hostReadsAfter, "nor is a hidden gateway host");
  controller.toggleMachine("w");
  assert.equal(controller.shows("w"), true, "showing it again puts it back");
  await settle();
  assert.equal(workerHistoryReads.length, workerReads_ + 1, "and reads it again");
  controller.stop();
});

test("a poll that finds a gap in a line reads that machine's samples again", async () => {
  const { controller, reads, historyReads } = setup();
  controller.refresh();
  reads[0]!.resolve(sample(0));
  await settle();
  const before = historyReads.length;
  controller.refresh();
  reads[1]!.resolve(sample(300));
  await settle();
  assert.equal(historyReads.length, before + 1, "five minutes of silence left a gap the chart fills from the host again");
  controller.refresh();
  reads[2]!.resolve(sample(305));
  await settle();
  assert.equal(historyReads.length, before + 1, "a poll right after the last one leaves none");
});

test("a worker that is slow to answer neither holds back this gateway's cards nor its next poll", async () => {
  const { controller, host, reads } = setup();
  controller.refresh();
  reads[0]!.resolve(sample(0));
  await settle();
  assert.equal(controller.metrics?.sampledAt, at(0));
  assert.equal(host.updates, 1, "the host draws while the worker is still being asked");
  controller.refresh();
  assert.equal(reads.length, 2, "the host is asked again while the worker read stays in flight");
  reads[1]!.resolve(sample(5));
  await settle();
  assert.equal(controller.metrics?.sampledAt, at(5));
});

function running(count: number, status: SessionView["status"] = "running", overrides: Partial<SessionView> = {}): SessionView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${status}${index}`, title: `${status} ${index}`, group: "", cwd: "/w", displayCwd: "/w", tool: "pi", status,
    stage: "investigation", stageOrigin: "default", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T10:00:00Z",
    ...overrides,
  }));
}

/** One session waiting for the operator, with the question its row answers. */
function waiting(): SessionView {
  return {
    ...running(1, "waiting")[0]!,
    question: { id: "q1", method: "confirm", title: "Continue?" },
  };
}

test("each lane opens on its own and stays open until the page is left or the lane has three rows or fewer", async () => {
  const { controller, host, reads, page } = setup();
  const list = (...sessions: SessionView[][]) => { page.groups = [{ label: "", sessions: sessions.flat() }]; controller.hostUpdate(); };
  list(running(5), running(4, "waiting"), running(4, "error"));
  controller.toggleList("flight");
  controller.toggleList("answer");
  assert.deepEqual([...controller.expandedLists], ["flight", "answer"], "each lane opens on its own");
  assert.equal(host.updates, 2);
  controller.toggleList("answer");
  assert.deepEqual([...controller.expandedLists], ["flight"]);

  controller.refresh();
  reads[0]!.resolve(sample(0));
  await settle();
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], ["flight"], "a metrics poll keeps it open");
  list(running(5), running(4, "waiting"), running(4, "error"));
  assert.deepEqual([...controller.expandedLists], ["flight"], "a refresh with the same rows keeps it open");
  list(running(6), running(4, "error"));
  assert.deepEqual([...controller.expandedLists], ["flight"], "a new session keeps it open");
  list(running(3), running(4, "error"));
  assert.deepEqual([...controller.expandedLists], [], "three rows have nothing to fold");
  list(running(5), running(4, "error"));
  assert.deepEqual([...controller.expandedLists], [], "a lane that grows again starts folded");

  controller.toggleList("fix");
  page.shown = false;
  controller.hostUpdate();
  page.shown = true;
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], [], "the page opens again with every lane folded");
});

test("a filter narrows the lanes the page folds", () => {
  const { controller, page } = setup();
  page.groups = [{ label: "", sessions: [...running(5), ...running(4, "waiting", { group: "Beta" })] }];
  controller.hostUpdate();
  controller.toggleList("flight");
  controller.toggleList("answer");
  assert.deepEqual([...controller.expandedLists], ["flight", "answer"]);
  controller.setFilters({ group: "Beta" });
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], ["answer"], "a filter that empties a lane folds it");
  controller.clearFilters();
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], ["answer"], "a lane that grows again starts folded");
});

test("filters merge into what is set, and clearing restores every dimension", () => {
  const { controller, host } = setup();
  assert.equal(controller.filters, EMPTY_FILTERS, "the page opens unfiltered");
  controller.setFilters({ status: "waiting" });
  assert.deepEqual(controller.filters, { ...EMPTY_FILTERS, status: "waiting" });
  controller.setFilters({ query: "lane", group: "Beta" });
  assert.deepEqual(controller.filters, { ...EMPTY_FILTERS, status: "waiting", query: "lane", group: "Beta" }, "a patch keeps the dimensions it does not name");
  assert.equal(host.updates, 2);
  controller.clearFilters();
  assert.equal(controller.filters, EMPTY_FILTERS);
  assert.equal(host.updates, 3);
});

test("filters survive the page being hidden and shown again", () => {
  const { controller, page } = setup();
  controller.setFilters({ stage: "testing" });
  page.shown = false;
  controller.hostUpdate();
  page.shown = true;
  controller.hostUpdate();
  assert.deepEqual(controller.filters, { ...EMPTY_FILTERS, stage: "testing" }, "leaving the page only folds its lanes");
});

test("answering a session marks it busy, sends its question and answer once, and keeps it busy until the list moves on", async () => {
  const { controller, host, answerReads, page } = setup();
  const session = waiting();
  page.groups = [{ label: "", sessions: [session] }];
  controller.answer(session, session.question!, { confirmed: true });
  assert.deepEqual([...controller.busy], [session.id]);
  controller.answer(session, session.question!, { confirmed: true });
  assert.equal(answerReads.length, 1, "a second click while the answer is in flight asks nothing");
  assert.equal(answerReads[0]!.id, session.id);
  assert.equal(answerReads[0]!.questionId, "q1", "the answer goes to the question the row showed");
  assert.deepEqual(answerReads[0]!.answer, { confirmed: true });
  answerReads[0]!.resolve();
  await settle();
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [session.id], "the row is still on screen carrying the same question, so the session stays blocked");
  controller.answer(session, session.question!, { confirmed: true });
  assert.equal(answerReads.length, 1, "a second click after success re-sends nothing");
  assert.equal(controller.actionError, "", "and the row shows no false refusal");
  assert.equal(host.updates, 2, "one redraw when the action starts and one when it settles");

  const next = { ...session, question: { id: "q2", method: "confirm" as const, title: "Continue?" } };
  page.groups = [{ label: "", sessions: [next] }];
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [], "a list showing another question frees the session");
  controller.answer(next, next.question, { confirmed: true });
  assert.equal(answerReads.length, 2, "the next question can be answered");
  answerReads[1]!.resolve();
  await settle();

  page.groups = [];
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [], "a session that leaves the list frees it");
});

test("a failed action shows its error, frees the session at once, and a retry works", async () => {
  const { controller, answerReads, page } = setup();
  const session = waiting();
  page.groups = [{ label: "", sessions: [session] }];
  controller.answer(session, session.question!, { value: "yes" });
  answerReads[0]!.reject(new Error("gateway unreachable"));
  await settle();
  assert.equal(controller.actionError, "gateway unreachable");
  assert.deepEqual([...controller.busy], [], "a failure does not leave the session stuck, even while its row is still listed");
  controller.dismissActionError();
  assert.equal(controller.actionError, "", "the operator can dismiss it");
  controller.answer(session, session.question!, { value: "yes" });
  assert.deepEqual([...controller.busy], [session.id], "a retry is allowed once the last one settled");
  assert.equal(answerReads.length, 2);
  answerReads[1]!.resolve();
  await settle();
  assert.equal(controller.actionError, "");
  page.groups = [{ label: "", sessions: [{ ...session, status: "idle", question: undefined }] }];
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [], "the answered question leaving the list frees the session");
});

test("resuming a stopped session sends one request per session and keeps it blocked until the list shows it moved", async () => {
  const { controller, resumeReads, page } = setup();
  const session = { ...running(1, "idle")[0]!, runFailed: true as const };
  page.groups = [{ label: "", sessions: [session] }];
  controller.resume(session);
  controller.resume(session);
  assert.deepEqual([...controller.busy], [session.id]);
  assert.deepEqual(resumeReads.map((call) => call.id), [session.id], "a second click while the resume is in flight asks nothing");
  resumeReads[0]!.resolve();
  await settle();
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [session.id], "a list still showing the same failed idle turn keeps it blocked");
  controller.resume(session);
  assert.equal(resumeReads.length, 1, "a second click after success re-sends nothing");

  page.groups = [{ label: "", sessions: [{ ...session, runFailed: undefined }] }];
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [], "the failed run leaving the list frees the session");
  page.groups = [{ label: "", sessions: [session] }];
  controller.resume(session);
  assert.equal(resumeReads.length, 2, "it can be asked again once the list moved on");
  resumeReads[1]!.resolve();
  await settle();
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [session.id]);
  page.groups = [{ label: "", sessions: [{ ...session, status: "running" }] }];
  controller.hostUpdate();
  assert.deepEqual([...controller.busy], [], "a status change frees it too, so the running row is not stuck");
});
