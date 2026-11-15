import assert from "node:assert/strict";
import { test } from "vitest";

import { startNoticeAfterRefresh } from "./local-providers.ts";

const provider = (id: string, status: "online" | "offline" | "starting" | "failed" | "unknown") => ({ id, status });

test("a start's notice stays while it runs and goes when it settles", () => {
  assert.deepEqual(
    startNoticeAfterRefresh("Starting Qwen…", "qwen", [provider("qwen", "starting")]),
    { notice: "Starting Qwen…", settled: false },
    "the row is still starting",
  );
  for (const status of ["online", "offline", "failed", "unknown"] as const) {
    assert.deepEqual(
      startNoticeAfterRefresh("Starting Qwen…", "qwen", [provider("qwen", status)]),
      { notice: "", settled: true },
      `a ${status} provider must not keep "Starting…" above the list`,
    );
  }
  assert.deepEqual(
    startNoticeAfterRefresh("Starting Qwen…", "qwen", []),
    { notice: "", settled: true },
    "a provider removed while starting settles its notice too",
  );
});

test("a start settling leaves a newer notice alone", () => {
  assert.deepEqual(
    startNoticeAfterRefresh("Start command saved for Qwen.", "qwen", [provider("qwen", "online")]),
    { notice: "Start command saved for Qwen.", settled: true },
  );
  assert.deepEqual(
    startNoticeAfterRefresh("Starting Qwen…", "", [provider("qwen", "online")]),
    { notice: "Starting Qwen…", settled: false },
    "only the start that wrote the notice can clear it",
  );
});
