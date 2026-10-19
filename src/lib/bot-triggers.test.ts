import assert from "node:assert/strict";
import { test } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { BotTriggerCreated, BotTriggersList } from "../../shared/bot-triggers.ts";
import type { BotView } from "../../shared/bots.ts";
import { BotTriggersController, parseTrigger, parseTriggersList, TriggerFormError, triggerFormInput, type BotTriggersApi, type TriggerFormFields } from "./bot-triggers.ts";

const FIELDS: TriggerFormFields = { name: "Reviews", prompt: "  Review it.  ", cooldown: "300", matchField: "", matchOp: "equals", matchValue: "", prLinks: false, external: false, bots: false };

test("the add form becomes a listener trigger's body", () => {
  assert.deepEqual(triggerFormInput(FIELDS), { name: "Reviews", source: "listener", prompt: "Review it.", cooldownSeconds: 300, filter: {} });
  assert.equal(triggerFormInput({ ...FIELDS, steer: true }).delivery, "steer");
  assert.deepEqual(triggerFormInput({ ...FIELDS, prompt: "", cooldown: "0", matchField: " fields.channel ", matchValue: " G01M4T1JFLK ", prLinks: true, bots: true }),
    { name: "Reviews", source: "listener", cooldownSeconds: 0, filter: { match: { field: "fields.channel", op: "equals", value: "G01M4T1JFLK" }, prLinks: true, bots: true } });
  assert.deepEqual(triggerFormInput({ ...FIELDS, matchField: "summary", matchOp: "contains", matchValue: "review", external: true }).filter, { match: { field: "summary", op: "contains", value: "review" }, external: true });
  assert.deepEqual(triggerFormInput({ ...FIELDS, matchField: "fields.channel", matchValue: "  " }).filter, {}, "a field without a value matches nothing in particular");
  for (const [change, message] of [[{ name: " " }, /Name the trigger/u], [{ name: "a [b]" }, /can't hold/u]] as const) {
    assert.throws(() => triggerFormInput({ ...FIELDS, ...change }), (error: unknown) => error instanceof TriggerFormError && message.test(error.message));
  }
});

const TRIGGER = {
  id: "t1", botId: "id-ada", name: "Reviews", source: "listener", filter: { match: { field: "fields.channel", op: "equals", value: "C0" }, prLinks: true, external: "yes" },
  enabled: true, cooldownSeconds: 300, createdBy: "bot", createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z", tokenHint: "AbCd",
  pending: { events: 2, until: "2026-10-07T10:05:00.000Z" }, watch: { polledAt: "2026-10-07T10:01:00.000Z" },
};

test("the routes' answers are narrowed: unknown sources, bad entries and missing fields don't reach the view", () => {
  const parsed = parseTrigger(TRIGGER);
  assert.deepEqual(parsed?.filter, { match: { field: "fields.channel", op: "equals", value: "C0" }, prLinks: true }, "a switch that isn't true is left out");
  assert.deepEqual([parsed?.createdBy, parsed?.tokenHint, parsed?.pending], ["bot", "AbCd", { events: 2, until: "2026-10-07T10:05:00.000Z" }]);
  assert.equal(parseTrigger({ ...TRIGGER, delivery: "steer" })?.delivery, "steer");
  assert.equal(parseTrigger({ ...TRIGGER, source: "github" }), undefined, "a kind HUI no longer has");
  assert.deepEqual(parseTrigger({ ...TRIGGER, filter: { match: { field: "a", op: "regex", value: "x" } } })?.filter, {}, "a match it can't read is left out");
  assert.deepEqual(parseTrigger({ ...TRIGGER, filter: undefined })?.filter, {});
  const list = parseTriggersList({ triggers: [TRIGGER, { id: "broken" }], runs: [{ id: "r", triggerId: "t1", triggerName: "Reviews", at: "2026-10-07T10:00:00Z", status: "coalesced", events: 3, summary: "3 events", catchUp: true }, { id: "x", status: "exploded" }], deliveries: { lastHour: 2, perHour: 12 } });
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
      return { trigger: { ...parseTrigger(TRIGGER)!, id: "t2", name: input.name, filter: {} }, hook: { token: "tok".repeat(14) + "x", path: `/__hui/hooks/${"tok".repeat(14)}x` } } satisfies BotTriggerCreated;
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

test("the section reads the bot's triggers, adds one and shows its URL once, and every change reads them again", async () => {
  const fake = api();
  const controller = new BotTriggersController(host(), { api: fake });
  await controller.refresh(BOT);
  assert.equal(controller.props(BOT).state.list?.triggers.length, 1);
  const created = await controller.props(BOT).onCreate({ name: "Pings", source: "listener", filter: {} });
  assert.equal(created, true);
  const revealed = controller.state.revealed;
  assert.equal(revealed?.url, `http://gateway.test/__hui/hooks/${"tok".repeat(14)}x`, "the page's origin and the path");
  assert.deepEqual([revealed?.name, revealed?.copied], ["Pings", false], "shown before the list is read again");
  controller.props(BOT).onCopy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.revealed?.copied, true);
  controller.props(BOT).onToggle(controller.state.list!.triggers[0]!, false);
  await new Promise((resolve) => setImmediate(resolve));
  controller.props(BOT).onDismissUrl();
  assert.equal(controller.state.revealed, undefined);
  assert.deepEqual(fake.calls, ["list id-ada", "create id-ada Pings", "list id-ada", `copy http://gateway.test/__hui/hooks/${"tok".repeat(14)}x`, "update id-ada t1 {\"enabled\":false}", "list id-ada"]);
  controller.reset("id-bob");
  assert.equal(controller.state.revealed, undefined, "another bot shows nothing of the last one");
  assert.equal(controller.props(BOT).state.loading, true);
});

test("a refused create keeps the form's input and says why; a refused action shows above the list", async () => {
  const controller = new BotTriggersController(host(), { api: api({
    create: async () => { throw new Error("@ada already has a trigger named Deploys."); },
    remove: async () => { throw new Error("The gateway is gone."); },
  }) });
  await controller.refresh(BOT);
  assert.equal(await controller.props(BOT).onCreate({ name: "Deploys", source: "listener", filter: {} }), false);
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
