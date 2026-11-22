/**
 * The demo world: an isolated HUI with a few small Git repositories, sessions
 * of an imaginary team across Kanban stages, local backlog tasks, settings and
 * its Datadog org.
 * Run by `visual-verification.mjs launch --demo` before the gateway starts,
 * with XDG_CONFIG_HOME, PI_CODING_AGENT_DIR, HUI_E2E_WORKSPACE and HUI_FAKE_GH_DIR.
 */
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, SystemEntry, ToolResultEntry, UsageDoc, UserEntry } from "@earendil-works/pi-durable";
import { DurableHost, durableContext } from "../../server/runtimes/durable-host.ts";
import { CONFIG_DIR } from "../../server/paths.ts";

const { HUI_E2E_WORKSPACE: workspace, PI_CODING_AGENT_DIR: agentDir, HUI_FAKE_GH_DIR: ghDir } = process.env;
// Run outside the launcher, CONFIG_DIR would be the operator's own ~/.config/hui; the launcher's is in a temporary directory.
if (!workspace || !agentDir || !ghDir || !relative(homedir(), CONFIG_DIR).startsWith("..")) {
  throw new Error("Run by visual-verification.mjs launch --demo, whose isolated XDG_CONFIG_HOME is outside your home directory.");
}
const MINUTE = 60_000;
const now = Date.now();

/** The prompt a PI session leads with, recorded as its first entry: the context meter's System prompt row reads it, the
 * tool definitions beside it are PI's own, and what a model call adds after them is the conversation. It is the shape of
 * prompt a coding agent really starts with, so a fresh session's split shows a prompt, its tools and its conversation. */
const PROMPT = [
  "You are PI, a coding agent working in the user's project.",
  "",
  "# How you work",
  "",
  "- Read the code before you change it. Look at the callers of a function you edit, and the tests that cover it.",
  "- Keep each change small enough to read: one concern, and the tests that prove it.",
  "- Run the checks your change touches, and report what you ran. A check you did not run is not a check that passed.",
  "- When something fails, fix the cause rather than the assertion, the test or the output.",
  "- Ask before you delete data, rewrite history, or change a format the project stores.",
  "- Leave the repository as you found it apart from your change: no stray files, no edits outside the task.",
  "",
  "# Tools",
  "",
  "- `read` returns a file's text, truncated to 2000 lines or 50KB; pass `offset` and `limit` for the rest.",
  "- `write` creates or overwrites a file, and `edit` replaces exact text, several places at once when they are disjoint.",
  "- `bash` runs a command in the project directory; use it for the tests, the build and Git, not for reading files.",
  "- `grep` and `find` search contents and names; `ls` lists a directory. They are faster than reading whole trees.",
  "",
  "# Reporting",
  "",
  "- Say what you changed, where, and what you ran. One or two sentences per point, with file paths in backticks.",
  "- Name the next step when the work is not finished, and the decision you need from the user when there is one.",
  "- Keep the answer short enough to read on a phone; put detail in the code, not in prose.",
  "",
  "# Environment",
  "",
  "- The project is a Git checkout on a branch of the user's naming; commit only when the user asks you to.",
  "- Tests run with the project's own runner; look at package.json before you assume which one.",
  "- The user reads your work in HUI, which keeps the session, its Work pane and its tools beside the conversation.",
].join("\n");
const toolDefinitions = (cwd: string) => JSON.parse(JSON.stringify([createReadToolDefinition(cwd), createWriteToolDefinition(cwd), createEditToolDefinition(cwd), createBashToolDefinition(cwd), createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd)]
  .map(({ name, description, parameters }) => ({ name, description, parameters })))) as { name: string; description: string; parameters: Record<string, unknown> }[];
const systemEntry = (cwd: string, at: number) => ({
  kind: SystemEntry.kind,
  model: [{ role: "system", content: PROMPT, toolsAdded: toolDefinitions(cwd), timestamp: at - 5 * MINUTE }],
} as never);

