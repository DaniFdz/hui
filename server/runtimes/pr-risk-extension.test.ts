import assert from "node:assert/strict";
import { test } from "node:test";

import prRiskExtension, { parsePullRequestRisk } from "./pr-risk-extension.mjs";
import { huiToolDefinitions } from "./hui-tools.ts";

const valid = { risk: "medium", summary: "Touches auth.", reasons: ["New token path"], focusAreas: [{ path: "src/auth.ts", note: "token refresh" }] };

test("report_pr_risk accepts the spec schema and rejects anything else", () => {
  assert.deepEqual(parsePullRequestRisk(valid), { verdict: valid });
  assert.deepEqual(parsePullRequestRisk({ risk: "low", summary: " Fine ", reasons: [] }), { verdict: { risk: "low", summary: "Fine", reasons: [] } });
  const invalid: unknown[] = [
    undefined,
    [],
    { ...valid, risk: "critical" },
    { ...valid, summary: "" },
    { ...valid, summary: "x".repeat(601) },
    { ...valid, reasons: "one" },
    { ...valid, reasons: Array.from({ length: 11 }, () => "r") },
    { ...valid, reasons: ["x".repeat(301)] },
    { ...valid, reasons: [""] },
    { ...valid, focusAreas: Array.from({ length: 11 }, () => ({ path: "a", note: "b" })) },
    { ...valid, focusAreas: [{ path: "", note: "b" }] },
    { ...valid, focusAreas: [{ path: "a" }] },
  ];
  for (const value of invalid) assert.ok("error" in parsePullRequestRisk(value), JSON.stringify(value));
  assert.ok("verdict" in parsePullRequestRisk({ ...valid, summary: "x".repeat(600), reasons: Array.from({ length: 10 }, () => "r".repeat(300)) }));
});

test("the tool returns immediately with the verdict and fails on invalid input", async () => {
  const tools: { name: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; details: unknown }> }[] = [];
  prRiskExtension({ registerTool: (tool: never) => { tools.push(tool); } });
  assert.equal(tools[0]?.name, "report_pr_risk");
  const result = await tools[0]!.execute("id", valid);
  assert.deepEqual(result.details, valid);
  assert.match(result.content[0]!.text, /medium/u);
  await assert.rejects(tools[0]!.execute("id", { ...valid, risk: "severe" }), /risk/u);
});

test("report_pr_risk is registered only for pr-review sessions", () => {
  assert.equal(huiToolDefinitions().some((tool) => tool.name === "report_pr_risk"), false);
  assert.equal(huiToolDefinitions({ prReview: true }).some((tool) => tool.name === "report_pr_risk"), true);
});
