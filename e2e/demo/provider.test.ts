/** The demo model plays its scripts: a prompt starts one, a tool result continues it, and a bot's memory view is not a prompt. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let url = "";
let dir = "";
let provider: ChildProcess;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hui-demo-provider-"));
  provider = spawn(process.execPath, [new URL("./provider.ts", import.meta.url).pathname], {
    env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_PROVIDER_LOG: join(dir, "log.jsonl") }, stdio: ["ignore", "pipe", "inherit"],
  });
  url = await new Promise((done, fail) => {
    provider.once("exit", (code) => fail(new Error(`The demo provider exited (${code}).`)));
    provider.stdout!.on("data", (chunk) => {
      const found = /http:\/\/127\.0\.0\.1:\d+/u.exec(String(chunk));
      if (found) done(found[0]);
    });
  });
});
after(async () => {
  provider.kill();
  await rm(dir, { recursive: true, force: true });
});

/** The streamed reply's tool calls (with their input) and text. */
async function reply(content: unknown) {
  const response = await fetch(`${url}/v1/messages`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content }] }) });
  const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  const inputs = events.filter((event) => event.delta?.type === "input_json_delta").map((event) => JSON.parse(event.delta.partial_json));
  return {
    tools: events.filter((event) => event.content_block?.type === "tool_use").map((event, index) => ({ id: event.content_block.id, name: event.content_block.name, input: inputs[index] })),
    text: events.map((event) => event.delta?.text ?? "").join(""),
  };
}

test("a demo prompt starts its script and the tool result continues it", async () => {
  const first = await reply("Chart this week's build times from ci/build-times.csv");
  assert.equal(first.tools[0]?.name, "bash");
  const second = await reply([{ type: "tool_result", tool_use_id: first.tools[0]!.id, content: "day,branch,median_minutes" }]);
  assert.equal(second.tools[0]?.name, "show_widget");
});

test("a parent waits for the reviewers it spawned", async () => {
  const spawned = await reply("Review PR #142 before we merge: security, performance and test coverage, in parallel");
  assert.deepEqual(spawned.tools.map((tool) => [tool.name, tool.input.collect]), Array(3).fill(["sessions_spawn", true]));
  const waited = await reply(spawned.tools.map((tool, index) => ({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify({ status: "accepted", taskId: `task-${index}` }) })));
  assert.equal(waited.tools[0]?.name, "agents_wait");
  assert.deepEqual(waited.tools[0]?.input.ids.toSorted(), ["task-0", "task-1", "task-2"]);
});

test("a bot's memory view does not start the scripts it mentions", async () => {
  const answer = await reply([{ type: "text", text: "<chat>\nuser: Every weekday at 9, post a digest\n</chat>" }, { type: "text", text: "Thanks!" }]);
  assert.deepEqual(answer.tools, []);
  assert.equal(answer.text, "Done.");
});

test("a bot answers the agent that tagged it at the return address its tag carries", async () => {
  const answer = await reply([{ type: "text", text: "<chat>\nuser: Heads-up\n</chat>" }, { type: "text", text: "[from agent: Apple Pay at checkout · reply-to agent:demo-1] Please add it to Monday's rollout." }]);
  assert.equal(answer.tools[0]?.name, "message_bot");
  assert.equal(answer.tools[0]?.input.to, "agent:demo-1");
});

// The bots clip: a chief opens two storefront sessions, one per brief, and each answers its own brief.
test("a chief's request starts two storefront sessions with a title and a brief each", async () => {
  const answer = await reply("Start the orders CSV export and the flaky checkout test fix");
  assert.deepEqual(answer.tools.map((tool) => [tool.name, tool.input.group, tool.input.title]), [
    ["create_session", "Storefront", "Orders CSV export"],
    ["create_session", "Storefront", "Flaky checkout test"],
  ]);
  const briefs = answer.tools.map((tool) => String(tool.input.prompt));
  assert.match(briefs[0]!, /Add the CSV export button to the orders page/u);
  assert.match(briefs[1]!, /Fix the flaky checkout e2e test/u);
});

test("each session a chief started answers its own brief", async () => {
  const exported = await reply("[from @chief-of-staff-storefront] Add the CSV export button to the orders page. Read src/orders/orders-page.js.");
  assert.deepEqual(exported.tools, []);
  assert.match(exported.text, /toCsv/u);
  const fixed = await reply("[from @chief-of-staff-storefront] Fix the flaky checkout e2e test: it clicks Pay before the totals request settles.");
  assert.deepEqual(fixed.tools, []);
  assert.match(fixed.text, /passed ten runs/u);
});