/**
 * The payments API's reference doc: the real file a docs audit reads, one section per endpoint with an example request
 * and response, so reading it carries about as much as a real API reference. It stays under the read tool's 50KB, so
 * the session's transcript holds the whole file. Its `POST /refunds` example is the one that drifted: the endpoint reads
 * a `lines` array, and the doc still sends a single `amount`.
 */
function paymentsDoc(): string {
  const resources = ["orders", "refunds", "customers", "payment methods", "payouts", "disputes", "webhooks", "ledger entries", "invoices", "subscriptions"];
  const actions: [method: string, suffix: string, verb: string, what: (resource: string) => string][] = [
    ["GET", "", "List", (resource) => `every ${resource} the merchant can see, newest first`],
    ["GET", "/{id}", "Retrieve", (resource) => `one ${resource} by its id`],
    ["POST", "", "Create", (resource) => `a ${resource} for the merchant's account`],
    ["POST", "/{id}/reverse", "Reverse", (resource) => `a settled ${resource} in full, while its balance still covers it`],
  ];
  const notes = [
    "Amounts are integer minor units in the account's settlement currency.",
    "Send an `Idempotency-Key` on every write: a replay returns the first response for 24 hours.",
    "A request without `Acme-Version` is served by the oldest supported version.",
    "Paginate with `starting_after`, and enlarge a page with `limit`: a response holds at most 100 objects.",
  ];
  const section = (resource: string, method: string, route: string, verb: string, what: string, note: string) => {
    const object = resource.replaceAll(" ", "_");
    const id = `${object.slice(0, 3)}_8f2k1`;
    const body = method === "POST" ? ` \\\n  -d '{ "description": "Acme test ${object}", "metadata": { "order": "ord_8f2" } }'` : "";
    return `## ${method} ${route}\n\n${verb} ${what}.\n\n### Parameters\n\n| name | type | description |\n| --- | --- | --- |\n| id | string | The ${object} id, prefixed \`${object.slice(0, 3)}_\`. |\n| metadata | object | Up to 50 key-value pairs, stored with the ${object} and returned with it. |\n| limit | integer | The page size, from 1 to 100. The default is 10. |\n| starting_after | string | The id the page starts after, for pagination. |\n\n### Request\n\n\`\`\`sh\ncurl -X ${method} "https://api.acme.test/v1${route}" \\\n  -H "Authorization: Bearer $ACME_KEY" \\\n  -H "Acme-Version: 2026-04-01"${body}\n\`\`\`\n\n### Response\n\n\`\`\`json\n{\n  "id": "${id}",\n  "object": "${object}",\n  "created": 1763425200,\n  "livemode": true,\n  "settlement_currency": "usd",\n  "metadata": {}\n}\n\`\`\`\n\n### Notes\n\n- ${note}\n`;
  };
  const sections = resources.flatMap((resource) => actions.map(([method, suffix, verb, what], index) => {
    const route = `/${resource.replaceAll(" ", "-")}${suffix}`;
    if (resource === "refunds" && method === "POST") {
      // The example that drifted: `POST /refunds` takes `lines`, which this example never sends.
      return `## POST /refunds\n\nRefund one or more line items of an order.\n\n### Request\n\n\`\`\`sh\ncurl -X POST "https://api.acme.test/v1/refunds" \\\n  -H "Authorization: Bearer $ACME_KEY" \\\n  -d '{ "orderId": "ord_8f2", "amount": 1250 }'\n\`\`\`\n\n### Response\n\n\`\`\`json\n{\n  "id": "ref_8f2k1",\n  "object": "refund",\n  "orderId": "ord_8f2",\n  "amount": 1250,\n  "status": "refunded"\n}\n\`\`\`\n\n### Notes\n\n- A refund starts as \`pending\`, then settles to \`refunded\` or \`failed\`.\n`;
    }
    return section(resource, method, route, verb, what(resource), notes[index % notes.length]!);
  }));
  return `# Payments API\n\nAcme's payments API: orders, refunds, payouts and webhooks, for merchant accounts in 38 countries.\nEvery request is served over HTTPS at api.acme.test, authenticated with a restricted key or a Connect key, and pinned\nto an \`Acme-Version\` for as long as that version is supported.\n\n${sections.join("\n")}`;
}

