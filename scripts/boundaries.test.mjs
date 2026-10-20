/**
 * Enforces the dependency rules listed in docs/map.md: which areas may import which, where network calls and
 * custom elements live, no cycles, a worker release that ships what it imports, and installed entry paths that
 * never move. ALLOWED holds today's violations: a fixed one must leave the list, a move may rename an entry, and a
 * commit never adds a new kind of violation.
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
    if (under(from, "src/lib") && ((under(to, "src/api") && !type && !from.endsWith("-store.ts")) || under(to, "src/controllers", "src/components", "src/views"))) return "R6";
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

test.each([
  ["src/lib/settings.fixture.json", "server/hui-settings.fixture.json"],
  ["src/lib/shadcn-theme.fixture.json", "server/themes.fixture.json"],
  ["src/lib/slash-commands.fixture.json", "server/sessions/slash-commands.fixture.json"],
  ["src/lib/command-references.fixture.json", "server/runtimes/command-references.fixture.json"],
  ["src/lib/session-tree.fixture.json", "server/sessions/session-tree.fixture.json"],
  ["src/lib/subagent-completion.fixture.json", "server/agent-tools/subagent-completion.fixture.json"],
  ["src/lib/run-error.fixture.json", "server/session-digest.fixture.json"],
  ["src/lib/github-links.fixture.json", "server/integrations/github-links.fixture.json"],
  ["src/lib/datadog-links.fixture.json", "server/integrations/datadog-links.fixture.json"],
  ["src/lib/session-stages.fixture.json", "server/sessions/session-stages.fixture.json"],
  ["src/lib/transcript-metrics.fixture.json", "server/runtimes/transcript-metrics.fixture.json"],
  ["src/api/session-list.fixture.json", "server/session-list.fixture.json"],
  ["src/api/files.fixture.json", "server/files.fixture.json"],
  ["src/api/browser.fixture.json", "server/browser/transport.fixture.json"],
  ["src/lib/diff/view-state.fixture.json", "server/git-diff.fixture.json"],
  ["src/lib/bots/facts.fixture.json", "server/bot-facts.fixture.json"],
  ["src/lib/bots/triggers.fixture.json", "server/bot-triggers-format.fixture.json"],
])("runtime fixtures stay byte-identical: %s and %s", async (browser, server) => {
  assert.equal(await readFile(join(root, browser), "utf8"), await readFile(join(root, server), "utf8"));
});

const ALLOWED = [
  "cli/bot-templates.test.ts -> shared/bot-export.ts (R3)",
  "cli/bot-templates.test.ts -> shared/bot-templates.ts (R3)",
  "cli/bot-templates.test.ts -> shared/bots.ts (R3)",
  "cli/bot-templates.ts -> shared/bot-export.ts (R3)",
  "cli/bot-templates.ts -> shared/bot-templates.ts (R3)",
  "cli/bots.test.ts -> shared/bots.ts (R3)",
  "cli/bots.ts -> shared/bots.ts (R3)",
  "cli/bots.ts -> shared/calls.ts (R3)",
  "cli/bots.ts -> shared/voice.ts (R3)",
  "cli/main.ts -> shared/bots.ts (R3)",
  "cli/main.ts -> shared/calls.ts (R3)",
  "cli/main.ts -> shared/voice.ts (R3)",
  "cli/schedules.test.ts -> shared/bots.ts (R3)",
  "e2e/demo/provider.ts -> shared/bots.ts (R3)",
  "server/agent-tools-bridge.ts -> shared/bots.ts (R3)",
  "server/automation.ts -> shared/bots.ts (R3)",
  "server/backlog.test.ts -> shared/backlog.ts (R3)",
  "server/backlog.ts -> shared/backlog.ts (R3)",
  "server/backlog.ts -> shared/task-suggestions.ts (R3)",
  "server/bot-conversations.ts -> shared/bots.ts (R3)",
  "server/bot-conversations.ts -> shared/calls.ts (R3)",
  "server/bot-export.test.ts -> shared/bot-export.ts (R3)",
  "server/bot-export.test.ts -> shared/bots.ts (R3)",
  "server/bot-export.ts -> shared/bot-export.ts (R3)",
  "server/bot-export.ts -> shared/bot-templates.ts (R3)",
  "server/bot-export.ts -> shared/bots.ts (R3)",
  "server/bot-memory.ts -> shared/bots.ts (R3)",
  "server/bot-remote.ts -> shared/bots.ts (R3)",
  "server/bot-routines.test.ts -> shared/bots.ts (R3)",
  "server/bot-routines.ts -> shared/bots.ts (R3)",
  "server/bot-schedules.test.ts -> shared/bots.ts (R3)",
  "server/bot-service.test.ts -> shared/bots.ts (R3)",
  "server/bot-service.test.ts -> shared/calls.ts (R3)",
  "server/bot-service.ts -> shared/bots.ts (R3)",
  "server/bot-service.ts -> shared/calls.ts (R3)",
  "server/bot-skills.ts -> shared/bot-templates.ts (R3)",
  "server/bot-souls.ts -> shared/bots.ts (R3)",
  "server/bot-template-import.test.ts -> shared/bot-templates.ts (R3)",
  "server/bot-template-import.test.ts -> shared/bots.ts (R3)",
  "server/bot-template-import.ts -> shared/bot-export.ts (R3)",
  "server/bot-template-import.ts -> shared/bot-templates.ts (R3)",
  "server/bot-template-import.ts -> shared/bots.ts (R3)",
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
  "server/bot-templates/hui-export.ts -> shared/bots.ts (R3)",
  "server/bot-templates/letta.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/letta.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.test.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/bots.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/calls.ts (R3)",
  "server/bot-templates/mapping.ts -> shared/voice.ts (R3)",
  "server/bot-templates/openclaw.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/openclaw.ts -> shared/bots.ts (R3)",
  "server/bot-templates/review.ts -> shared/bot-export.ts (R3)",
  "server/bot-templates/text.ts -> shared/bot-templates.ts (R3)",
  "server/bot-templates/text.ts -> shared/bots.ts (R3)",
  "server/bot-triggers-gateway.ts -> shared/bots.ts (R3)",
  "server/bot-triggers.test.ts -> shared/bots.ts (R3)",
  "server/bot-triggers.ts -> shared/bots.ts (R3)",
  "server/bot-workers.test.ts -> shared/bots.ts (R3)",
  "server/bots.test.ts -> shared/bots.ts (R3)",
  "server/bots.ts -> shared/bots.ts (R3)",
  "server/bots.ts -> shared/calls.ts (R3)",
  "server/bots.ts -> shared/voice.ts (R3)",
  "server/call-helper.test.ts -> shared/bots.ts (R3)",
  "server/call-helper.test.ts -> shared/calls.ts (R3)",
  "server/call-helper.ts -> shared/bots.ts (R3)",
  "server/call-helper.ts -> shared/calls.ts (R3)",
  "server/call-helper.ts -> shared/voice.ts (R3)",
  "server/calls.test.ts -> shared/bots.ts (R3)",
  "server/calls.test.ts -> shared/calls.ts (R3)",
  "server/calls.ts -> shared/bots.ts (R3)",
  "server/calls.ts -> shared/calls.ts (R3)",
  "server/calls.ts -> shared/voice.ts (R3)",
  "server/hui.ts -> shared/bots.ts (R3)",
  "server/hui.ts -> shared/vscode.ts (R3)",
  "server/hui.ts -> shared/widgets.ts (R3)",
  "server/live-sessions.ts -> shared/task-suggestions.ts (R3)",
  "server/live-sessions.ts -> shared/watchers.ts (R3)",
  "server/model-routing.test.ts -> shared/branch-names.ts (R3)",
  "server/model-routing.ts -> shared/backlog.ts (R3)",
  "server/model-routing.ts -> shared/branch-names.ts (R3)",
  "server/pi-config.ts -> shared/thinking.ts (R3)",
  "server/routes/bot-templates.test.ts -> shared/bot-export.ts (R3)",
  "server/routes/bot-templates.test.ts -> shared/bot-templates.ts (R3)",
  "server/routes/bot-templates.test.ts -> shared/bots.ts (R3)",
  "server/routes/bot-triggers.test.ts -> shared/bots.ts (R3)",
  "server/routes/bots.test.ts -> shared/bots.ts (R3)",
  "server/routes/calls.test.ts -> shared/bots.ts (R3)",
  "server/routes/calls.test.ts -> shared/calls.ts (R3)",
  "server/routes/calls.ts -> shared/bots.ts (R3)",
  "server/routes/calls.ts -> shared/calls.ts (R3)",
  "server/routes/jira.ts -> shared/task-suggestions.ts (R3)",
  "server/routes/session-actions.ts -> shared/bots.ts (R3)",
  "server/routes/session-actions.ts -> shared/thinking.ts (R3)",
  "server/routes/sessions.ts -> shared/bots.ts (R3)",
  "server/routes/vscode.ts -> shared/vscode.ts (R3)",
  "server/routes/worktrees.ts -> shared/worktrees.ts (R3)",
  "server/routes/watchers.ts -> shared/watchers.ts (R3)",
  "server/runtimes/durable-bot-access.test.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bot-access.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bots.test.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-bots.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-offer.ts -> shared/bots.ts (R3)",
  "server/runtimes/durable-optchat.test.ts -> shared/calls.ts (R3)",
  "server/runtimes/durable-optchat.ts -> shared/calls.ts (R3)",
  "server/runtimes/durable.ts -> shared/bots.ts (R3)",
  "server/runtimes/pi.ts -> shared/calls.ts (R3)",
  "server/runtimes/turn-origins.ts -> shared/calls.ts (R3)",
  "server/runtimes/types.ts -> shared/calls.ts (R3)",
  "server/runtimes/widget-code.test.ts -> shared/widgets.ts (R3)",
  "server/services.ts -> shared/bots.ts (R3)",
  "server/services.ts -> shared/task-suggestions.ts (R3)",
  "server/sessions/lifecycle.ts -> shared/branch-names.ts (R3)",
  "server/sessions/lifecycle.ts -> shared/thinking.ts (R3)",
  "server/sessions/views.ts -> shared/progress-card.ts (R3)",
  "server/static-files.ts -> shared/app-routes.ts (R3)",
  "server/subagents.ts -> shared/thinking.ts (R3)",
  "server/task-suggestions.test.ts -> shared/task-suggestions.ts (R3)",
  "server/task-suggestions.ts -> shared/task-suggestions.ts (R3)",
  "server/vscode-install.ts -> shared/vscode.ts (R3)",
  "server/vscode-providers.ts -> shared/vscode.ts (R3)",
  "server/vscode-proxy.test.ts -> shared/vscode.ts (R3)",
  "server/vscode-proxy.ts -> shared/vscode.ts (R3)",
  "server/vscode.ts -> shared/vscode.ts (R3)",
  "server/watchers.test.ts -> shared/watchers.ts (R3)",
  "server/watchers.ts -> shared/watchers.ts (R3)",
  "server/widget-sandbox.test.ts -> shared/widgets.ts (R3)",
  "server/widget-sandbox.ts -> shared/widgets.ts (R3)",
  "server/worker/host-bots.ts -> shared/bot-templates.ts (R3)",
  "server/worker/host-bots.ts -> shared/bots.ts (R3)",
  "server/worker/host-bots.ts -> shared/calls.ts (R3)",
  "server/worker/host.ts -> shared/bots.ts (R3)",
  "server/workers.ts -> shared/bots.ts (R3)",
  "server/worktree-inventory.test.ts -> shared/worktrees.ts (R3)",
  "server/worktree-inventory.ts -> shared/worktrees.ts (R3)",
  "server/worktrees.ts -> shared/branch-names.ts (R3)",
  "shared/ (R3)",
  "shared/bot-export.ts -> shared/bots.ts (R3)",
  "shared/bot-templates.ts -> shared/bot-export.ts (R3)",
  "shared/bot-templates.ts -> shared/bots.ts (R3)",
  "shared/bots.ts -> shared/thinking.ts (R3)",
  "shared/voice.ts -> shared/calls.ts (R3)",
  "src/api/backlog.ts -> shared/backlog.ts (R3)",
  "src/api/backlog.ts -> shared/task-suggestions.ts (R3)",
  "src/api/bot-templates.ts -> shared/bot-export.ts (R3)",
  "src/api/bot-templates.ts -> shared/bot-templates.ts (R3)",
  "src/api/bots.test.ts -> shared/bots.ts (R3)",
  "src/api/calls.ts -> shared/calls.ts (R3)",
  "src/api/sessions.ts -> shared/calls.ts (R3)",
  "src/api/sessions.ts -> shared/task-suggestions.ts (R3)",
  "src/api/sessions.ts -> shared/watchers.ts (R3)",
  "src/api/task-suggestions.ts -> shared/task-suggestions.ts (R3)",
  "src/api/vscode.ts -> shared/vscode.ts (R3)",
  "src/api/watchers.ts -> shared/watchers.ts (R3)",
  "src/api/worktrees.ts -> shared/worktrees.ts (R3)",
  "src/components/backlog-start-dialog.ts -> shared/backlog.ts (R3)",
  "src/components/backlog-start-dialog.ts -> shared/branch-names.ts (R3)",
  "src/components/bot-face.ts -> shared/bots.ts (R3)",
  "src/components/fork-dialog.ts -> shared/branch-names.ts (R3)",
  "src/components/settings/calls.test.ts -> shared/calls.ts (R3)",
  "src/components/settings/calls.ts -> shared/calls.ts (R3)",
  "src/components/settings/vscode.ts -> shared/vscode.ts (R3)",
  "src/components/vscode-view.ts -> shared/vscode.ts (R3)",
  "src/components/widget-card.ts -> shared/widgets.ts (R3)",
  "src/controllers/bot-import-controller.ts -> shared/bot-export.ts (R3)",
  "src/controllers/bots-controller.ts -> shared/calls.ts (R3)",
  "src/lib/attachment-file-icon.test.ts -> src/views/home.ts (R6)",
  "src/lib/backlog-start.ts -> shared/backlog.ts (R3)",
  "src/lib/bots/bots.test.ts -> shared/bots.ts (R3)",
  "src/lib/bots/bots.ts -> shared/bots.ts (R3)",
  "src/lib/bots/bots.ts -> shared/calls.ts (R3)",
  "src/lib/bots/bots.ts -> shared/voice.ts (R3)",
  "src/lib/bots/face.test.ts -> shared/bots.ts (R3)",
  "src/lib/bots/templates.ts -> shared/bot-export.ts (R3)",
  "src/lib/bots/templates.ts -> shared/bot-templates.ts (R3)",
  "src/lib/bots/tools.ts -> shared/bots.ts (R3)",
  "src/lib/jira.test.ts -> src/views/shell.ts (R6)",
  "src/lib/kanban.test.ts -> shared/backlog.ts (R3)",
  "src/lib/kanban.ts -> shared/backlog.ts (R3)",
  "src/lib/message-context-menu.test.ts -> src/views/home.ts (R6)",
  "src/lib/navigation.test.ts -> shared/app-routes.ts (R3)",
  "src/lib/progress-card.ts -> shared/progress-card.ts (R3)",
  "src/lib/session/sessions.ts -> shared/calls.ts (R3)",
  "src/lib/settings.ts -> shared/calls.ts (R3)",
  "src/lib/subagent-completion.test.ts -> src/views/chat/projection.ts (R6)",
  "src/lib/task-suggestions.ts -> shared/task-suggestions.ts (R3)",
  "src/lib/terminal-font.test.ts -> src/views/settings.ts (R6)",
  "src/lib/theme/vscode-theme.ts -> shared/vscode.ts (R3)",
  "src/lib/transcript-state.ts -> shared/calls.ts (R3)",
  "src/lib/voice/live-call-platform.ts -> shared/calls.ts (R3)",
  "src/lib/voice/live-call.test.ts -> shared/bots.ts (R3)",
  "src/lib/voice/live-call.test.ts -> shared/calls.ts (R3)",
  "src/lib/voice/live-call.ts -> shared/bots.ts (R3)",
  "src/lib/voice/live-call.ts -> shared/calls.ts (R3)",
  "src/lib/voice/voice.ts -> shared/voice.ts (R3)",
  "src/lib/vscode-store.ts -> shared/vscode.ts (R3)",
  "src/lib/widgets.test.ts -> shared/widgets.ts (R3)",
  "src/lib/widgets.ts -> shared/widgets.ts (R3)",
  "src/lib/worktrees.ts -> shared/worktrees.ts (R3)",
  "src/views/bot-import.ts -> shared/bot-export.ts (R3)",
  "src/views/bot-import.ts -> shared/bot-templates.ts (R3)",
  "src/views/bot-settings.ts -> shared/bots.ts (R3)",
  "src/views/bot-settings.ts -> shared/calls.ts (R3)",
  "src/views/bot-settings.ts -> shared/thinking.ts (R3)",
  "src/views/bot-settings.ts -> shared/voice.ts (R3)",
  "src/views/bot-tools.ts -> shared/bots.ts (R3)",
  "src/views/bot-voice.ts -> shared/bots.ts (R3)",
  "src/views/bot-voice.ts -> shared/calls.ts (R3)",
  "src/views/bots.ts -> shared/bots.ts (R3)",
  "src/views/chat-call.ts -> shared/calls.ts (R3)",
  "src/views/chat/projection.test.ts -> shared/bots.ts (R3)",
  "src/views/chat/projection.ts -> shared/bots.ts (R3)",
  "src/views/home.test.ts -> src/hui-app.ts (R7)",
  "src/views/home.ts -> shared/bots.ts (R3)",
  "src/views/home.ts -> shared/thinking.ts (R3)",
  "src/views/kanban.ts -> shared/backlog.ts (R3)",
  "src/views/kanban.ts -> shared/task-suggestions.ts (R3)",
  "src/views/settings-automation.test.ts -> src/hui-app.ts (R7)",
  "src/views/settings-workspaces.test.ts -> src/hui-app.ts (R7)",
  "src/views/shell.test.ts -> src/hui-app.ts (R7)",
  "src/views/worktrees.test.ts -> shared/worktrees.ts (R3)",
];
