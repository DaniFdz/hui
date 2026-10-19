/**
 * Enforces the dependency rules listed in docs/map.md: which areas may import which, where network calls and
 * custom elements live, no cycles, a worker release that ships what it imports, and installed entry paths that
 * never move. ALLOWED holds today's violations; it may only shrink, so a fixed one must leave the list.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { test } from "vitest";
import { workerRelease } from "../server/worker/release.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const AREAS = ["bin", "cli", "desktop", "evals", "e2e", "scripts", "server", "shared", "src"];
const CODE = /\.[cm]?[jt]s$/u;
const TEST = /\.test\.[cm]?[jt]s$/u;
const ENTRIES = ["bin/hui.mjs", "cli/launch.ts", "cli/main.ts", "cli/gateway-run.ts", "server/runtimes/pi-sdk-worker.ts", "server/worker/main.ts", "index.html"];

const under = (path, ...dirs) => dirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
const builtin = (specifier) => specifier.startsWith("node:") || builtinModules.includes(specifier.split("/")[0]);

async function sources(directory) {
  const found = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...await sources(path));
    } else if (CODE.test(entry.name)) found.push(path);
  }
  return found;
}

function walk(node, visit) {
  if (Array.isArray(node)) for (const child of node) walk(child, visit);
  else if (typeof node?.type === "string") {
    visit(node);
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value, visit);
  }
}

const text = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined);
const named = (node, name) => node?.type === "Identifier" && node.name === name;
const member = (node, object, property) => node?.type === "MemberExpression" && named(node.object, object) && named(node.property, property);

/** Import-like specifiers and the network and element calls a file makes. */
function scan(file, code) {
  const imports = [];
  const calls = new Set();
  walk(parseAst(code, { lang: /\.d\.[cm]?ts$/u.test(file) ? "dts" : "ts" }), (node) => {
    if (node.type === "ImportDeclaration") imports.push({ specifier: node.source.value, type: node.importKind === "type" });
    else if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      if (node.source) imports.push({ specifier: node.source.value, type: node.exportKind === "type" });
    } else if (node.type === "ImportExpression" && text(node.source)) imports.push({ specifier: text(node.source), type: false });
    else if (node.type === "TSImportType" && text(node.source)) imports.push({ specifier: text(node.source), type: true });
    else if (node.type === "NewExpression") {
      const [target, base] = node.arguments;
      if (named(node.callee, "URL") && CODE.test(text(target) ?? "") && base?.type === "MemberExpression" && base.object.type === "MetaProperty") {
        imports.push({ specifier: text(target), type: false });
      }
      if (named(node.callee, "WebSocket") || named(node.callee, "EventSource")) calls.add(`new ${node.callee.name}`);
    } else if (node.type === "CallExpression") {
      if (named(node.callee, "fetch") || member(node.callee, "window", "fetch") || member(node.callee, "globalThis", "fetch")) calls.add("fetch");
      if (member(node.callee, "customElements", "define")) calls.add("customElements.define");
    } else if (node.type === "Decorator" && named(node.expression.callee ?? node.expression, "customElement")) calls.add("@customElement");
  });
  return { imports, calls };
}

function rule(from, to, specifier, type) {
  const production = !TEST.test(from);
  if (to === undefined) {
    if (under(from, "src") && production && builtin(specifier)) return "R1";
    if (under(from, "server/api") && !/^typebox(?:\/|$)/u.test(specifier)) return "R15";
    return undefined;
  }
  if (under(to, "shared")) return "R3";
  if (under(from, "src")) {
    if (!under(to, "src")) return "R1";
    if (under(from, "src/lib") && ((under(to, "src/api") && !type) || under(to, "src/controllers", "src/components", "src/views"))) return "R6";
    if (under(from, "src/views") && (under(to, "src/controllers") || to === "src/hui-app.ts")) return "R7";
    return undefined;
  }
  if (under(from, "bin", "cli", "desktop", "server") && under(to, "src")) return "R2";
  if (under(to, "e2e", "evals", "scripts")) return production && under(from, "bin", "cli", "desktop", "server") ? "R11" : undefined;
  if (under(from, "server/optchat") && !under(to, "server/optchat")) return "R9";
  if (under(from, "server/api") && !under(to, "server/api")) return "R15";
  if (under(from, "server/runtimes", "server/sessions") && under(to, "server/bots")) return "R8";
  if (under(from, "server", "cli") && !under(to, "server", "cli")) return "R4";
  if (under(from, "desktop") && !under(to, "desktop")) return "R4";
  if (under(from, "bin") && !under(to, "bin", "cli", "server", "desktop", "build")) return "R4";
  return undefined;
}

const files = (await Promise.all(AREAS.map(sources))).flat().sort();
const edges = [];
const unresolved = [];
const violations = new Set();
for (const file of files) {
  const { imports, calls } = scan(file, await readFile(join(root, file), "utf8"));
  const production = !TEST.test(file);
  for (const { specifier, type } of imports) {
    const relativePath = specifier.startsWith(".") ? posix.join(posix.dirname(file), specifier.split("?")[0]) : undefined;
    if (relativePath && !under(relativePath, "build", "dist") && !existsSync(join(root, relativePath))) {
      if (production) unresolved.push(`${file} -> ${specifier}`);
      continue;
    }
    if (relativePath) edges.push({ from: file, to: relativePath, type });
    const broken = rule(file, relativePath, specifier, type);
    if (broken) violations.add(`${file} -> ${relativePath ?? specifier} (${broken})`);
  }
  if (under(file, "src") && production) {
    for (const call of calls) {
      if (call.endsWith("define") || call === "@customElement") {
        if (!under(file, "src/components", "src/hui-app.ts")) violations.add(`${file}: ${call} (R7)`);
      } else if (!under(file, "src/api")) violations.add(`${file}: ${call} (R5)`);
    }
  }
}