const docs = paymentsDoc();

const repos: Record<string, Record<string, string>> = {
  storefront: {
    "src/orders/orders-page.js": "import { listOrders } from \"../api.js\";\n\n/** The orders table: every order of the last 90 days, newest first. */\nexport async function ordersPage() {\n  const orders = await listOrders({ days: 90 });\n  return { title: \"Orders\", columns: [\"id\", \"customer\", \"total\", \"status\"], rows: orders };\n}\n",
    "src/api.js": "export async function listOrders() {\n  return [];\n}\n",
    "test/export-csv.test.js": "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { toCsv } from \"../src/orders/export-csv.js\";\n\nconst order = { id: \"A-1001\", customer: \"Dana\", total: 42, status: \"paid\" };\ntest(\"writes a header row\", () => assert.equal(toCsv([]), \"id,customer,total,status\"));\ntest(\"writes one row per order\", () => assert.equal(toCsv([order]).split(\"\\n\")[1], \"A-1001,Dana,42,paid\"));\ntest(\"quotes commas\", () => assert.match(toCsv([{ ...order, customer: \"Lee, Sam\" }]), /\"Lee, Sam\"/));\ntest(\"escapes quotes\", () => assert.match(toCsv([{ ...order, customer: \"The \\\"Shop\\\"\" }]), /\"The \"\"Shop\"\"\"/));\n",
    "package.json": "{ \"name\": \"storefront\", \"type\": \"module\", \"private\": true }\n",
    "ci/build-times.csv": "day,branch,median_minutes\nMon,main,14.2\nMon,pr,11.5\nTue,main,13.8\nTue,pr,11.9\nWed,main,8.9\nWed,pr,7.2\nThu,main,8.6\nThu,pr,6.8\nFri,main,8.4\nFri,pr,6.9\n",
  },
  "payments-api": {
    "docs/payments.md": docs,
    "src/refunds/route.js": "import { orders, issueRefund } from \"../store.js\";\n\nexport async function postRefund(request, response) {\n  const order = await orders.get(request.body.orderId);\n  for (const line of request.body.lines) {\n    await issueRefund(order, line);\n  }\n  response.status(201).json({ refunded: request.body.lines.length });\n}\n",
    "src/store.js": "export const orders = { get: async (id) => ({ id, customerId: \"c-1\" }) };\nexport async function issueRefund() {}\n",
    "test/refunds.test.js": "import { test } from \"node:test\";\n\ntest(\"refunds a whole order\", () => {});\n",
    "package.json": "{ \"name\": \"payments-api\", \"type\": \"module\", \"private\": true }\n",
  },
  "mobile-app": { "README.md": "# Acme mobile\n" },
  docs: { "README.md": "# Acme docs\n" },
};

