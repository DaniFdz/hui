/** `worker_stats`: local and worker totals, session counts and the least loaded choice an agent uses before creating a session. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { HostMetrics } from "../api/host.ts";
import { summarizeWorkerStats } from "./worker-stats.ts";

const sample = (cpuPercent: number, usedBytes = 4_000, totalBytes = 8_000): HostMetrics => ({
  sampledAt: "2026-11-09T12:00:00.000Z",
  host: { platform: "linux", cores: 8 },
  cpu: { percent: cpuPercent, load: [0.1, 0.2, 0.3] },
  memory: { totalBytes, usedBytes },
  disk: { path: "/", totalBytes: 100_000, usedBytes: 50_000 },
  network: null,
  gpu: null,
  gateway: { cpuPercent: 1, rssBytes: 1_024 },
});

test("a caller sees its own machine and each worker, with the least loaded connected machine recommended", () => {
  const stats = summarizeWorkerStats({
    current: "box",
    local: { metrics: sample(10), hostname: "gateway" },
    workers: [
      { id: "box", name: "Build box", state: "connected", metrics: sample(90) },
      { id: "phone", name: "Phone", state: "connected", metrics: sample(5) },
      { id: "off", name: "Offline", state: "disconnected" },
    ],
    sessions: [
      { status: "running" },
      { worker: "box", status: "running" },
      { worker: "box", status: "idle" },
      { worker: "phone", status: "idle", archived: true },
    ],
  });

  assert.equal(stats.current, "box");
  assert.deepEqual(stats.machines.map((machine) => [machine.id, machine.current, machine.sessions.total, machine.sessions.running]), [
    ["local", false, 1, 1],
    ["box", true, 2, 1],
    ["phone", false, 0, 0],
    ["off", false, 0, 0],
  ]);
  assert.equal(stats.recommended?.id, "phone");
  assert.match(stats.recommended?.reason ?? "", /lowest CPU, memory and disk/u);
  assert.equal(stats.machines[1]?.memory?.percent, 50);
  assert.equal(stats.machines[1]?.disk?.percent, 50);
});

test("a disconnected or erroring worker is never recommended, and a local read error leaves no recommendation", () => {
  const disconnected = summarizeWorkerStats({
    current: "local",
    local: { metrics: sample(20), hostname: "gateway" },
    workers: [{ id: "off", name: "Offline", state: "disconnected" }],
    sessions: [],
  });
  assert.equal(disconnected.recommended?.id, "local");
  assert.equal(disconnected.machines[1]?.error, undefined);

  const noSamples = summarizeWorkerStats({
    current: "local",
    local: { error: "metrics unavailable", hostname: "gateway" },
    workers: [{ id: "box", name: "Box", state: "connected", error: "older release" }],
    sessions: [],
  });
  assert.equal(noSamples.recommended, undefined);
  assert.equal(noSamples.machines[0]?.error, "metrics unavailable");
  assert.equal(noSamples.machines[1]?.error, "older release");
});
