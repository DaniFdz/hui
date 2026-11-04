import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import type { WorkerMetrics } from "../api/workers.ts";
import { DASHBOARD_HISTORY, DASHBOARD_POLL_MS, DashboardController } from "./dashboard-controller.ts";

function sample(sampledAt: string): HostMetrics {
  return {
    sampledAt,
    host: { platform: "darwin", cores: 8 },
    cpu: { percent: 10, load: [1, 1, 1] },
    memory: { totalBytes: 100, usedBytes: 50 },
    disk: null,
    network: null,
    gpu: null,
    gateway: { cpuPercent: 1, rssBytes: 1 },
  };
}

type WorkerRead = { resolve: (value: readonly WorkerMetrics[]) => void; reject: (error: Error) => void };

function setup(options: { controlledWorkers?: boolean } = {}) {
  const reads: Array<{ resolve: (value: HostMetrics) => void; reject: (error: Error) => void }> = [];
  const workerReads: WorkerRead[] = [];
  const host = { updates: 0, requestUpdate() { this.updates += 1; }, addController() {} };
  const page = { shown: true, groups: [] as readonly SessionGroup[] };
  const workers = options.controlledWorkers
    ? () => new Promise<readonly WorkerMetrics[]>((resolve, reject) => workerReads.push({ resolve, reject }))
    : () => Promise.resolve([] as readonly WorkerMetrics[]);
  const controller = new DashboardController(host, () => page.shown, () => page.groups, () => new Promise((resolve, reject) => reads.push({ resolve, reject })), workers);
  return { controller, host, reads, workerReads, page };
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
  reads[0]!.resolve(sample("t1"));
  await settle();
  assert.equal(controller.metrics?.sampledAt, "t1");
  assert.equal(host.updates, 1);
  controller.refresh();
  assert.equal(reads.length, 2);
  reads[1]!.resolve(sample("t1"));
  await settle();
  assert.equal(host.updates, 1, "the gateway's cached sample changes nothing");
  assert.equal(controller.history.length, 1);
});

test("a failed read keeps the last metrics with its error until a read succeeds", async () => {
  const { controller, host, reads } = setup();
  controller.refresh();
  reads[0]!.resolve(sample("t1"));
  await settle();
  controller.refresh();
  reads[1]!.reject(new Error("gateway unreachable"));
  await settle();
  assert.equal(controller.error, "gateway unreachable");
  assert.equal(controller.metrics?.sampledAt, "t1");
  const updates = host.updates;
  controller.refresh();
  reads[2]!.reject(new Error("gateway unreachable"));
  await settle();
  assert.equal(host.updates, updates, "the same failure redraws nothing");
  controller.refresh();
  reads[3]!.resolve(sample("t2"));
  await settle();
  assert.equal(controller.error, "");
  assert.deepEqual(controller.history.map((entry) => entry.sampledAt), ["t1", "t2"]);
});

test("the poll reads every five seconds while the document is visible, and stops with the page", async () => {
  vi.useFakeTimers();
  const document = { hidden: false };
  vi.stubGlobal("document", document);
  const { controller, reads, page } = setup();
  controller.start();
  controller.start();
  assert.equal(reads.length, 1, "opening the page reads at once");
  reads[0]!.resolve(sample("t0"));
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS);
  assert.equal(reads.length, 2);
  reads[1]!.resolve(sample("t1"));
  document.hidden = true;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 2, "a hidden document is not polled");
  document.hidden = false;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS);
  assert.equal(reads.length, 3);
  reads[2]!.resolve(sample("t2"));
  page.shown = false;
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 3, "a page the app left by any path is not polled");
  page.shown = true;
  controller.start();
  assert.equal(reads.length, 4, "the poll stopped itself, so opening the page again starts it");
  reads[3]!.resolve(sample("t3"));
  controller.stop();
  await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3);
  assert.equal(reads.length, 4, "a stopped poll reads nothing");
});

test("the sparklines keep the last sixty samples", async () => {
  const { controller, reads } = setup();
  for (let index = 0; index < DASHBOARD_HISTORY + 5; index += 1) {
    controller.refresh();
    reads[index]!.resolve(sample(`t${index}`));
    await settle();
  }
  assert.equal(controller.history.length, DASHBOARD_HISTORY);
  assert.equal(controller.history[0]?.sampledAt, "t5");
});