const gitIn = (root: string) => (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
for (const [name, files] of Object.entries(repos)) {
  const root = join(workspace, name);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Acme"], ["user.email", "dev@acme.test"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) git("config", key!, value!);
  git("add", ".");
  git("commit", "-q", "-m", "Initial commit");
}
await appendFile(join(workspace, "payments-api", "src/refunds/route.js"), "\nexport const PARTIAL_REFUNDS = true;\n");
gitIn(join(workspace, "payments-api"))("commit", "-q", "-a", "-m", "Partial refunds endpoint (#148)");

type Seed = {
  title: string; repo: string; group: string; stage: string; ago: number; ask: string; answer: string; unread?: boolean;
  model: "claude-sonnet-4-5" | "gpt-5.1" | "gemini-3-pro";
  /** A file the session read before it answered: its content is in the transcript, so the context carries it. */
  read?: string;
};
const seeds: Seed[] = [
  { title: "Apple Pay at checkout", repo: "storefront", group: "Storefront", stage: "implementation", ago: 3, ask: "Add Apple Pay to checkout behind the payments flag", answer: "Apple Pay is wired into the payment sheet; I'm adding the merchant validation endpoint next.", model: "claude-sonnet-4-5" },
  { title: "Flaky checkout e2e test", repo: "storefront", group: "Storefront", stage: "investigation", ago: 12, ask: "Why does checkout.spec fail one run in ten?", answer: "The test clicks Pay before the totals request settles. I'm confirming with a trace.", unread: true, model: "claude-sonnet-4-5" },
  { title: "Search results skeleton", repo: "storefront", group: "Storefront", stage: "testing", ago: 41, ask: "Show a skeleton while search results load", answer: "Done: skeleton rows match the result card height, so nothing jumps. Ready for review.", model: "gpt-5.1" },
  { title: "Upgrade to Vite 8", repo: "storefront", group: "Storefront", stage: "done", ago: 180, ask: "Upgrade the storefront to Vite 8", answer: "Upgraded; the build is 31% faster and all tests pass.", model: "claude-sonnet-4-5" },
  { title: "Rate limiter on Redis", repo: "payments-api", group: "Payments", stage: "implementation", ago: 7, ask: "Move the rate limiter from memory to Redis", answer: "The sliding window now lives in Redis; I'm load testing it.", model: "claude-sonnet-4-5" },
  { title: "Retry-safe webhooks", repo: "payments-api", group: "Payments", stage: "testing", ago: 55, ask: "Make the Stripe webhook handler idempotent", answer: "Processed event ids are stored for 7 days, so retries are ignored. Tests cover duplicates.", model: "gemini-3-pro" },
  { title: "JPY rounding fix", repo: "payments-api", group: "Payments", stage: "done", ago: 300, ask: "Totals in JPY round to the wrong yen", answer: "Fixed: zero-decimal currencies skip the cents conversion.", model: "gpt-5.1" },
  { title: "Offline receipts", repo: "mobile-app", group: "Mobile", stage: "investigation", ago: 25, ask: "Can receipts work offline?", answer: "Yes, with a small local queue. I'm sketching the sync rules.", model: "claude-sonnet-4-5" },
  { title: "Dark mode receipts", repo: "mobile-app", group: "Mobile", stage: "implementation", ago: 18, ask: "Receipts are unreadable in dark mode", answer: "Receipt colors now come from the theme tokens; checking contrast on every screen.", model: "gpt-5.1" },
  // The Work pane clip's conversation (demo-10).
  { title: "Order totals as currency", repo: "storefront", group: "Storefront", stage: "investigation", ago: 2, ask: "Order totals show up as raw numbers, like 1234.5. Format them as currency.", answer: "I'll add a small formatter and use it on the orders page. Open a terminal and I'll run the tests there, so you can watch.", model: "claude-sonnet-4-5" },
  // The cost clip's conversation (demo-11): it read the API reference, so its context carries more than its prompt.
  { title: "Audit the refunds docs", repo: "payments-api", group: "Payments", stage: "testing", ago: 26, read: "docs/payments.md", ask: "Check that docs/payments.md still matches POST /refunds.", answer: "It drifted: `src/refunds/route.js` refunds `request.body.lines`, while the doc's `POST /refunds` example still sends a single `amount`. I'd fix the example to send `lines`, then run it against the staging endpoint.", model: "claude-sonnet-4-5" },
];

const text = (value: string) => [{ type: "text", text: value }];
const RATES = {
  "claude-sonnet-4-5": { provider: "anthropic", input: 3e-6, output: 15e-6, cacheRead: 0.3e-6 },
  "gpt-5.1": { provider: "openai", input: 1.25e-6, output: 10e-6, cacheRead: 0.125e-6 },
  "gemini-3-pro": { provider: "google", input: 1.25e-6, output: 10e-6, cacheRead: 0.3e-6 },
} as const;
/** The tokens a text costs by the estimate the context meter also uses: a character per 3.5. */
const tokensOf = (value: string) => Math.ceil(value.length / 3.5);
/**
 * What one recorded model call read and wrote, and what it cost at that model's rates. The counters follow what the
 * session's transcript holds, measured the way the context meter measures it, so the meter's split, its Session total
 * and the Usage page's figures all describe the same session. Most of a call's prompt comes from the provider's cache,
 * as a session that keeps asking over the same files does.
 */
const callUsage = (context: number, rate: (typeof RATES)[Seed["model"]]) => {
  const output = Math.max(60, Math.round(context * 0.02)), input = Math.round((context - output) * 0.18), cacheRead = context - output - input;
  const cost = input * rate.input + output * rate.output + cacheRead * rate.cacheRead;
  return { input, output, cacheRead, cacheWrite: 0, totalTokens: context, cost: { input: input * rate.input, output: output * rate.output, cacheRead: cacheRead * rate.cacheRead, cacheWrite: 0, total: cost } };
};
/** The calls a session made, and their sum for its ledger: the prompt and tools it leads with, the question, a file it
 * read if it read one, and the answer it wrote. */
const sessionSpend = (seed: Seed, cwd: string) => {
  const rate = RATES[seed.model];
  const carries = tokensOf(PROMPT) + tokensOf(JSON.stringify(toolDefinitions(cwd))) + tokensOf(seed.ask);
  const calls = [callUsage(carries, rate)];
  if (seed.read) calls.push(callUsage(carries + tokensOf(docs), rate));
  const total = calls.reduce((sum, call) => ({
    ...sum, input: sum.input + call.input, output: sum.output + call.output, cacheRead: sum.cacheRead + call.cacheRead,
    totalTokens: sum.totalTokens + call.totalTokens, cost: { ...sum.cost, total: sum.cost.total + call.cost.total },
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  return { provider: rate.provider, model: seed.model, calls, total };
};
const host = new DurableHost({ dir: join(CONFIG_DIR, "durable"), agentDir, resume: false, lookupCaller: async () => undefined });
host.configureDurableBots(null);
const harness = await host.open();
const sessions: Record<string, unknown>[] = [];
for (const [index, seed] of seeds.entries()) {
  const cwd = join(workspace, seed.repo);
  const at = now - seed.ago * MINUTE;
  // What this session's model read and wrote, which the Usage page reports as its spend.
  const spend = sessionSpend(seed, cwd);
  const last = spend.calls.at(-1)!;
  const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd, model: { provider: "hui-e2e", modelId: "fixture" }, thinkingLevel: "high" }, init: async (tx, id) => {
    await tx.appendEntry(id, systemEntry(cwd, at));
    await tx.appendEntry(id, { kind: UserEntry.kind, model: [{ role: "user", content: text(seed.ask), timestamp: at - 4 * MINUTE }] } as never);
    if (seed.read) {
      // The call that read the file, and its result, so the context carries what the session actually read.
      await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [{ role: "assistant", content: [{ type: "toolCall", id: "call-read", name: "read", arguments: { path: seed.read } }], api: "anthropic-messages", provider: spend.provider, model: spend.model, usage: spend.calls[0], stopReason: "toolUse", timestamp: at - 3 * MINUTE }] } as never);
      await tx.appendEntry(id, { kind: ToolResultEntry.kind, model: [{ role: "toolResult", toolCallId: "call-read", toolName: "read", content: text(docs), isError: false, timestamp: at - 2 * MINUTE }], data: { diagnostics: [] } } as never);
    }
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [{ role: "assistant", content: text(seed.answer), api: "anthropic-messages", provider: spend.provider, model: spend.model, usage: last, stopReason: "stop", timestamp: at }] } as never);
    // The spend ledger HUI reports a Session total from, as an import of real history seeds it: every call above.
    const ledger = await tx.doc(UsageDoc, id);
    ledger.models[`${spend.provider}/${spend.model}`] = spend.total;
  } }, durableContext);
  sessions.push({
    id: `demo-${index + 1}`, title: seed.title, group: seed.group, cwd, tool: "durable", piSessionFile: `durable:${conversation.id}`,
    model: `${spend.provider}/${spend.model}`, createdAt: new Date(at - 4 * MINUTE).toISOString(), updatedAt: new Date(at).toISOString(), source: "hui",
    stage: seed.stage, stageSource: "agent", ...(seed.unread ? { unread: true } : {}),
  });
}
await host.close();

