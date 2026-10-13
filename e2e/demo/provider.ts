#!/usr/bin/env node
/**
 * The scripted model behind HUI's demo videos: an Anthropic-compatible
 * provider that plays a fixed script for each demo prompt, streaming text at a
 * readable pace. Like e2e/pi-provider-fixture.mjs it replaces only the model:
 * PI runs every tool call for real. Started by
 * `visual-verification.mjs launch --demo`.
 */
import { appendFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const logFile = process.env["HUI_E2E_PROVIDER_LOG"] || (() => { throw new Error("HUI_E2E_PROVIDER_LOG is required"); })();
let port = Number(process.env["HUI_E2E_PROVIDER_PORT"] ?? 0);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Call = { name: string; input: Record<string, unknown> };
/** One model response: optional thinking, text, then tool calls. Text and calls can depend on the tool results so far, latest first. */
type Turn = { wait?: number; think?: string; say?: string | ((results: string[]) => string); calls?: Call[] | ((results: string[]) => Call[]) };
/** A script starts when the latest user message contains `when`; `title` and `branch` answer HUI's naming prompts. */
type Script = { when: string; title?: string; branch?: string; turns: Turn[] };

const page = (path: string) => `http://127.0.0.1:${port}${path}`;
/** A browser snapshot's ref for an element, from the latest result that has it; a page without it fails the turn. */
function ref(results: string[], pattern: RegExp): string {
  for (const result of results) {
    const found = pattern.exec(result)?.[1];
    if (found) return found;
  }
  throw new Error(`The page has no ${pattern.source}.`);
}

const WIDGET = `<div id="builds">
<style>
#builds{display:grid;gap:14px}
#builds .bar{fill:var(--accent)}#builds .bar.pr{fill:var(--info)}
#builds .bar:hover{opacity:.8}
#builds text{fill:var(--muted);font:12px var(--font-body)}
#builds .value{fill:var(--text-strong);font-weight:600}
#builds .toggle{display:flex;gap:8px}
#builds .toggle button[aria-pressed=true]{background:var(--accent-fill);color:var(--accent-fg);border-color:transparent}
#builds .note{color:var(--muted)}
</style>
<div class="toggle" role="group" aria-label="Branch"><button type="button" aria-pressed="true" data-set="main">main</button><button type="button" aria-pressed="false" data-set="pr">Pull requests</button></div>
<svg viewBox="0 0 560 220" width="100%" style="max-height:200px" role="img" aria-label="Median build minutes per day"></svg>
<div class="note" id="builds-note"></div>
<script>
const data={main:[14.2,13.8,8.9,8.6,8.4],pr:[11.5,11.9,7.2,6.8,6.9]};
const days=["Mon","Tue","Wed","Thu","Fri"];
const svg=document.querySelector("#builds svg"),note=document.getElementById("builds-note");
function draw(set){
  const values=data[set],max=16;
  svg.innerHTML=values.map((v,i)=>{const h=v/max*160,x=30+i*105;return '<rect class="bar '+set+'" x="'+x+'" y="'+(180-h)+'" width="64" height="'+h+'" rx="6"></rect><text class="value" x="'+(x+32)+'" y="'+(172-h)+'" text-anchor="middle">'+v+' min</text><text x="'+(x+32)+'" y="204" text-anchor="middle">'+days[i]+'</text>'}).join("");
  const drop=Math.round((1-values[4]/values[0])*100);
  note.textContent=(set==="main"?"main":"Pull request")+" builds are "+drop+"% faster since Wednesday's cache change.";
  document.querySelectorAll("#builds button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.set===set)));
}
document.querySelectorAll("#builds button").forEach(b=>b.addEventListener("click",()=>draw(b.dataset.set)));
draw("main");
</script>
</div>`;

const SIGNUP_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Acme · Create your account</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,system-ui,sans-serif;background:linear-gradient(160deg,#eef2ff,#f8fafc);color:#0f172a}
main{width:380px;padding:36px;border-radius:16px;background:#fff;box-shadow:0 20px 50px rgb(15 23 42/12%)}
h1{margin:0 0 6px;font-size:26px}p{margin:0 0 22px;color:#64748b}
label{display:block;margin:14px 0 6px;font-weight:600;font-size:14px}
input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font:600 16px system-ui;cursor:pointer}
#result{margin-top:16px;font-weight:600;color:#15803d;min-height:1.5em}
</style></head>
<body><main><h1>Create your account</h1><p>Start your 14-day Acme trial.</p>
<label for="email">Work email</label><input id="email" type="email" placeholder="you@company.com">
<label for="team">Team name</label><input id="team" placeholder="Acme Inc.">
<button id="create">Create account</button><div id="result" role="status"></div></main>
<script>document.getElementById("create").addEventListener("click",()=>{const email=document.getElementById("email").value;document.getElementById("result").textContent=email?"Welcome aboard! We sent a link to "+email+".":"Enter your email."});</script>
</body></html>`;

const scripts: Script[] = [
  // Kanban: a backlog item started in its own worktree, and an agent moving its own card.
  {
    when: "Add CSV export to the orders page",
    title: "Add CSV export to orders",
    branch: "orders-csv-export",
    turns: [
      { wait: 2_500, think: "The orders table lives in src/orders. Let me read it before adding an export.", calls: [{ name: "read", input: { path: "src/orders/orders-page.js" } }] },
      { wait: 1_200, think: "Every row is already in memory, so the export can stay client-side.", calls: [{ name: "write", input: { path: "src/orders/export-csv.js", content: "/** Orders as CSV, one row per order, quoted where needed. */\nexport function toCsv(orders) {\n  const quote = (value) => /[\",\\n]/.test(String(value)) ? `\"${String(value).replaceAll('\"', '\"\"')}\"` : String(value);\n  const header = [\"id\", \"customer\", \"total\", \"status\"];\n  return [header, ...orders.map((order) => header.map((key) => order[key]))].map((row) => row.map(quote).join(\",\")).join(\"\\n\");\n}\n" } }] },
      { wait: 1_200, calls: [{ name: "bash", input: { command: "node --test test/", timeout: 60 } }] },
      { say: "Added **Export CSV** to the orders page:\n\n- `toCsv()` in `src/orders/export-csv.js` quotes commas, quotes and newlines\n- the button downloads the rows on screen\n- `node --test` passes (4 tests)" },
    ],
  },
  {
    when: "CI passed on Apple Pay",
    turns: [
      { wait: 600, think: "CI is green, so this is ready for review.", calls: [{ name: "bash", input: { command: "git log --oneline -1", timeout: 30 } }] },
      { wait: 500, calls: [{ name: "set_stage", input: { stage: "testing" } }] },
      { say: "Apple Pay is ready for review, so I moved this card to **Testing**." },
    ],
  },
  // Integrations: an interactive widget from real data.
  {
    when: "Chart this week's build times",
    title: "Chart this week's build times",
    turns: [
      { wait: 500, think: "The CI export is in ci/build-times.csv. I'll summarize it per day.", calls: [{ name: "bash", input: { command: "column -s, -t < ci/build-times.csv", timeout: 30 } }] },
      { wait: 500, calls: [{ name: "show_widget", input: { title: "Median build time this week", widget_code: WIDGET } }] },
      { say: "Builds dropped from **14 to 8 minutes** after Wednesday's dependency cache landed, on `main` and on pull requests alike. Toggle the series above to compare." },
    ],
  },
  // Integrations: the managed browser, with the live preview in the chat.
  {
    when: "Check that signup still works",
    title: "Check signup on staging",
    turns: [
      { wait: 700, think: "I'll open the staging signup page in HUI's browser and go through the form.", calls: () => [{ name: "browser", input: { action: "open", url: page("/demo/signup") } }] },
      { wait: 1_200, calls: (results) => [{ name: "browser", input: { action: "act", kind: "type", ref: ref(results, /textbox "Work email" \[ref=(e\d+)\]/u), text: "dana@acme.dev" } }] },
      { wait: 1_000, calls: (results) => [{ name: "browser", input: { action: "act", kind: "type", ref: ref(results, /textbox "Team name" \[ref=(e\d+)\]/u), text: "Acme Labs" } }] },
      { wait: 1_000, calls: (results) => [{ name: "browser", input: { action: "act", kind: "click", ref: ref(results, /button "Create account" \[ref=(e\d+)\]/u) } }] },
      { wait: 900, calls: [{ name: "browser", input: { action: "text", selector: "#result" } }] },
      { say: (results) => results[0]?.includes("Welcome aboard! We sent a link to dana@acme.dev")
        ? "Signup works on staging: the form accepted **dana@acme.dev** and showed *Welcome aboard! We sent a link to dana@acme.dev.* That's the fix for the report in #support, which shipped here:\n\nhttps://github.com/acme/storefront/pull/482\n\nhttps://acme.slack.com/archives/C05SIGNUP/p1760351234567890"
        : `Signup is broken on staging; the page said: ${results[0] ?? "nothing"}` },
    ],
  },
  // Subagents: three reviewers in parallel (children first: their tasks name the PR too), and a watcher.
  {
    when: "Security review of PR #142",
    turns: [
      { wait: 1_200, think: "Start with who can call the endpoint.", calls: [{ name: "read", input: { path: "src/refunds/route.js" } }] },
      { wait: 2_000, calls: [{ name: "bash", input: { command: "grep -rn 'customerId' src/", timeout: 30 } }] },
      { wait: 2_400, say: "1 blocking issue: `POST /refunds` never checks that the order belongs to the caller, so any signed-in user can refund any order. Add an ownership check before `issueRefund()`." },
    ],
  },
  {
    when: "Performance review of PR #142",
    turns: [
      { wait: 900, calls: [{ name: "bash", input: { command: "grep -n 'await' src/refunds/route.js", timeout: 30 } }] },
      { wait: 2_200, say: "No blockers. The refund loop awaits one query per line item; batching them saves about 40 ms on large orders. Worth a follow-up." },
    ],
  },
  {
    when: "Test coverage review of PR #142",
    turns: [
      { wait: 1_000, calls: [{ name: "bash", input: { command: "ls test/", timeout: 30 } }] },
      { wait: 2_200, calls: [{ name: "read", input: { path: "test/refunds.test.js" } }] },
      { wait: 3_400, say: "Coverage is good for full refunds, but partial refunds and the over-refund guard have no tests. Two cases would cover them." },
    ],
  },
  {
    when: "Review PR #142",
    title: "Review PR #142 in parallel",
    turns: [
      { wait: 600, think: "Three independent angles: run them as parallel subagents so they don't block each other.", say: "I'll split the review into three parallel reviewers.", calls: [
        { name: "sessions_spawn", input: { label: "Security review", task: "Security review of PR #142 (refund endpoint): auth checks, input validation, secrets." } },
        { name: "sessions_spawn", input: { label: "Performance review", task: "Performance review of PR #142 (refund endpoint): queries, N+1s, hot paths." } },
        { name: "sessions_spawn", input: { label: "Test coverage review", task: "Test coverage review of PR #142 (refund endpoint): missing cases and flaky tests." } },
      ] },
      { say: "Three reviewers are running in the background. I'll combine their findings as they report back." },
    ],
  },
  {
    when: "Fix the ownership check",
    title: "Review PR #142 in parallel",
    turns: [
      { wait: 600, calls: [{ name: "edit", input: { path: "src/refunds/route.js", edits: [{ oldText: "  const order = await orders.get(request.body.orderId);\n", newText: "  const order = await orders.get(request.body.orderId);\n  if (order.customerId !== request.user.id) return response.status(404).end();\n" }] } }] },
      { wait: 500, calls: [{ name: "watcher", input: {
        action: "start", purpose: "Merge #142 when CI is green", target: "https://github.com/acme/payments-api/pull/142", outcome: "merge #142",
        command: "for job in lint unit-tests integration e2e; do sleep 1.5; echo \"✓ $job passed\"; done; echo 'CI green, merged #142'",
      } }] },
      { say: "Pushed the ownership check. A watcher is waiting for CI and will merge **#142** as soon as it's green; you can close this tab." },
    ],
  },
  // Bots: a remembered note, a routine the bot schedules itself, and its run.
  {
    when: "Heads-up: refunds roll out",
    turns: [{ wait: 300, say: "Noted: refunds go to 10% of stores on Monday, and Priya owns the rollback." }],
  },
  {
    when: "Every weekday at 9",
    turns: [
      { wait: 700, think: "A cron routine on weekdays at 9:00 that posts the digest here.", calls: [{ name: "routines", input: { action: "add", name: "Morning digest", cron: "0 9 * * 1-5", prompt: "Post a short digest of open pull requests and today's rollouts." } }] },
      { say: "Done. Morning digest runs every weekday at 9:00, right here in our chat." },
    ],
  },
  {
    when: "[routine: Morning digest]",
    turns: [{ wait: 900, say: "Good morning! Today's digest:\n\n- Refunds go to 10% of stores today; Priya owns the rollback.\n- #142 Partial refunds endpoint is merged and CI is green.\n- #482 Signup double-submit fix is live on staging.\n\nNothing is blocked." }],
  },
];