test("a worker's samples arrive beside the host's, keep their own history, and a failed read keeps the last answer", async () => {
  const { controller, host, reads, workerReads } = setup({ controlledWorkers: true });
  const worker = (sampledAt: string, state: WorkerMetrics["state"] = "connected"): WorkerMetrics => ({ id: "w", name: "Box", state, metrics: sample(sampledAt) });
  controller.refresh();
  reads[0]!.resolve(sample("t1"));
  workerReads[0]!.resolve([worker("w1")]);
  await settle();
  assert.deepEqual(controller.workerHistory.get("w")?.map((entry) => entry.sampledAt), ["w1"]);
  const updates = host.updates;
  controller.refresh();
  reads[1]!.resolve(sample("t1"));
  workerReads[1]!.resolve([worker("w2")]);
  await settle();
  assert.equal(host.updates, updates + 1, "a worker's newer sample redraws even when the host's didn't move");
  assert.deepEqual(controller.workerHistory.get("w")?.map((entry) => entry.sampledAt), ["w1", "w2"]);
  controller.refresh();
  reads[2]!.resolve(sample("t1"));
  workerReads[2]!.reject(new Error("workers unreachable"));
  await settle();
  assert.equal(controller.workersError, "workers unreachable");
  assert.equal(controller.workers.length, 1, "the last answer stays on screen");
  controller.refresh();
  reads[3]!.resolve(sample("t1"));
  workerReads[3]!.resolve([{ id: "w", name: "Box", state: "disconnected" }]);
  await settle();
  assert.equal(controller.workersError, "");
  assert.equal(controller.workers[0]?.state, "disconnected");
  assert.deepEqual(controller.workerHistory.get("w")?.map((entry) => entry.sampledAt), ["w1", "w2"], "the samples it had stay while it cannot report");
  controller.refresh();
  reads[4]!.resolve(sample("t1"));
  workerReads[4]!.resolve([{ id: "w", name: "Renamed box", state: "disconnected" }]);
  await settle();
  assert.equal(host.updates, updates + 4, "a renamed worker redraws");
  assert.equal(controller.workers[0]?.name, "Renamed box");
});

test("a worker that is slow to answer neither holds back this gateway's cards nor its next poll", async () => {
  const { controller, host, reads } = setup({ controlledWorkers: true });
  controller.refresh();
  reads[0]!.resolve(sample("t1"));
  await settle();
  assert.equal(controller.metrics?.sampledAt, "t1");
  assert.equal(host.updates, 1, "the host draws while the worker is still being asked");
  controller.refresh();
  assert.equal(reads.length, 2, "the host is asked again while the worker read stays in flight");
  reads[1]!.resolve(sample("t2"));
  await settle();
  assert.equal(controller.metrics?.sampledAt, "t2");
});

function running(count: number, status: SessionView["status"] = "running"): SessionView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${status}${index}`, title: `${status} ${index}`, group: "", cwd: "/w", displayCwd: "/w", tool: "pi", status,
    stage: "investigation", stageOrigin: "default", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T10:00:00Z",
  }));
}

test("each session list opens on its own and stays open until the page is left or the list has three rows or fewer", async () => {
  const { controller, host, reads, page } = setup();
  const list = (...sessions: SessionView[][]) => { page.groups = [{ label: "", sessions: sessions.flat() }]; controller.hostUpdate(); };
  list(running(5), running(5, "waiting"), running(5, "error"));
  controller.toggleList("running");
  controller.toggleList("needs-you");
  assert.deepEqual([...controller.expandedLists], ["running", "needs-you"], "Needs you opens apart from the status lists");
  assert.equal(host.updates, 2);
  controller.toggleList("needs-you");
  assert.deepEqual([...controller.expandedLists], ["running"]);

  controller.refresh();
  reads[0]!.resolve(sample("t1"));
  await settle();
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], ["running"], "a metrics poll keeps it open");
  list(running(5), running(5, "waiting"), running(5, "error"));
  assert.deepEqual([...controller.expandedLists], ["running"], "a refresh with the same rows keeps it open");
  list(running(6), running(5, "error"));
  assert.deepEqual([...controller.expandedLists], ["running"], "a new session keeps it open");
  list(running(3), running(5, "error"));
  assert.deepEqual([...controller.expandedLists], [], "three rows have nothing to fold");
  list(running(5), running(5, "error"));
  assert.deepEqual([...controller.expandedLists], [], "a list that grows again starts folded");

  controller.toggleList("errors");
  page.shown = false;
  controller.hostUpdate();
  page.shown = true;
  controller.hostUpdate();
  assert.deepEqual([...controller.expandedLists], [], "the page opens again with every list folded");
});