const task = (title: string, repo: string, group: string, problem: string, fix: string) =>
  ({ id: `demo-${repo}-${title.toLowerCase().replace(/\W+/gu, "-")}`, title, problem, fix, cwd: join(workspace, repo), group, createdAt: new Date(now - 2 * 86_400_000).toISOString() });
await mkdir(CONFIG_DIR, { recursive: true });
const groups = [["Storefront", "storefront"], ["Payments", "payments-api"], ["Mobile", "mobile-app"], ["Docs", "docs"]].map(([label, repo]) => ({ label, cwd: join(workspace, repo!) }));
await writeFile(join(CONFIG_DIR, "sessions.json"), JSON.stringify({ version: 2, groups, sessions }));
await writeFile(join(CONFIG_DIR, "backlog.json"), JSON.stringify({ version: 1, jira: {}, tasks: [
  task("Add CSV export to the orders page", "storefront", "Storefront", "Support keeps asking engineers for order exports. The orders page has no way to download what it shows.", "Add an Export CSV button that downloads the visible rows."),
  task("Rotate the Stripe webhook secret", "payments-api", "Payments", "The webhook signing secret has not been rotated since launch.", "Support two secrets during the rotation window."),
  task("Document the release checklist", "docs", "Docs", "Releases depend on one person remembering the steps.", "Write the checklist in docs/releasing.md."),
] }));
await writeFile(join(CONFIG_DIR, "settings.json"), JSON.stringify({
  profileName: "Dana", models: { primary: "hui-e2e/fixture", fallback: "", utility: "hui-e2e/fixture" },
}));
// Acme's Datadog org, read through the fake pup the launcher sets up, for the Datadog card in the chat.
await writeFile(join(CONFIG_DIR, "datadog.json"), JSON.stringify({ version: 1, orgs: [{ name: "acme", site: "app.datadoghq.com" }] }));
// Pull requests the fake GitHub CLI describes, for link cards in the chat.
const pull = (number: number, title: string, body: string, patch: Record<string, unknown> = {}) => ({
  __typename: "PullRequest", number, title, body, state: "OPEN", isDraft: false, author: { login: "dana" }, additions: 86, deletions: 12, changedFiles: 4,
  comments: { totalCount: 3 }, reviewThreads: { totalCount: 2 }, ...patch,
});
await writeFile(join(ghDir, "previews.json"), JSON.stringify({
  "acme/storefront#482": pull(482, "Fix double submit on the signup form", "Disables **Create account** while the request is in flight, so a double click no longer creates two trials.", { state: "MERGED", additions: 41, deletions: 9, changedFiles: 3 }),
  "acme/payments-api#142": pull(142, "Partial refunds endpoint", "Adds `POST /refunds` with per-line refunds and an over-refund guard."),
  "acme/payments-api#148": pull(148, "Partial refunds endpoint", "Adds per-line refunds to `POST /refunds`.", { state: "MERGED" }),
  "acme/payments-api#151": pull(151, "Retry-safe Stripe webhooks", "Stores processed event ids for 7 days, so Stripe's retries are ignored.", { additions: 64, deletions: 7, changedFiles: 3 }),
}));
// VS Code's serve-web downloads its server build into the cli folder; a link keeps it between demo runs.
if (process.env["HUI_DEMO_CACHE"]) {
  await mkdir(join(process.env["HUI_DEMO_CACHE"], "vscode-cli"), { recursive: true });
  await mkdir(join(CONFIG_DIR, "vscode", "serve-web"), { recursive: true });
  await symlink(join(process.env["HUI_DEMO_CACHE"], "vscode-cli"), join(CONFIG_DIR, "vscode", "serve-web", "cli"));
}
process.stdout.write(`Seeded ${sessions.length} demo sessions in ${workspace}.\n`);