function subagentSummary(source: string): string {
  const done = [...source.matchAll(/^title: (.+)$/gmu)].map((match) => match[1]!.trim());
  const all = ["Security review", "Performance review", "Test coverage review"];
  completed.push(...done);
  if (!all.every((label) => completed.includes(label))) return `${done.join(" and ")} reported back; waiting on the rest.`;
  return "All three reviews are in:\n\n| Review | Verdict |\n| --- | --- |\n| Security | **Blocking:** missing ownership check on `POST /refunds` |\n| Performance | OK, batch the line-item queries later |\n| Tests | Add partial and over-refund cases |\n\nI'd fix the ownership check before merging.";
}
const completed: string[] = [];

// Anthropic Messages streaming.
const sse = (response: ServerResponse, value: Record<string, unknown>) => response.write(`event: ${value["type"]}\ndata: ${JSON.stringify(value)}\n\n`);
async function stream(response: ServerResponse, index: number, kind: "text" | "thinking", value: string, pace: number) {
  sse(response, { type: "content_block_start", index, content_block: kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" } });
  for (const piece of pace ? value.match(/\S+\s*|\s+/gu) ?? [] : [value]) {
    sse(response, { type: "content_block_delta", index, delta: kind === "text" ? { type: "text_delta", text: piece } : { type: "thinking_delta", thinking: piece } });
    await sleep(pace);
  }
  if (kind === "thinking") sse(response, { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "demo" } });
  sse(response, { type: "content_block_stop", index });
}
async function respond(response: ServerResponse, turn: Turn, id: string, results: string[], pace = 28) {
  const calls = typeof turn.calls === "function" ? turn.calls(results) : turn.calls ?? [];
  const say = typeof turn.say === "function" ? turn.say(results) : turn.say;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  sse(response, { type: "message_start", message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model: "demo", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 18_000 + Math.round(results.join("").length / 4), output_tokens: 0 } } });
  await sleep(turn.wait ?? 0);
  let index = 0;
  if (turn.think) await stream(response, index++, "thinking", turn.think, pace && 18);
  if (say) await stream(response, index++, "text", say, pace);
  for (const [number, call] of calls.entries()) {
    sse(response, { type: "content_block_start", index, content_block: { type: "tool_use", id: `${id}_${number}`, name: call.name, input: {} } });
    sse(response, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) } });
    sse(response, { type: "content_block_stop", index: index++ });
  }
  // Plausible token counts, since HUI shows them under each reply.
  const tokens = Math.round(((turn.think ?? "").length + (say ?? "").length + JSON.stringify(calls).length) / 3.6) + 24;
  sse(response, { type: "message_delta", delta: { stop_reason: calls.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: tokens } });
  sse(response, { type: "message_stop" });
  response.end();
}
async function plain(response: ServerResponse, value: string) {
  await respond(response, { say: value }, "demo_utility", [], 0);
}