for (const file of files.filter((path) => under(path, "e2e", "evals", "scripts"))) {
  const targets = edges.filter((edge) => edge.from === file);
  if (targets.some((edge) => under(edge.to, "src")) && targets.some((edge) => under(edge.to, "server"))) violations.add(`${file} (R12)`);
}

const inside = new Map();
for (const { from, to } of edges) {
  if (["src", "server", "cli"].some((area) => under(from, area) && under(to, area))) inside.set(from, [...inside.get(from) ?? [], to]);
}
function reachable(start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    for (const next of inside.get(stack.pop()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}
for (const [from, targets] of inside) for (const to of targets) if (reachable(to).has(from)) violations.add(`${from} -> ${to} (R10)`);

const shipped = new Set((await workerRelease()).files.map((file) => file.path));
const workerModules = files.filter((file) => !TEST.test(file) && (["server/worker/main.ts", "server/worker/host.ts"].includes(file) || under(file, "server/runtimes")));
for (const from of workerModules) {
  for (const { to } of edges.filter((edge) => edge.from === from && !edge.type)) {
    if (!shipped.has(to)) violations.add(`${from} -> ${to} (R14)`);
    else if (!workerModules.includes(to)) workerModules.push(to);
  }
}

if (existsSync(join(root, "shared"))) violations.add("shared/ (R3)");
for (const entry of ENTRIES) if (!existsSync(join(root, entry))) violations.add(`${entry} (R17)`);

const found = [...violations].sort();

test("every relative production import resolves", () => {
  assert.deepEqual(unresolved, []);
});

test("no import breaks a dependency rule beyond the allowlist", () => {
  assert.deepEqual(found.filter((violation) => !ALLOWED.includes(violation)), [], "fix these (rules in docs/map.md)");
});

test("every allowlisted violation still occurs", () => {
  assert.deepEqual(ALLOWED.filter((violation) => !found.includes(violation)), [], "fixed: delete these from ALLOWED");
});

const ALLOWED = [
  "cli/bot-templates.test.ts -> shared/bot-export.ts (R3)",
  "cli/bot-templates.test.ts -> shared/bot-templates.ts (R3)",
  "cli/bot-templates.test.ts -> shared/bots.ts (R3)",
  "cli/bot-templates.ts -> shared/bot-export.ts (R3)",
  "cli/bot-templates.ts -> shared/bot-templates.ts (R3)",
  "cli/bot-templates.ts -> shared/bot-triggers.ts (R3)",
  "cli/bot-templates.ts -> shared/bots.ts (R3)",
  "cli/bot-triggers.test.ts -> shared/bot-triggers.ts (R3)",
  "cli/bot-triggers.ts -> shared/bot-triggers.ts (R3)",
  "cli/bot-triggers.ts -> shared/bots.ts (R3)",
  "cli/bots.test.ts -> shared/bots.ts (R3)",
  "cli/bots.test.ts -> src/lib/automation-types.ts (R2)",
  "cli/bots.ts -> shared/bots.ts (R3)",
  "cli/bots.ts -> shared/calls.ts (R3)",
  "cli/bots.ts -> shared/voice.ts (R3)",
  "cli/doctor.test.ts -> src/lib/settings.ts (R2)",
  "cli/gateway-client.ts -> shared/bots.ts (R3)",
  "cli/gateway-client.ts -> src/lib/automation-types.ts (R2)",
  "cli/main.ts -> shared/bots.ts (R3)",
  "cli/main.ts -> shared/calls.ts (R3)",
  "cli/main.ts -> shared/voice.ts (R3)",
  "cli/releases.ts -> src/lib/update-types.ts (R2)",
  "cli/schedules.test.ts -> shared/bots.ts (R3)",
  "cli/schedules.test.ts -> src/lib/automation-types.ts (R2)",
  "cli/schedules.ts -> shared/bots.ts (R3)",
  "cli/schedules.ts -> src/lib/automation-types.ts (R2)",
  "cli/update-job.ts -> src/lib/update-types.ts (R2)",
  "cli/update-worker.ts -> src/lib/update-types.ts (R2)",
  "cli/workers.test.ts -> shared/workers.ts (R3)",
  "cli/workers.ts -> shared/workers.ts (R3)",
  "e2e/demo/provider.ts -> shared/bots.ts (R3)",
  "evals/jira-draft/cases.ts (R12)",
  "evals/jira-draft/cases.ts -> shared/jira.ts (R3)",
  "evals/jira-draft/grade.ts -> shared/jira.ts (R3)",
  "evals/jira-draft/run.ts -> shared/jira.ts (R3)",
  "server/agent-tools-bridge.ts -> shared/bots.ts (R3)",
  "server/automation.test.ts -> src/lib/automation-types.ts (R2)",
  "server/automation.ts -> src/lib/automation-types.ts (R2)",
  "server/backlog.test.ts -> shared/backlog.ts (R3)",
  "server/backlog.ts -> shared/backlog.ts (R3)",
  "server/backlog.ts -> shared/jira.ts (R3)",
  "server/bot-conversations.ts -> shared/bots.ts (R3)",
  "server/bot-conversations.ts -> shared/calls.ts (R3)",
  "server/bot-export.test.ts -> shared/bot-export.ts (R3)",
  "server/bot-export.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-export.test.ts -> shared/bots.ts (R3)",
  "server/bot-export.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-export.ts -> shared/bot-export.ts (R3)",
  "server/bot-export.ts -> shared/bot-templates.ts (R3)",
  "server/bot-export.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-export.ts -> shared/bots.ts (R3)",
  "server/bot-export.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-facts.ts -> shared/bot-facts.ts (R3)",
  "server/bot-memory.ts -> shared/bots.ts (R3)",
  "server/bot-remote.test.ts -> shared/workers.ts (R3)",
  "server/bot-remote.ts -> shared/bot-facts.ts (R3)",
  "server/bot-remote.ts -> shared/bots.ts (R3)",
  "server/bot-routes.test.ts -> shared/bots.ts (R3)",
  "server/bot-routes.ts -> src/lib/slash-commands.ts (R2)",
  "server/bot-routines.test.ts -> shared/bots.ts (R3)",
  "server/bot-routines.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-routines.ts -> shared/bots.ts (R3)",
  "server/bot-routines.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-schedules.test.ts -> shared/bots.ts (R3)",
  "server/bot-schedules.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-service.test.ts -> shared/bots.ts (R3)",
  "server/bot-service.test.ts -> shared/calls.ts (R3)",
  "server/bot-service.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-service.test.ts -> src/lib/settings.ts (R2)",
  "server/bot-service.test.ts -> src/lib/subagent-completion.ts (R2)",
  "server/bot-service.ts -> shared/bots.ts (R3)",
  "server/bot-service.ts -> shared/calls.ts (R3)",
  "server/bot-service.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-service.ts -> src/lib/subagent-completion.ts (R2)",
  "server/bot-skills.ts -> shared/bot-templates.ts (R3)",
  "server/bot-souls.ts -> shared/bots.ts (R3)",
  "server/bot-souls.ts -> src/lib/settings.ts (R2)",
  "server/bot-template-import.test.ts -> shared/bot-templates.ts (R3)",
  "server/bot-template-import.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-template-import.test.ts -> shared/bots.ts (R3)",
  "server/bot-template-import.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-template-import.ts -> shared/bot-export.ts (R3)",
  "server/bot-template-import.ts -> shared/bot-templates.ts (R3)",
  "server/bot-template-import.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-template-import.ts -> shared/bots.ts (R3)",
  "server/bot-template-import.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-template-routes.test.ts -> shared/bot-export.ts (R3)",
  "server/bot-template-routes.test.ts -> shared/bot-templates.ts (R3)",
  "server/bot-template-routes.test.ts -> shared/bots.ts (R3)",
  "server/bot-template-routes.test.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-templates/character-card.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/character-card.ts -> shared/bots.ts (R3)",
  "server/bot-templates/claude-code.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/claude-code.ts -> shared/bots.ts (R3)",
  "server/bot-templates/common.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/common.ts -> shared/bots.ts (R3)",
  "server/bot-templates/crewai.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/crewai.ts -> shared/bots.ts (R3)",
  "server/bot-templates/detect.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/fetch.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/formats.test.ts -> shared/bots.ts (R3)",
  "server/bot-templates/grok.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/grok.ts -> shared/bots.ts (R3)",
  "server/bot-templates/hui-export.ts -> shared/bot-export.ts (R3)",
  "server/bot-templates/hui-export.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/hui-export.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-templates/hui-export.ts -> shared/bots.ts (R3)",
  "server/bot-templates/hui-export.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-templates/letta.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/letta.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.test.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/calls.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/voice.ts (R3)",
  "server/bot-templates/mapping.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-templates/openclaw.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/openclaw.ts -> shared/bots.ts (R3)",
  "server/bot-templates/review.ts -> shared/bot-export.ts (R3)",
  "server/bot-templates/schedule.ts -> src/lib/automation-types.ts (R2)",
  "server/bot-templates/text.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/text.ts -> shared/bots.ts (R3)",
  "server/bot-trigger-routes.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-trigger-routes.test.ts -> shared/bots.ts (R3)",
  "server/bot-trigger-routes.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-gateway.ts -> shared/bots.ts (R3)",
  "server/bot-triggers-input.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-listener.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-listener.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-listener.ts -> shared/github-links.ts (R3)",
  "server/bot-triggers-prs.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-prs.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers-prs.ts -> shared/github-links.ts (R3)",
  "server/bot-triggers-store.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers.test.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers.test.ts -> shared/bots.ts (R3)",
  "server/bot-triggers.ts -> shared/bot-triggers.ts (R3)",
  "server/bot-triggers.ts -> shared/bots.ts (R3)",
  "server/bot-workers.test.ts -> shared/bots.ts (R3)",
  "server/bots.test.ts -> shared/bots.ts (R3)",
  "server/bots.ts -> shared/bots.ts (R3)",
  "server/bots.ts -> shared/calls.ts (R3)",
  "server/bots.ts -> shared/voice.ts (R3)",
  "server/browser-transport.test.ts -> shared/browser.ts (R3)",
  "server/browser-transport.ts -> shared/browser.ts (R3)",
  "server/browser/manager.test.ts -> shared/browser.ts (R3)",
  "server/browser/manager.test.ts -> src/lib/settings.ts (R2)",
  "server/browser/manager.ts -> shared/browser.ts (R3)",
  "server/browser/manager.ts -> src/lib/settings.ts (R2)",
  "server/call-helper.test.ts -> shared/bots.ts (R3)",
  "server/call-helper.test.ts -> shared/calls.ts (R3)",
  "server/call-helper.ts -> shared/bot-facts.ts (R3)",
  "server/call-helper.ts -> shared/bots.ts (R3)",
  "server/call-helper.ts -> shared/calls.ts (R3)",
  "server/call-helper.ts -> shared/voice.ts (R3)",
  "server/call-routes.test.ts -> shared/bots.ts (R3)",
  "server/call-routes.test.ts -> shared/calls.ts (R3)",
  "server/call-routes.test.ts -> src/lib/settings.ts (R2)",
  "server/call-routes.ts -> shared/bots.ts (R3)",
  "server/call-routes.ts -> shared/calls.ts (R3)",
  "server/call-routes.ts -> src/lib/settings.ts (R2)",
  "server/calls.test.ts -> shared/bots.ts (R3)",
  "server/calls.test.ts -> shared/calls.ts (R3)",
  "server/calls.ts -> shared/bots.ts (R3)",
  "server/calls.ts -> shared/calls.ts (R3)",
  "server/calls.ts -> shared/voice.ts (R3)",
  "server/datadog-previews.test.ts -> shared/datadog.ts (R3)",
  "server/datadog-previews.ts -> shared/datadog.ts (R3)",
  "server/datadog.test.ts -> shared/datadog.ts (R3)",
  "server/datadog.ts -> shared/datadog.ts (R3)",
  "server/diff-routes.ts -> shared/diff.ts (R3)",
  "server/file-routes.test.ts -> shared/files.ts (R3)",
  "server/file-routes.ts -> shared/files.ts (R3)",
  "server/files.ts -> shared/files.ts (R3)",
  "server/git-diff.ts -> shared/diff.ts (R3)",
  "server/github-contributions.test.ts -> shared/github.ts (R3)",
  "server/github-contributions.ts -> shared/github.ts (R3)",
  "server/github-previews.ts -> shared/github-links.ts (R3)",
  "server/github-previews.ts -> shared/pull-requests.ts (R3)",
  "server/github.test.ts -> shared/github.ts (R3)",
  "server/github.ts -> shared/github.ts (R3)",
  "server/hui-settings.ts -> src/lib/settings.ts (R2)",
  "server/hui.ts -> shared/backlog.ts (R3)",
  "server/hui.ts -> shared/bots.ts (R3)",
  "server/hui.ts -> shared/branch-names.ts (R3)",
  "server/hui.ts -> shared/browser.ts (R3)",
  "server/hui.ts -> shared/datadog.ts (R3)",
  "server/hui.ts -> shared/github-links.ts (R3)",
  "server/hui.ts -> shared/jira.ts (R3)",
  "server/hui.ts -> shared/progress-card.ts (R3)",
  "server/hui.ts -> shared/pull-requests.ts (R3)",
  "server/hui.ts -> shared/session-stages.ts (R3)",
  "server/hui.ts -> shared/task-suggestions.ts (R3)",
  "server/hui.ts -> shared/thinking.ts (R3)",
  "server/hui.ts -> shared/vscode.ts (R3)",
  "server/hui.ts -> shared/watchers.ts (R3)",
  "server/hui.ts -> shared/widgets.ts (R3)",
  "server/hui.ts -> shared/worktrees.ts (R3)",
  "server/hui.ts -> src/lib/automation-types.ts (R2)",
  "server/hui.ts -> src/lib/session-tree.ts (R2)",
  "server/hui.ts -> src/lib/settings.ts (R2)",
  "server/hui.ts -> src/lib/shadcn-theme.ts (R2)",
  "server/hui.ts -> src/lib/slash-commands.ts (R2)",
  "server/jira.ts -> shared/jira.ts (R3)",
  "server/live-sessions.test.ts -> src/lib/settings.ts (R2)",
  "server/live-sessions.ts -> shared/task-suggestions.ts (R3)",
  "server/live-sessions.ts -> shared/watchers.ts (R3)",
  "server/live-sessions.ts -> src/lib/settings.ts (R2)",
  "server/live-sessions.ts -> src/lib/subagent-completion.ts (R2)",
  "server/live-sessions.ts -> src/lib/tools-types.ts (R2)",
  "server/model-routing.test.ts -> shared/branch-names.ts (R3)",
  "server/model-routing.test.ts -> src/lib/settings.ts (R2)",
  "server/model-routing.ts -> shared/backlog.ts (R3)",
  "server/model-routing.ts -> shared/branch-names.ts (R3)",
  "server/model-routing.ts -> src/lib/settings.ts (R2)",
  "server/pi-config.ts -> shared/thinking.ts (R3)",
  "server/power.ts -> shared/power.ts (R3)",
  "server/provider-quota.ts -> shared/providers.ts (R3)",
  "server/providers.ts -> shared/providers.ts (R3)",
  "server/pull-requests.ts -> shared/pull-requests.ts (R3)",
  "server/runtimes/durable-bot-access.test.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bot-access.test.ts -> src/lib/settings.ts (R2)",
  "server/runtimes/durable-bot-access.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bot-routines.test.ts -> src/lib/settings.ts (R2)",
  "server/runtimes/durable-bots.test.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bots.test.ts -> src/lib/settings.ts (R2)",
  "server/runtimes/durable-bots.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bots.ts -> shared/calls.ts (R3)",
  "server/runtimes/durable-optchat.test.ts -> shared/calls.ts (R3)",
  "server/runtimes/durable-optchat.ts -> shared/calls.ts (R3)",
  "server/runtimes/durable-prompt.ts -> src/lib/settings.ts (R2)",
  "server/runtimes/durable.test.ts -> src/lib/settings.ts (R2)",
  "server/runtimes/durable.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable.ts -> src/lib/command-references.ts (R2)",
  "server/runtimes/durable.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/pi-sdk-worker.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/pi.ts -> shared/calls.ts (R3)",
  "server/runtimes/pi.ts -> src/lib/command-references.ts (R2)",
  "server/runtimes/pi.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/remote.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/sdk-inspector.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/tool-catalog.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/types.ts -> shared/calls.ts (R3)",
  "server/runtimes/types.ts -> src/lib/tools-types.ts (R2)",
  "server/runtimes/widget-code.test.ts -> shared/widgets.ts (R3)",
  "server/session-activity.test.ts -> src/lib/subagent-completion.ts (R2)",
  "server/session-activity.ts -> shared/session-activity.ts (R3)",
  "server/session-digest.test.ts -> src/lib/run-error.ts (R2)",
  "server/session-digest.test.ts -> src/lib/subagent-completion.ts (R2)",
  "server/session-digest.ts -> src/lib/run-error.ts (R2)",
  "server/session-digest.ts -> src/lib/subagent-completion.ts (R2)",
  "server/session-list.test.ts -> shared/session-list.ts (R3)",
  "server/session-list.ts -> shared/session-list.ts (R3)",
  "server/session-stages.test.ts -> shared/session-stages.ts (R3)",
  "server/session-transport.test.ts -> src/api/sessions.ts (R2)",
  "server/sessions.ts -> shared/session-stages.ts (R3)",
  "server/static-files.ts -> shared/app-routes.ts (R3)",
  "server/subagents.ts -> shared/thinking.ts (R3)",
  "server/subagents.ts -> src/lib/subagent-completion.ts (R2)",
  "server/task-suggestions.test.ts -> shared/task-suggestions.ts (R3)",
  "server/task-suggestions.ts -> shared/task-suggestions.ts (R3)",
  "server/terminal-transport.test.ts -> shared/terminal-stream.ts (R3)",
  "server/terminal-transport.ts -> shared/terminal-stream.ts (R3)",
  "server/terminals.ts -> src/lib/terminal-types.ts (R2)",
  "server/tools.ts -> src/lib/tools-types.ts (R2)",
  "server/updates.test.ts -> src/lib/update-types.ts (R2)",
  "server/updates.ts -> src/lib/update-types.ts (R2)",
  "server/vscode-install.ts -> shared/vscode.ts (R3)",
  "server/vscode-providers.ts -> shared/vscode.ts (R3)",
  "server/vscode-proxy.test.ts -> shared/vscode.ts (R3)",
  "server/vscode-proxy.test.ts -> src/lib/settings.ts (R2)",
  "server/vscode-proxy.ts -> shared/vscode.ts (R3)",
  "server/vscode.test.ts -> src/lib/settings.ts (R2)",
  "server/vscode.ts -> shared/vscode.ts (R3)",
  "server/vscode.ts -> src/lib/settings.ts (R2)",
  "server/watchers.test.ts -> shared/watchers.ts (R3)",
  "server/watchers.ts -> shared/watchers.ts (R3)",
  "server/widget-sandbox.test.ts -> shared/widgets.ts (R3)",
  "server/widget-sandbox.ts -> shared/widgets.ts (R3)",
  "server/worker/bootstrap.ts -> shared/workers.ts (R3)",
  "server/worker/host-bots.ts -> shared/bot-templates.ts (R3)",
  "server/worker/host-bots.ts -> shared/bots.ts (R3)",
  "server/worker/host-bots.ts -> shared/calls.ts (R3)",
  "server/worker/host.ts -> shared/bots.ts (R3)",
  "server/workers.ts -> shared/bots.ts (R3)",
  "server/workers.ts -> shared/workers.ts (R3)",
  "server/workers.ts -> src/lib/settings.ts (R2)",
  "server/worktree-inventory.test.ts -> shared/worktrees.ts (R3)",
  "server/worktree-inventory.ts -> shared/pull-requests.ts (R3)",
  "server/worktree-inventory.ts -> shared/worktrees.ts (R3)",
  "server/worktrees.ts -> shared/branch-names.ts (R3)",
  "shared/ (R3)",
  "shared/backlog.ts -> shared/jira.ts (R3)",
  "shared/backlog.ts -> shared/session-stages.ts (R3)",
  "shared/bot-export.ts -> shared/bot-triggers.ts (R3)",
  "shared/bot-export.ts -> shared/bots.ts (R3)",
  "shared/bot-templates.ts -> shared/bot-export.ts (R3)",
  "shared/bot-templates.ts -> shared/bots.ts (R3)",
  "shared/bots.ts -> shared/calls.ts (R3)",
  "shared/bots.ts -> shared/thinking.ts (R3)",
  "shared/bots.ts -> shared/voice.ts (R3)",
  "shared/datadog.ts -> shared/github-links.ts (R3)",
  "shared/github-links.ts -> shared/pull-requests.ts (R3)",
  "shared/session-stages.ts -> shared/pull-requests.ts (R3)",
  "shared/voice.ts -> shared/calls.ts (R3)",
  "shared/worktrees.ts -> shared/pull-requests.ts (R3)",
  "src/api/browser.ts -> shared/browser.ts (R3)",
  "src/api/diff.ts -> shared/diff.ts (R3)",
  "src/api/files.ts -> shared/files.ts (R3)",
  "src/api/sessions.ts -> server/questionnaires.ts (R1)",
  "src/api/sessions.ts -> server/runtimes/transcript-metrics.ts (R1)",
  "src/api/sessions.ts -> shared/calls.ts (R3)",
  "src/api/sessions.ts -> shared/jira.ts (R3)",
  "src/api/sessions.ts -> shared/pull-requests.ts (R3)",
  "src/api/sessions.ts -> shared/session-list.ts (R3)",
  "src/api/sessions.ts -> shared/session-stages.ts (R3)",
  "src/api/sessions.ts -> shared/task-suggestions.ts (R3)",
  "src/api/sessions.ts -> shared/watchers.ts (R3)",
  "src/components/backlog-start-dialog.ts -> shared/backlog.ts (R3)",
  "src/components/backlog-start-dialog.ts -> shared/branch-names.ts (R3)",
  "src/components/backlog-start-dialog.ts -> shared/session-stages.ts (R3)",
  "src/components/bot-face.ts -> shared/bots.ts (R3)",
  "src/components/datadog-embeds.ts -> shared/datadog.ts (R3)",
  "src/components/diff-view.ts -> shared/diff.ts (R3)",
  "src/components/file-link.ts -> shared/files.ts (R3)",
  "src/components/files-view.ts -> shared/files.ts (R3)",
  "src/components/files-view.ts: fetch (R5)",
  "src/components/fork-dialog.ts -> shared/branch-names.ts (R3)",
  "src/components/github-embeds.ts -> shared/github-links.ts (R3)",
  "src/components/github-embeds.ts -> shared/pull-requests.ts (R3)",
  "src/components/jira-create-dialog.ts -> shared/jira.ts (R3)",
  "src/components/jira-hovercard.ts -> shared/jira.ts (R3)",
  "src/components/jira-link-dialog.ts -> shared/jira.ts (R3)",
  "src/components/media-viewer.ts: fetch (R5)",
  "src/components/pull-request-hovercard.ts -> shared/pull-requests.ts (R3)",
  "src/components/questionnaire-card.ts -> server/questionnaires.ts (R1)",
  "src/components/terminal-pane.ts -> shared/terminal-stream.ts (R3)",
  "src/components/vscode-view.ts -> shared/vscode.ts (R3)",
  "src/components/widget-card.ts -> shared/widgets.ts (R3)",
  "src/hui-app.ts -> shared/calls.ts (R3)",
  "src/hui-app.ts -> shared/power.ts (R3)",
  "src/hui-app.ts -> shared/session-list.ts (R3)",
  "src/hui-app.ts -> shared/session-stages.ts (R3)",
  "src/lib/attachment-file-icon.test.ts -> src/views/home.ts (R6)",
  "src/lib/attachments.ts: fetch (R5)",
  "src/lib/automation.ts -> src/api/request.ts (R6)",
  "src/lib/backlog-start.ts -> shared/backlog.ts (R3)",
  "src/lib/backlog.ts -> shared/backlog.ts (R3)",
  "src/lib/backlog.ts -> shared/jira.ts (R3)",
  "src/lib/backlog.ts -> shared/task-suggestions.ts (R3)",
  "src/lib/backlog.ts -> src/api/request.ts (R6)",
  "src/lib/bot-face.test.ts -> shared/bots.ts (R3)",
  "src/lib/bot-face.ts -> shared/bots.ts (R3)",
  "src/lib/bot-facts.test.ts -> shared/bot-facts.ts (R3)",
  "src/lib/bot-facts.ts -> shared/bot-facts.ts (R3)",
  "src/lib/bot-facts.ts -> src/api/request.ts (R6)",
  "src/lib/bot-import-controller.ts -> shared/bot-export.ts (R3)",
  "src/lib/bot-import-controller.ts -> src/views/bot-import.ts (R6)",
  "src/lib/bot-import-controller.ts -> src/views/bots.ts (R6)",
  "src/lib/bot-routines.ts -> shared/bot-triggers.ts (R3)",
  "src/lib/bot-templates.ts -> shared/bot-export.ts (R3)",
  "src/lib/bot-templates.ts -> shared/bot-templates.ts (R3)",
  "src/lib/bot-templates.ts -> src/api/request.ts (R6)",
  "src/lib/bot-tools.test.ts -> shared/bots.ts (R3)",
  "src/lib/bot-tools.ts -> shared/bots.ts (R3)",
  "src/lib/bot-tools.ts -> src/api/request.ts (R6)",
  "src/lib/bot-tools.ts -> src/api/sessions.ts (R6)",
  "src/lib/bot-triggers.test.ts -> shared/bot-triggers.ts (R3)",
  "src/lib/bot-triggers.test.ts -> shared/bots.ts (R3)",
  "src/lib/bot-triggers.ts -> shared/bot-triggers.ts (R3)",
  "src/lib/bot-triggers.ts -> shared/bots.ts (R3)",
  "src/lib/bot-triggers.ts -> src/api/request.ts (R6)",
  "src/lib/bots.test.ts -> shared/bots.ts (R3)",
  "src/lib/bots.ts -> shared/bots.ts (R3)",
  "src/lib/bots.ts -> shared/calls.ts (R3)",
  "src/lib/bots.ts -> shared/voice.ts (R3)",
  "src/lib/bots.ts -> src/api/request.ts (R6)",
  "src/lib/bots.ts -> src/api/sessions.ts (R6)",
  "src/lib/browser-status.test.ts -> shared/browser.ts (R3)",
  "src/lib/browser-status.ts -> shared/browser.ts (R3)",
  "src/lib/browser-view-controller.test.ts -> shared/browser.ts (R3)",
  "src/lib/browser-view-controller.ts -> shared/browser.ts (R3)",
  "src/lib/browser-view.test.ts -> shared/browser.ts (R3)",
  "src/lib/browser-view.ts -> shared/browser.ts (R3)",
  "src/lib/browser-view.ts -> src/views/settings-picker.ts (R6)",
  "src/lib/control-surfaces.ts -> shared/power.ts (R3)",
  "src/lib/control-surfaces.ts -> src/api/request.ts (R6)",
  "src/lib/datadog-links.test.ts -> shared/datadog.ts (R3)",
  "src/lib/datadog.test.ts -> shared/datadog.ts (R3)",
  "src/lib/datadog.ts -> shared/datadog.ts (R3)",
  "src/lib/datadog.ts -> src/api/request.ts (R6)",
  "src/lib/diff-view-state.test.ts -> shared/diff.ts (R3)",
  "src/lib/diff-view-state.ts -> shared/diff.ts (R3)",
  "src/lib/file-draft.ts -> shared/files.ts (R3)",
  "src/lib/file-link-store.test.ts -> shared/files.ts (R3)",
  "src/lib/file-link-store.ts -> shared/files.ts (R3)",
  "src/lib/github-contributions.ts -> shared/github.ts (R3)",
  "src/lib/github-contributions.ts -> src/api/request.ts (R6)",
  "src/lib/github-links.test.ts -> shared/github-links.ts (R3)",
  "src/lib/github-previews.test.ts -> shared/github-links.ts (R3)",
  "src/lib/github-previews.ts -> shared/github-links.ts (R3)",
  "src/lib/github-previews.ts -> src/api/request.ts (R6)",
  "src/lib/github.test.ts -> shared/github.ts (R3)",
  "src/lib/github.ts -> shared/github.ts (R3)",
  "src/lib/github.ts -> src/api/request.ts (R6)",
  "src/lib/jira.test.ts -> shared/jira.ts (R3)",
  "src/lib/jira.test.ts -> src/views/shell.ts (R6)",
  "src/lib/jira.ts -> shared/jira.ts (R3)",
  "src/lib/jira.ts -> src/api/request.ts (R6)",
  "src/lib/kanban.test.ts -> shared/backlog.ts (R3)",
  "src/lib/kanban.ts -> shared/backlog.ts (R3)",
  "src/lib/kanban.ts -> shared/pull-requests.ts (R3)",
  "src/lib/kanban.ts -> shared/session-stages.ts (R3)",
  "src/lib/kanban.ts -> src/api/sessions.ts (R6)",
  "src/lib/live-call-platform.ts -> shared/calls.ts (R3)",
  "src/lib/live-call-platform.ts -> src/api/request.ts (R6)",
  "src/lib/live-call-platform.ts -> src/api/sessions.ts (R6)",
  "src/lib/live-call.test.ts -> shared/bots.ts (R3)",
  "src/lib/live-call.test.ts -> shared/calls.ts (R3)",
  "src/lib/live-call.ts -> shared/bots.ts (R3)",
  "src/lib/live-call.ts -> shared/calls.ts (R3)",
  "src/lib/local-paths.test.ts -> shared/bots.ts (R3)",
  "src/lib/local-paths.ts -> shared/bots.ts (R3)",
  "src/lib/local-paths.ts -> src/api/request.ts (R6)",
  "src/lib/message-context-menu.test.ts -> src/views/home.ts (R6)",
  "src/lib/message-metadata.ts -> server/runtimes/transcript-metrics.ts (R1)",
  "src/lib/navigation.test.ts -> shared/app-routes.ts (R3)",
  "src/lib/observability.ts -> src/api/request.ts (R6)",
  "src/lib/pages.test.ts -> src/views/hui-owned-surfaces.ts (R6)",
  "src/lib/pages.test.ts -> src/views/observability.ts (R6)",
  "src/lib/pages.test.ts -> src/views/pi-surfaces.ts (R6)",
  "src/lib/pi.ts -> src/api/request.ts (R6)",
  "src/lib/picker-options.ts -> src/views/settings-picker.ts (R6)",
  "src/lib/progress-card.ts -> shared/progress-card.ts (R3)",
  "src/lib/provider-choices.test.ts -> shared/providers.ts (R3)",
  "src/lib/provider-choices.ts -> shared/providers.ts (R3)",
  "src/lib/pull-requests.test.ts -> shared/pull-requests.ts (R3)",
  "src/lib/session-calendar.test.ts -> shared/session-activity.ts (R3)",
  "src/lib/session-calendar.ts -> shared/session-activity.ts (R3)",
  "src/lib/session-calendar.ts -> src/api/request.ts (R6)",
  "src/lib/settings-store.ts -> src/api/settings.ts (R6)",
  "src/lib/settings.ts -> shared/calls.ts (R3)",
  "src/lib/settings.ts -> shared/vscode.ts (R3)",
  "src/lib/sidebar-sessions.test.ts -> src/api/sessions.ts (R6)",
  "src/lib/sidebar-sessions.ts -> shared/session-stages.ts (R3)",
  "src/lib/sidebar-sessions.ts -> src/api/sessions.ts (R6)",
  "src/lib/subagent-completion.test.ts -> src/views/chat/projection.ts (R6)",
  "src/lib/task-suggestions.ts -> shared/task-suggestions.ts (R3)",
  "src/lib/task-suggestions.ts -> src/api/request.ts (R6)",
  "src/lib/terminal-font.test.ts -> src/views/settings.ts (R6)",
  "src/lib/terminal-stream.ts -> shared/terminal-stream.ts (R3)",
  "src/lib/theme-store.ts -> src/api/request.ts (R6)",
  "src/lib/tools-store.ts -> src/api/request.ts (R6)",
  "src/lib/transcript-state.ts -> server/runtimes/transcript-metrics.ts (R1)",
  "src/lib/transcript-state.ts -> shared/calls.ts (R3)",
  "src/lib/update-store.ts -> src/api/request.ts (R6)",
  "src/lib/voice.ts -> shared/voice.ts (R3)",
  "src/lib/vscode-store.ts -> shared/vscode.ts (R3)",
  "src/lib/vscode-store.ts -> src/api/request.ts (R6)",
  "src/lib/vscode-theme.ts -> shared/vscode.ts (R3)",
  "src/lib/watchers.ts -> shared/watchers.ts (R3)",
  "src/lib/watchers.ts -> src/api/request.ts (R6)",
  "src/lib/widgets.test.ts -> shared/widgets.ts (R3)",
  "src/lib/widgets.ts -> shared/widgets.ts (R3)",
  "src/lib/work-views/diff.ts -> src/components/diff-view.ts (R6)",
  "src/lib/work-views/files.ts -> src/components/files-view.ts (R6)",
  "src/lib/work-views/terminal.ts -> src/api/terminals.ts (R6)",
  "src/lib/work-views/vscode.ts -> src/components/vscode-view.ts (R6)",
  "src/lib/workers.ts -> shared/workers.ts (R3)",
  "src/lib/workers.ts -> src/api/request.ts (R6)",
  "src/lib/working-directories.ts -> src/api/request.ts (R6)",
  "src/lib/worktrees.ts -> shared/worktrees.ts (R3)",
  "src/lib/worktrees.ts -> src/api/request.ts (R6)",
  "src/views/bot-facts.ts -> shared/bot-facts.ts (R3)",
  "src/views/bot-import.ts -> shared/bot-export.ts (R3)",
  "src/views/bot-import.ts -> shared/bot-templates.ts (R3)",
  "src/views/bot-import.ts -> shared/bot-triggers.ts (R3)",
  "src/views/bot-settings.ts -> shared/bots.ts (R3)",
  "src/views/bot-settings.ts -> shared/calls.ts (R3)",
  "src/views/bot-settings.ts -> shared/thinking.ts (R3)",
  "src/views/bot-settings.ts -> shared/voice.ts (R3)",
  "src/views/bot-tools.ts -> shared/bots.ts (R3)",
  "src/views/bot-triggers.ts -> shared/bot-triggers.ts (R3)",
  "src/views/bot-triggers.ts -> shared/bots.ts (R3)",
  "src/views/bot-voice.ts -> shared/bots.ts (R3)",
  "src/views/bot-voice.ts -> shared/calls.ts (R3)",
  "src/views/bots.ts -> shared/bot-triggers.ts (R3)",
  "src/views/bots.ts -> shared/bots.ts (R3)",
  "src/views/bots.ts -> shared/workers.ts (R3)",
  "src/views/chat-call.ts -> shared/calls.ts (R3)",
  "src/views/chat/projection.test.ts -> shared/bots.ts (R3)",
  "src/views/chat/projection.ts -> shared/bots.ts (R3)",
  "src/views/contributions.ts -> shared/github.ts (R3)",
  "src/views/contributions.ts: customElements.define (R7)",
  "src/views/home.test.ts -> src/hui-app.ts (R7)",
  "src/views/home.ts -> server/questionnaires.ts (R1)",
  "src/views/home.ts -> shared/bots.ts (R3)",
  "src/views/home.ts -> shared/thinking.ts (R3)",
  "src/views/hui-owned-surfaces.test.ts -> src/hui-app.ts (R7)",
  "src/views/kanban.ts -> shared/backlog.ts (R3)",
  "src/views/kanban.ts -> shared/jira.ts (R3)",
  "src/views/kanban.ts -> shared/pull-requests.ts (R3)",
  "src/views/kanban.ts -> shared/session-stages.ts (R3)",
  "src/views/kanban.ts -> shared/task-suggestions.ts (R3)",
  "src/views/list-filter.ts: customElements.define (R7)",
  "src/views/power-notice.ts -> shared/power.ts (R3)",
  "src/views/session-calendar.ts -> shared/session-activity.ts (R3)",
  "src/views/session-calendar.ts: customElements.define (R7)",
  "src/views/settings-automation.test.ts -> src/hui-app.ts (R7)",
  "src/views/settings-browser.ts -> shared/browser.ts (R3)",
  "src/views/settings-browser.ts: customElements.define (R7)",
  "src/views/settings-calls.test.ts -> shared/calls.ts (R3)",
  "src/views/settings-calls.ts -> shared/calls.ts (R3)",
  "src/views/settings-calls.ts: customElements.define (R7)",
  "src/views/settings-datadog.ts -> shared/datadog.ts (R3)",
  "src/views/settings-datadog.ts: customElements.define (R7)",
  "src/views/settings-gateway.test.ts -> shared/power.ts (R3)",
  "src/views/settings-github.ts -> shared/github.ts (R3)",
  "src/views/settings-github.ts: customElements.define (R7)",
  "src/views/settings-jira.ts -> shared/jira.ts (R3)",
  "src/views/settings-jira.ts: customElements.define (R7)",
  "src/views/settings-providers.ts -> shared/providers.ts (R3)",
  "src/views/settings-providers.ts: customElements.define (R7)",
  "src/views/settings-tools.ts: customElements.define (R7)",
  "src/views/settings-vscode.ts -> shared/vscode.ts (R3)",
  "src/views/settings-vscode.ts: customElements.define (R7)",
  "src/views/settings-workers.ts: customElements.define (R7)",
  "src/views/settings-workspaces.test.ts -> src/hui-app.ts (R7)",
  "src/views/settings.ts -> shared/power.ts (R3)",
  "src/views/shell.test.ts -> src/hui-app.ts (R7)",
  "src/views/shell.ts -> shared/jira.ts (R3)",
  "src/views/shell.ts -> shared/pull-requests.ts (R3)",
  "src/views/shell.ts -> shared/session-stages.ts (R3)",
  "src/views/worktrees.test.ts -> shared/worktrees.ts (R3)",
  "src/views/worktrees.ts -> shared/pull-requests.ts (R3)",
];