// The phone clip: the agent opens the checkout at phone size, then reads the page the operator paid on.
test("a checkout prompt opens the page and reads its total", async () => {
  const opened = await reply("Pay for the storefront order on staging");
  assert.equal(opened.tools[0]?.name, "browser");
  assert.equal(opened.tools[0]?.input.action, "open");
  assert.match(String(opened.tools[0]?.input.url), /\/demo\/checkout$/u);
  const resized = await reply([{ type: "tool_result", tool_use_id: opened.tools[0]!.id, content: "Opened http://127.0.0.1:1/demo/checkout" }]);
  assert.deepEqual([resized.tools[0]?.name, resized.tools[0]?.input.action, resized.tools[0]?.input.width, resized.tools[0]?.input.height], ["browser", "resize", 390, 844]);
  const read = await reply([{ type: "tool_result", tool_use_id: resized.tools[0]!.id, content: "The viewport of tab t1 is now 390×844." }]);
  assert.deepEqual([read.tools[0]?.name, read.tools[0]?.input.action, read.tools[0]?.input.selector], ["browser", "text", ".total"]);
  const asked = await reply([{ type: "tool_result", tool_use_id: read.tools[0]!.id, content: "HUI_PAGE_CONTENT nonce=abc\n$240.00\nHUI_PAGE_CONTENT nonce=abc" }]);
  assert.deepEqual(asked.tools, []);
  assert.match(asked.text, /\$240\.00/u, "the total the page really shows");
  assert.match(asked.text, /take control of the page/u, "and the takeover it asks for");
});

test("the payment question answers from the page, and says so when it cannot", async () => {
  const read = await reply("Did the payment go through?");
  assert.deepEqual([read.tools[0]?.name, read.tools[0]?.input.action], ["browser", "text"]);
  const paid = await reply([{ type: "tool_result", tool_use_id: read.tools[0]!.id, content: "HUI_PAGE_CONTENT nonce=abc\nOrder #A-1042\nPayment confirmed. $240.00 charged to the card ending 4242.\nHUI_PAGE_CONTENT nonce=abc" }]);
  assert.match(paid.text, /Payment confirmed\. \$240\.00 charged to the card ending 4242\./u);
  const unpaid = await reply([{ type: "tool_result", tool_use_id: read.tools[0]!.id, content: "HUI_PAGE_CONTENT nonce=abc\nOrder #A-1042\n$240.00\nHUI_PAGE_CONTENT nonce=abc" }]);
  assert.match(unpaid.text, /does not say the payment went through/u);
  assert.doesNotMatch(unpaid.text, /Payment confirmed/u, "a page without the line is never reported as paid");
});

// The bots clip's work queue: nine sessions in one turn, one asking the operator a question and one still running.
test("a bot's chore list starts nine sessions, one of them asking a question and one still running", async () => {
  const answer = await reply("Queue this week's storefront chores and check the refund copy with me");
  assert.equal(answer.tools.length, 9);
  assert.deepEqual(answer.tools.map((tool) => tool.name), Array(9).fill("create_session"));
  const titles = answer.tools.map((tool) => tool.input.title);
  assert.equal(new Set(titles).size, 9, "one brief each, under its own title");
  assert(titles.includes("Refund button copy") && titles.includes("Checkout telemetry audit"));
  const briefs = answer.tools.map((tool) => String(tool.input.prompt));
  assert(briefs.every((brief) => brief.length > 20), "every session carries a real brief");
  const answered = await reply(answer.tools.map((tool) => ({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify({ status: "accepted" }) })));
  assert.deepEqual(answered.tools, []);
  assert.match(answered.text, /^Nine sessions are up/u);
});

test("the queue's two special briefs ask a question and keep working", async () => {
  const asking = await reply("[from @chief-of-staff-storefront] Draft the new refund button copy, and ask me which line you should use.");
  assert.equal(asking.tools[0]?.name, "ask_user_question");
  const questions = asking.tools[0]?.input.questions as { header: string; options: { label: string }[] }[];
  assert.equal(questions[0]?.header, "Refund copy");
  assert.deepEqual(questions[0]?.options.map((option) => option.label), ["Refund order", "Refund this order"]);
  const running = await reply("[from @chief-of-staff-storefront] Audit the checkout telemetry for duplicate add-to-cart events.");
  assert.deepEqual([running.tools[0]?.name, running.tools[0]?.input.command], ["bash", "sleep 600 && echo 'checked the week of events'"]);
});

// The activity trail clip: four real calls in one turn, the last of them failing in the storefront's own checkout.
test("a trail turn reads, searches, runs and fails, and reports what really happened", async () => {
  const first = await reply("Tidy the orders export, check the tests and open the pull request");
  // PI Durable offers read, write, edit and bash: the search is the grep command bash runs, never the grep tool.
  assert.deepEqual(first.tools.map((tool) => [tool.name, tool.input.path ?? tool.input.command]), [
    ["read", "src/orders/orders-page.js"],
    ["bash", "grep -rn 'listOrders' src/"],
  ]);
  const results = first.tools.map((tool) => ({ type: "tool_result", tool_use_id: tool.id, content: "ok" }));
  const second = await reply(results);
  assert.equal(second.tools[0]?.name, "bash");
  assert.match(String(second.tools[0]?.input.command), /github\.com\/acme\/storefront\/pull\/482/u, "the URL the summary's PR chip reads");
  const third = await reply([{ type: "tool_result", tool_use_id: second.tools[0]!.id, content: "41ffac2 Partial refunds endpoint (#148)" }]);
  assert.equal(third.tools[0]?.name, "bash");
  assert.equal(third.tools[0]?.input.command, "node --test test/export-csv.test.js");
  // The failed run is quoted, never reported as a pass: the answer names the missing module it really saw.
  const failed = await reply([{ type: "tool_result", tool_use_id: third.tools[0]!.id, content: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/acme-storefront/src/orders/export-csv.js'", is_error: true }]);
  assert.deepEqual(failed.tools, []);
  assert.match(failed.text, /fails to load/u);
  assert.doesNotMatch(failed.text, /passed/u);
});