type Block = { type?: string; text?: string; tool_use_id?: string; content?: unknown };
type Message = { role?: string; content?: string | Block[] };
const blocks = (message: Message | undefined): Block[] => Array.isArray(message?.content) ? message.content : [{ type: "text", text: String(message?.content ?? "") }];
const textOf = (block: Block) => typeof block.content === "string" ? block.content : Array.isArray(block.content) ? block.content.map((item: Block) => item.text ?? "").join("") : block.text ?? "";

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") return response.end(JSON.stringify({ ok: true }));
  if (request.method === "GET" && url.pathname === "/demo/signup") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end(SIGNUP_PAGE);
  }
  if (request.method !== "POST" || url.pathname !== "/v1/messages") {
    response.writeHead(404);
    return response.end();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { system?: unknown; messages?: Message[] };
  const messages = body.messages ?? [];
  // A bot's turn opens with its memory's view, <chat>…</chat>; scripts answer what follows it.
  const all = blocks(messages.at(-1));
  const view = all[0]?.text?.startsWith("<chat>\n") ? all.findIndex((block) => block.text?.endsWith("\n</chat>")) : -1;
  const last = all.slice(view + 1);
  const source = last.map(textOf).join("\n");
  await appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), last: source.slice(0, 400) })}\n`);

  // OptChat's compactor: one line per long message ("<kind>: <text>"), or two lines merged into one.
  if (JSON.stringify(body.system ?? "").includes("You write the memory of")) {
    const input = source.split("\n").slice(4).join(" ").trim();
    const short = (text: string) => text.length > 140 ? `${text.slice(0, 139)}…` : text;
    return plain(response, source.includes("\nCompress this message into one line") ? short(input) : short(input.replace(/\s+/gu, " ")));
  }
  // HUI's naming prompts quote the first message or task.
  const named = scripts.find((script) => source.includes(script.when));
  if (source.includes("Name this coding-agent session and its Git branch")) return plain(response, `Title: ${named?.title ?? "Demo session"}\nBranch: ${named?.branch ?? "demo-change"}`);
  if (source.includes("Generate a concise session title")) return plain(response, named?.title ?? "Demo session");
  if (source.includes("Name the Git branch")) return plain(response, named?.branch ?? "demo-change");

  // A tool result continues the script that called it: ids are demo_<script>_<turn>_<call>.
  const resumed = last.map((block) => /^demo_(\d+)_(\d+)_\d+$/u.exec(block.tool_use_id ?? "")).find(Boolean);
  if (resumed) {
    const [scriptIndex, turnIndex] = [Number(resumed[1]), Number(resumed[2]) + 1];
    const turn = scripts[scriptIndex]?.turns[turnIndex] ?? { say: "Done." };
    const results = messages.flatMap(blocks).filter((block) => block.type === "tool_result").map(textOf).reverse();
    return respond(response, turn, `demo_${scriptIndex}_${turnIndex}`, results);
  }
  if (source.includes("[HUI subagent completion event]")) return respond(response, { wait: 400, say: subagentSummary(source) }, "demo_events", []);
  const index = named ? scripts.indexOf(named) : -1;
  if (index === -1) return plain(response, "Done.");
  return respond(response, named!.turns[0]!, `demo_${index}_0`, []);
}

// A script that cannot go on (a page without the element it expects) fails the run loudly instead of faking success.
const server = createServer((request, response) => void handle(request, response).catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
  response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `demo script: ${error.message}` } }));
}));
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  port = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`HUI demo provider: http://127.0.0.1:${port}\n`);
});
