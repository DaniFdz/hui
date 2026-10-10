import assert from "node:assert/strict";
import test from "node:test";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { BotTrigger, BotTriggerCreated, BotTriggersList } from "../../shared/bot-triggers.ts";
import type { BotView } from "../../shared/bots.ts";
import { BotTriggersController, parseTrigger, parseTriggersList, REVIEW_REQUESTS_PRESET, splitEntries, TriggerFormError, triggerFormInput, type BotTriggersApi, type TriggerFormFields } from "./bot-triggers.ts";

const FIELDS: TriggerFormFields = {
  name: "PR watch", source: "github", prompt: "  Review it.  ", cooldown: "300", repos: "https://github.com/acme/widgets.git, acme/gadgets", githubEvents: ["pr_opened", "checks_failed", "bogus"],
  authors: "@alice bob", labels: "needs review, ci", base: "main", pulls: "#12, 14", draft: "ready", sessionEvents: [], matchField: "", matchOp: "equals", matchValue: "",
  slackEvents: [], slackPrLinks: false, slackFrom: "", slackIn: "", slackExternal: false, slackBots: false,
  listenerField: "", listenerOp: "equals", listenerValue: "", listenerPrLinks: false, listenerExternal: false, listenerBots: false,
};

test("the add form becomes a trigger body, each source with its own fields", () => {
  assert.deepEqual(triggerFormInput(FIELDS), {
    name: "PR watch", prompt: "Review it.", cooldownSeconds: 300, source: "github",
    filter: { repos: ["acme/widgets", "acme/gadgets"], events: ["pr_opened", "checks_failed"], authors: ["alice", "bob"], labels: ["needs review", "ci"], base: ["main"], pullRequests: [12, 14], draft: false },
  });
  assert.deepEqual(triggerFormInput({ ...FIELDS, source: "session", sessionEvents: ["failed", "waiting"], prompt: "", cooldown: "0" }), { name: "PR watch", cooldownSeconds: 0, source: "session", filter: { events: ["failed", "waiting"] } });
  assert.deepEqual(triggerFormInput({ ...FIELDS, source: "webhook", prompt: "" }), { name: "PR watch", cooldownSeconds: 300, source: "webhook", filter: {} });
  assert.deepEqual(triggerFormInput({ ...FIELDS, source: "webhook", prompt: "", matchField: " deploy.status ", matchOp: "contains", matchValue: "fail" }).filter, { match: { field: "deploy.status", op: "contains", value: "fail" } });
  assert.deepEqual(triggerFormInput({ ...FIELDS, source: "listener", prompt: "", matchField: "ignored", matchValue: "the webhook's" }), { name: "PR watch", cooldownSeconds: 300, source: "listener", filter: {} });
  assert.deepEqual(triggerFormInput({ ...FIELDS, source: "listener", listenerField: " fields.channel ", listenerValue: " G01M4T1JFLK ", listenerPrLinks: true, listenerBots: true }).filter,
    { match: { field: "fields.channel", op: "equals", value: "G01M4T1JFLK" }, prLinks: true, bots: true });
  for (const [change, message] of [
    [{ name: " " }, /Name the trigger/u],
    [{ name: "a [b]" }, /can't hold/u],
    [{ repos: "" }, /at least one repo/u],
    [{ repos: "not-a-repo" }, /not-a-repo is not a repo/u],
    [{ githubEvents: [] }, /at least one GitHub event/u],
    [{ pulls: "twelve" }, /Pull requests are numbers/u],
    [{ source: "session", sessionEvents: [] }, /at least one session event/u],
    [{ source: "carrier-pigeon" }, /Choose what the trigger watches/u],
  ] as const) {
    assert.throws(() => triggerFormInput({ ...FIELDS, ...change }), (error: unknown) => error instanceof TriggerFormError && message.test(error.message));
  }
  assert.deepEqual(splitEntries(" a, b  c,,"), ["a", "b", "c"]);
});

const TRIGGER = {
  id: "t1", botId: "id-ada", name: "PR watch", source: "github", filter: { repos: ["acme/widgets"], events: ["pr_opened", "nonsense"], draft: true },
  enabled: true, cooldownSeconds: 300, createdBy: "bot", createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z",
  pending: { events: 2, until: "2026-10-07T10:05:00.000Z" }, watch: { polledAt: "2026-10-07T10:01:00.000Z" },
};

test("the Slack part of the form: mentions and DMs, PR links only, people and channels, and the Review requests preset", () => {
  const slack = { ...FIELDS, source: "slack", prompt: "", slackEvents: ["mention", "dm", "bogus"], slackPrLinks: true, slackFrom: "maria, @Bob Builder", slackIn: "#team-reviews C0123ABCD", slackExternal: false, slackBots: true };
  assert.deepEqual(triggerFormInput(slack), {
    name: "PR watch", cooldownSeconds: 300, source: "slack",
    filter: { events: ["mention", "dm"], prLinks: true, from: ["maria", "Bob Builder"], in: ["team-reviews", "C0123ABCD"], bots: true },
  });
  assert.throws(() => triggerFormInput({ ...slack, slackEvents: [] }), (error: unknown) => error instanceof TriggerFormError && /mentions, direct messages or both/u.test(error.message));
  assert.deepEqual([REVIEW_REQUESTS_PRESET.name, REVIEW_REQUESTS_PRESET.events, REVIEW_REQUESTS_PRESET.prLinks], ["Reviews", ["mention", "dm"], true]);
  assert.match(REVIEW_REQUESTS_PRESET.prompt, /Don't run commands or change anything/u);
  const parsed = parseTrigger({ ...TRIGGER, source: "slack", filter: { events: ["mention", "reaction"], prLinks: true, from: ["maria", 3], external: true } });
  assert.deepEqual(parsed?.source === "slack" && parsed.filter, { events: ["mention"], prLinks: true, from: ["maria"], external: true });
  assert.equal(parseTrigger({ ...TRIGGER, source: "slack", filter: { events: ["reaction"] } }), undefined);
  const listener = parseTrigger({ ...TRIGGER, source: "listener", filter: { match: { field: "fields.channel", op: "equals", value: "C0" }, prLinks: true, external: "yes" }, tokenHint: "AbCd" });
  assert.deepEqual(listener?.source === "listener" && [listener.filter, listener.tokenHint], [{ match: { field: "fields.channel", op: "equals", value: "C0" }, prLinks: true }, "AbCd"]);
});

test("the routes' answers are narrowed: unknown events, bad entries and missing fields don't reach the view", () => {
  const parsed = parseTrigger(TRIGGER);
  assert.deepEqual(parsed?.source === "github" && parsed.filter, { repos: ["acme/widgets"], events: ["pr_opened"], draft: true });
  assert.equal(parsed?.createdBy, "bot");
  assert.deepEqual(parsed?.pending, { events: 2, until: "2026-10-07T10:05:00.000Z" });
  assert.equal(parseTrigger({ ...TRIGGER, source: "fax" }), undefined);
  assert.equal(parseTrigger({ ...TRIGGER, filter: { repos: [], events: ["pr_opened"] } }), undefined);
  assert.deepEqual(parseTrigger({ ...TRIGGER, source: "webhook", filter: { match: { field: "a", op: "regex", value: "x" } } })?.filter, {}, "a match it can't read is left out");
  assert.deepEqual(parseTrigger({ ...TRIGGER, source: "webhook", filter: { match: { field: "a", op: "contains", value: "x" } } })?.filter, { match: { field: "a", op: "contains", value: "x" } });
  const list = parseTriggersList({ triggers: [TRIGGER, { id: "broken" }], runs: [{ id: "r", triggerId: "t1", triggerName: "PR watch", at: "2026-10-07T10:00:00Z", status: "coalesced", events: 3, summary: "3 events", catchUp: true }, { id: "x", status: "exploded" }], deliveries: { lastHour: 2, perHour: 12 } });
  assert.equal(list.triggers.length, 1);
  assert.deepEqual(list.runs.map((run) => [run.status, run.events, run.catchUp]), [["coalesced", 3, true]]);
  assert.deepEqual(list.deliveries, { lastHour: 2, perHour: 12 });
  assert.throws(() => parseTriggersList({}), /did not come back/u);
});

function host(): ReactiveControllerHost & { updates: number } {
  const controllers: ReactiveController[] = [];
  return {
    updates: 0,
    addController: (controller) => { controllers.push(controller); },
    removeController: () => {},
    requestUpdate() { this.updates += 1; },
    updateComplete: Promise.resolve(true),
  };
}

const BOT = { id: "id-ada", name: "Ada", handle: "ada" } as BotView;

function api(overrides: Partial<BotTriggersApi> = {}): BotTriggersApi & { calls: string[] } {
  const calls: string[] = [];
  const list: BotTriggersList = { triggers: [parseTrigger(TRIGGER)!], runs: [], deliveries: { lastHour: 0, perHour: 12 } };
  return {
    calls,
    list: async (botId) => { calls.push(`list ${botId}`); return list; },
    create: async (botId, input) => {
      calls.push(`create ${botId} ${input.name}`);
      return { trigger: { ...parseTrigger(TRIGGER)!, id: "t2", name: input.name, source: "webhook", filter: {} } as BotTrigger, hook: { token: "tok".repeat(14) + "x", path: `/__hui/hooks/${"tok".repeat(14)}x` } } satisfies BotTriggerCreated;
    },
    update: async (botId, triggerId, patch) => { calls.push(`update ${botId} ${triggerId} ${JSON.stringify(patch)}`); return parseTrigger(TRIGGER)!; },
    remove: async (botId, triggerId) => { calls.push(`remove ${botId} ${triggerId}`); },
    test: async (botId, triggerId) => { calls.push(`test ${botId} ${triggerId}`); return { id: "r", triggerId, triggerName: "PR watch", at: "t", status: "fired", events: 1, summary: "s", test: true }; },
    rotate: async (botId, triggerId) => { calls.push(`rotate ${botId} ${triggerId}`); return { trigger: parseTrigger(TRIGGER)!, hook: { token: "new", path: "/__hui/hooks/new" } }; },
    copy: async (text) => { calls.push(`copy ${text}`); return true; },
    origin: () => "http://gateway.test",
    ...overrides,
  };
}

test("the section reads the bot's triggers, adds one and shows its webhook URL once, and every change reads them again", async () => {
  const fake = api();
  const controller = new BotTriggersController(host(), { api: fake });
  await controller.refresh(BOT);
  assert.equal(controller.props(BOT).state.list?.triggers.length, 1);
  const created = await controller.props(BOT).onCreate({ name: "Deploys", source: "webhook", filter: {} });
  assert.equal(created, true);
  const revealed = controller.state.revealed;
  assert.equal(revealed?.url, `http://gateway.test/__hui/hooks/${"tok".repeat(14)}x`, "the page's origin and the path");
  assert.deepEqual([revealed?.source, revealed?.copied], ["webhook", false]);
  controller.props(BOT).onCopy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.revealed?.copied, true);
  controller.props(BOT).onToggle(controller.state.list!.triggers[0]!, false);
  await new Promise((resolve) => setImmediate(resolve));
  controller.props(BOT).onDismissUrl();
  assert.equal(controller.state.revealed, undefined);
  assert.deepEqual(fake.calls, ["list id-ada", "create id-ada Deploys", "list id-ada", `copy http://gateway.test/__hui/hooks/${"tok".repeat(14)}x`, "update id-ada t1 {\"enabled\":false}", "list id-ada"]);
  controller.reset("id-bob");
  assert.equal(controller.state.revealed, undefined, "another bot shows nothing of the last one");
  assert.equal(controller.props(BOT).state.loading, true);
});

test("a new listener's URL is shown as a listener's, before the list is read again", async () => {
  const controller = new BotTriggersController(host(), { api: api({
    create: async (_botId, input) => ({ trigger: { ...parseTrigger(TRIGGER)!, id: "t3", name: input.name, source: "listener", filter: {} } as BotTrigger, hook: { token: "lis".repeat(14) + "x", path: `/__hui/hooks/${"lis".repeat(14)}x` } }),
  }) });
  await controller.refresh(BOT);
  assert.equal(await controller.props(BOT).onCreate({ name: "Pings", source: "listener", filter: {} }), true);
  assert.deepEqual([controller.state.revealed?.name, controller.state.revealed?.source], ["Pings", "listener"]);
});

test("a refused create keeps the form's input and says why; a refused action shows above the list", async () => {
  const controller = new BotTriggersController(host(), { api: api({
    create: async () => { throw new Error("@ada already has a trigger named Deploys."); },
    remove: async () => { throw new Error("The gateway is gone."); },
  }) });
  await controller.refresh(BOT);
  assert.equal(await controller.props(BOT).onCreate({ name: "Deploys", source: "webhook", filter: {} }), false);
  assert.equal(controller.state.formError, "@ada already has a trigger named Deploys.");
  controller.props(BOT).onDelete(controller.state.list!.triggers[0]!);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.actionError, "The gateway is gone.");
  assert.equal(controller.state.pending, false);
});

test("a test says how its run went", async () => {
  const controller = new BotTriggersController(host(), { api: api() });
  await controller.refresh(BOT);
  controller.props(BOT).onTest(controller.state.list!.triggers[0]!);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(controller.state.notice, "Sent a test event to Ada's chat.");
});

test("following the bots stream starts reading once the bot is known, and reads again when its chat changes state", async () => {
  const fake = api();
  const controller = new BotTriggersController(host(), { api: fake });
  controller.follow({ ...BOT, status: "idle" });
  await new Promise((resolve) => setImmediate(resolve));
  controller.follow({ ...BOT, status: "idle" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.calls, ["list id-ada"], "the same state reads nothing");
  controller.follow({ ...BOT, status: "running" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.calls, ["list id-ada", "list id-ada"], "a trigger may just have woken it");
  controller.sync(undefined);
});

test("polling runs only while the section shows", async () => {
  let visible = true;
  const fake = api();
  const controller = new BotTriggersController(host(), { api: fake, visible: () => visible });
  controller.sync(BOT);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.calls, ["list id-ada"], "read at once");
  visible = false;
  controller.sync(undefined);
  controller.sync(undefined);
  assert.deepEqual(fake.calls, ["list id-ada"]);
});
