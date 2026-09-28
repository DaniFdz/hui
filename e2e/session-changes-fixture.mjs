/** Seed a disposable Git checkout, bare remote and PI transcript for the chat's
 * changes card. Usage:
 *   node e2e/session-changes-fixture.mjs <fresh /tmp/hui-changes-e2e-* root> <pi-session-manager.js>
 * The workspace is on `main` with two uncommitted edits: `src/hero.css`, written
 * by the session's `edit` tool in the transcript, and `notes.txt`, which the
 * session never touched and so must not be preselected. The transcript ends
 * with a `propose_changes` call that prefills the card's commit and PR fields. A second session,
 * *Fresh task*, has just started in the same checkout without proposing, so it
 * must show no card despite the uncommitted work. `--stack` first moves the
 * checkout to `feat/hero-base`, pushed with open draft PR #12 in the fake gh, and
 * the proposal asks to stack on it; `--pr` sets up the same open PR without
 * stacking. The proposal's action is otherwise `pr`, or `commit` with `--commit`. `--many` also adds 240
 * untracked `assets/icon-NNN.svg` files to exercise the collapsed file list.
 * `--agent-pushed` commits every edit on `feat/hero-agent` and pushes it the way
 * agents usually do, without `--set-upstream`, with open PR #14 in the fake gh,
 * to check the unpushed count.
 * `--provider <base URL>` points the fixture model at e2e/pi-provider-fixture.mjs
 * so a live prompt containing E2E_PROPOSE makes PI really call propose_changes;
 * the seeded transcript's finished call must never bring the card back. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const [rootArg, managerArg, ...flags] = process.argv.slice(2);
const providerUrl = flags.includes("--provider") ? flags[flags.indexOf("--provider") + 1] : undefined;
if (flags.includes("--provider") && !/^http:\/\/127\.0\.0\.1:\d+$/u.test(providerUrl ?? "")) throw new Error("--provider takes a loopback base URL such as http://127.0.0.1:43127");
if (!rootArg || !managerArg) throw new Error("Provide a disposable root and the installed PI session-manager.js");
const root = resolve(rootArg);
if (!root.startsWith(`${tmpdir()}/`) || !basename(root).startsWith("hui-changes-e2e-")) throw new Error("Use a fresh /tmp/hui-changes-e2e-* directory");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "HUI E2E", GIT_COMMITTER_NAME: "HUI E2E", GIT_AUTHOR_EMAIL: "e2e@hui.test", GIT_COMMITTER_EMAIL: "e2e@hui.test" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, stdio: "pipe" });

const workspace = join(root, "workspace");
const remote = join(root, "remote.git");
for (const dir of ["xdg/hui", "pi-agent", "pi-sessions", "gh", "workspace/src"]) await mkdir(join(root, dir), { recursive: true });
git(root, "init", "-q", "--bare", "-b", "main", remote);
git(workspace, "init", "-q", "-b", "main");
git(workspace, "config", "user.name", "HUI E2E");
git(workspace, "config", "user.email", "e2e@hui.test");
await writeFile(join(workspace, "src/hero.css"), ".hero {\n  color: black;\n}\n");
await writeFile(join(workspace, "README.md"), "# Marketing\n");
await writeFile(join(workspace, "notes.txt"), "scratch\n");
git(workspace, "add", ".");
git(workspace, "commit", "-qm", "Initial marketing site");
git(workspace, "remote", "add", "origin", remote);
git(workspace, "push", "-q", "-u", "origin", "main");
git(workspace, "remote", "set-head", "origin", "main");
const stack = flags.includes("--stack");
if (stack || flags.includes("--pr")) {
  git(workspace, "switch", "-qc", "feat/hero-base");
  await writeFile(join(workspace, "README.md"), "# Marketing\n\nHero section.\n");
  git(workspace, "commit", "-qam", "Add the hero section");
  git(workspace, "push", "-q", "-u", "origin", "feat/hero-base");
  await writeFile(join(root, "gh/pull-requests.json"), JSON.stringify([{ number: 12, url: "https://github.com/acme/web/pull/12", title: "Add the hero section", isDraft: true, headRefName: "feat/hero-base" }]));
}
await writeFile(join(workspace, "src/hero.css"), ".hero {\n  color: white;\n  animation: rise 600ms ease-out;\n}\n\n@keyframes rise {\n  from { transform: translateY(12px); opacity: 0; }\n}\n");
await writeFile(join(workspace, "src/hero.js"), "export const heroDelay = 120;\n");
await writeFile(join(workspace, "notes.txt"), "scratch\nunrelated operator note\n");
if (flags.includes("--agent-pushed")) {
  git(workspace, "switch", "-qc", "feat/hero-agent");
  git(workspace, "add", "-A");
  git(workspace, "commit", "-qm", "Animate the marketing hero on load");
  git(workspace, "push", "-q", "origin", "feat/hero-agent");
  await writeFile(join(root, "gh/pull-requests.json"), JSON.stringify([{ number: 14, url: "https://github.com/acme/web/pull/14", title: "Animate the marketing hero", isDraft: false, headRefName: "feat/hero-agent" }]));
}
if (flags.includes("--many")) {
  await mkdir(join(workspace, "assets"), { recursive: true });
  for (let index = 0; index < 240; index += 1) {
    await writeFile(join(workspace, "assets", `icon-${String(index).padStart(3, "0")}.svg`), `<svg xmlns="http://www.w3.org/2000/svg"><title>${index}</title></svg>\n`);
  }
}

await writeFile(join(root, "pi-agent/models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: providerUrl ?? "http://127.0.0.1:9", api: "anthropic-messages", apiKey: "***",
  models: [{ id: "fixture", name: "HUI E2E Fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
} } }));
await writeFile(join(root, "pi-agent/settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture" }));
await writeFile(join(root, "gh/account"), "hui-e2e\n");

const { SessionManager } = await import(pathToFileURL(resolve(managerArg)).href);
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const manager = SessionManager.create(workspace, join(root, "pi-sessions"));
manager.appendModelChange("hui-e2e", "fixture");
manager.appendMessage({ role: "user", content: [{ type: "text", text: "Add a marketing hero animation." }], timestamp: Date.now() });
const tools = [
  ["edit", { path: `${workspace}/src/hero.css`, edits: [{ oldText: "color: black;", newText: "color: white;" }] }],
  ["write", { path: "src/hero.js", content: "export const heroDelay = 120;\n" }],
  ["propose_changes", {
    commitMessage: "Animate the marketing hero on load\n\nFade the hero up so the headline draws attention without a layout shift.",
    prTitle: "Animate the marketing hero",
    prBody: "## Summary\n- Fade the hero up on load (600ms ease-out)\n- Export the stagger delay for the headline\n\n## Testing\n- Checked the hero in the browser",
    action: stack ? "stack" : flags.includes("--commit") ? "commit" : "pr",
  }],
];
for (const [index, [name, args]] of tools.entries()) {
  const id = `call_${index}`;
  manager.appendMessage({ role: "assistant", api: "anthropic-messages", provider: "hui-e2e", model: "fixture", content: [{ type: "toolCall", id, name, arguments: args }], stopReason: "toolUse", usage, timestamp: Date.now() });
  manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: name, isError: false, timestamp: Date.now(), content: [{ type: "text", text: "Successfully updated the file." }] });
}
manager.appendMessage({ role: "assistant", api: "anthropic-messages", provider: "hui-e2e", model: "fixture", content: [{ type: "text", text: "The hero now fades up on load. Ready to ship." }], stopReason: "stop", usage, timestamp: Date.now() });

const fresh = SessionManager.create(workspace, join(root, "pi-sessions"));
fresh.appendModelChange("hui-e2e", "fixture");
fresh.appendMessage({ role: "user", content: [{ type: "text", text: "Summarize the open settings thread." }], timestamp: Date.now() });
fresh.appendMessage({ role: "assistant", api: "anthropic-messages", provider: "hui-e2e", model: "fixture", content: [{ type: "text", text: "The thread settles on keeping settings on their own pages." }], stopReason: "stop", usage, timestamp: Date.now() });

const now = new Date().toISOString();
const sessions = [
  { id: "changes-hero", title: "Marketing hero", group: "Browser checks", cwd: workspace, tool: "pi", model: "hui-e2e/fixture", piSessionFile: manager.getSessionFile(), createdAt: now, updatedAt: now, source: "hui" },
  { id: "changes-fresh", title: "Fresh task", group: "Browser checks", cwd: workspace, tool: "pi", model: "hui-e2e/fixture", piSessionFile: fresh.getSessionFile(), createdAt: now, updatedAt: now, source: "hui" },
];
await writeFile(join(root, "xdg/hui/sessions.json"), JSON.stringify({ version: 2, sessions, groups: [{ label: "Browser checks" }] }), { flag: "wx" });
console.log(JSON.stringify({ root, workspace, remote, session: sessions[0].id }));
