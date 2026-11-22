/** Run status's dot-only live-work mark: stable active-set animation with or without a plan, reduced motion,
 * live helper detail and fixed header controls (AGENT-075). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

const call = (name: string, input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const calls = (...list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;
/** A child whose task holds a tool call, so it stays active until the test releases the fixture. */
const HELD_TASK = `E2E_HOLD:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "waiting" } })).toString("base64url")}`;
const helper = (label: string) => ({ name: "sessions_spawn", input: { task: HELD_TASK, label, collect: true } });
const TRIGGER = ".chat-run-status__trigger";
const BADGE = `${TRIGGER} .chat-run-status__activity-dot`;
const PING = `${BADGE} .chat-run-status__activity-ping`;
const HEAD_BADGE = ".chat-run-status__head .chat-run-status__activity-dot";
const HEAD_PING = `${HEAD_BADGE} .chat-run-status__activity-ping`;
const controls = [".bot-call-toggle", ".bot-panel-toggle", ".bot-header-menu__trigger", "[aria-label='Continue without a prompt']", ".chat-pane__close-pane", ".chat-pane__nav-toggle"];

async function utility(hui: Hui, enabled = true) {
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: enabled ? "hui-e2e/fixture" : "" } });
}

test("side work pings once per active set, not per streamed frame, and respects reduced motion", { tags: ["AGENT-075"], platforms: ["web"] }, async ({ screen, hui }) => {
  await utility(hui, false);
  await hui.reducedMotion("no-preference");
  const session = await hui.createSession({ title: "Side work" });
  await hui.open(`/sessions/${session.id}`);
  const trigger = screen.getByTestId("run-status-trigger");
  const panel = screen.getByLabel("Run status");
  const send = async (text: string) => {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message", { visible: true }).tap();
  };
  // With no utility model there is no Plan. Live work must still draw the dot and its helper detail.
  await send(call("sessions_spawn", helper("First side task").input));
  await hui.provider.held();
  await expect(trigger).toHaveAccessibleName(/1 of 1 helpers active/u);
  await expect.poll(() => hui.drawn(BADGE)).toBe(true);
  await expect.poll(() => hui.contentOf(BADGE)).toBe("");
  await expect.poll(() => hui.contentOf(`${TRIGGER} .chat-run-status__count`)).toBe("· 1 helper");
  await expect.poll(async () => (await hui.selectorAnimation(PING))?.startTime).not.toBeNull();
  const first = await hui.selectorAnimation(PING);
  expect(first?.animationName).toBe("chat-run-status-ping");
  expect(first?.count).toBeGreaterThan(0);

  // A streamed frame whose active set is unchanged keeps the same ping node and start time: opening the panel while
  // the held helper runs, then waiting for its elapsed time to advance, proves a later render did not replay the ping.
  await trigger.tap();
  await expect(panel).toBeVisible();
  await expect.poll(() => hui.drawn(HEAD_BADGE)).toBe(true);
  await expect.poll(() => hui.contentOf(HEAD_BADGE)).toBe("");
  await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__count")).toBe("· 1 helper");
  await expect(panel.getByTestId("task-progress")).toHaveCount(0);
  const helperTime = "[data-testid='run-status'] .chat-run-status__helper-time";
  const firstTime = await hui.contentOf(helperTime);
  const streamedFirst = await hui.selectorAnimation(HEAD_PING);
  expect(streamedFirst?.animationName).toBe("chat-run-status-ping");
  await expect.poll(() => hui.contentOf(helperTime)).not.toBe(firstTime);
  const streamed = await hui.selectorAnimation(HEAD_PING);
  expect(streamed?.token).toBe(streamedFirst?.token);
  expect(streamed?.startTime).toBe(streamedFirst?.startTime);
  await hui.provider.release();
  await expect.poll(() => hui.drawn(HEAD_BADGE)).toBe(false);
  await screen.getByLabel("Close run status").tap();
  await expect(trigger).toBeVisible();
  await expect.poll(() => hui.drawn(BADGE)).toBe(false);

  // Reduced motion removes the ping but not the dot or live detail, with a Plan present this time. A fresh session keeps this half independent of the
  // first helper's completion turn.
  await utility(hui);
  await hui.reducedMotion("reduce");
  const reducedSession = await hui.createSession({ title: "Reduced side work" });
  await hui.open(`/sessions/${reducedSession.id}`);
  const reducedTrigger = screen.getByTestId("run-status-trigger");
  const reducedIdle = screen.getByLabel("Session status: Idle");
  const reducedSend = async (text: string) => {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message", { visible: true }).tap();
  };
  await reducedSend("E2E_PROGRESS");
  await expect(reducedIdle).toBeVisible();
  await reducedSend(calls(helper("Reduced first")));
  await hui.provider.held();
  await expect(reducedTrigger).toHaveAccessibleName(/1 of 1 helpers active/u);
  await expect.poll(() => hui.drawn(BADGE)).toBe(true);
  await expect.poll(() => hui.contentOf(BADGE)).toBe("");
  await expect.poll(() => hui.contentOf(`${TRIGGER} .chat-run-status__count`)).toBe("· 1 helper");
  const reduced = await hui.selectorAnimation(PING);
  expect(reduced?.animationName).toBe("none");
  expect(reduced?.count).toBe(0);
  await hui.provider.release();
  await expect.poll(() => hui.drawn(BADGE)).toBe(false);
  await hui.reducedMotion("no-preference");
});

test("live watcher detail counts only running watchers and does not repeat the goal state", { tags: ["AGENT-075"], platforms: ["web"] }, async ({ screen, hui }) => {
  await utility(hui, false);
  const session = await hui.createSession({ title: "Goal and watcher detail" });
  await hui.open(`/sessions/${session.id}`);
  const trigger = screen.getByTestId("run-status-trigger");
  const panel = screen.getByLabel("Run status");
  const send = async (text: string) => {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message", { visible: true }).tap();
  };
  await send("/goal E2E_REPLAY verify live watcher detail");
  await hui.provider.held();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, goal pursuing/u);
  await expect.poll(() => hui.contentOf(`${TRIGGER} .chat-run-status__count`)).toBe("· goal");
  await trigger.tap();
  await expect(panel).toBeVisible();
  await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__count")).toBe("· goal");
  await panel.getByRole("button", "Pause goal").tap();
  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__state")).toBe("Goal paused");
  await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__count")).toBe("");
  await screen.getByLabel("Close run status").tap();
  await expect(trigger).toBeVisible();
  await expect.poll(() => hui.contentOf(`${TRIGGER} .chat-run-status__count`)).toBe("");

  await send(calls(
    { name: "watcher", input: { action: "start", purpose: "Live status watcher", command: "sleep 600" } },
    { name: "watcher", input: { action: "start", purpose: "Finished status watcher", command: "printf 'done\\n'" } },
  ));
  // The short watcher settles through the real watcher poll: a total of two still means one live watcher.
  await expect(trigger).toHaveAccessibleName(/1 of 2 watchers running/u);
  await expect.poll(() => hui.contentOf(`${TRIGGER} .chat-run-status__count`)).toBe("· goal · 1 watcher");
  await expect.poll(() => hui.drawn(BADGE)).toBe(true);
  await expect.poll(() => hui.contentOf(BADGE)).toBe("");
  await trigger.tap();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Live status watcher", { exact: true })).toBeVisible();
  await expect(panel.getByText("Finished status watcher", { exact: true })).toBeVisible();
  await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__state")).toBe("Working · goal · 1 watcher");
  await expect.poll(() => hui.contentOf(HEAD_BADGE)).toBe("");
  await expect(panel.getByTestId("task-progress")).toHaveCount(0);
});

test("growing live helper counts leave every control to the right fixed without clipping", { tags: ["AGENT-075"], platforms: ["web"] }, async ({ screen, hui }) => {
  await utility(hui);
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, JSON.stringify({
    model: "gpt-live-1-codex",
    voices: ["cove"],
    chatgpt: { signedIn: true, account: { name: "Personal" } },
    active: 0,
    limit: 2,
  }));
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Layout helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  const check = async (scope: string) => {
    const trigger = screen.getByTestId("run-status-trigger", { visible: true });
    const send = async (text: string) => {
      await screen.getByLabel("Message", { visible: true }).fill(text);
      await screen.getByRole("button", "Send message", { exact: true, visible: true }).tap();
    };
    await send("E2E_PROGRESS");
    await expect(trigger).toHaveAccessibleName(/1 of 2 steps done/u);
    await expect(screen.getByLabel("Session status: Idle", { visible: true })).toBeVisible();
    const before = new Map<string, number>();
    for (const control of controls) {
      const selector = `${scope} ${control}`;
      if (await hui.drawn(selector)) {
        const box = await hui.rect(selector);
        expect(box).not.toBeNull();
        before.set(selector, box!.x);
      }
    }
    expect(before.size).toBeGreaterThan(0);
    const triggerBox = await hui.rect(`${scope} ${TRIGGER}`);
    expect(triggerBox).not.toBeNull();
    for (const [selector, x] of before) expect(x, `${selector} follows Run status`).toBeGreaterThan(triggerBox!.x);
    const nav = await hui.rect(`${scope} .chat-pane__nav-toggle`);
    if (nav) for (const [selector, x] of before) if (selector.endsWith(".chat-pane__nav-toggle") === false) expect(nav.x, `${selector} stays left of navigation`).toBeGreaterThan(x);
    const fixed = async () => {
      for (const [selector, x] of before) {
        const box = await hui.rect(selector);
        expect(box, selector).not.toBeNull();
        expect(Math.abs(box!.x - x), selector).toBeLessThanOrEqual(1);
      }
      await expect(trigger).not.toBeExpanded();
    };
    await send(calls(helper("Layout first helper")));
    await hui.provider.held();
    await expect(trigger).toHaveAccessibleName(/1 of 1 helpers active/u);
    await expect.poll(() => hui.contentOf(`${scope} ${TRIGGER} .chat-run-status__count`)).toBe("· 1 helper");
    await expect.poll(() => hui.drawn(`${scope} ${BADGE}`)).toBe(true);
    await fixed();
    await expect(screen.getByLabel("Session status: Idle", { visible: true })).toBeVisible();
    for (const copy of [".chat-run-status__label", ".chat-run-status__count"]) {
      const selector = `${scope} ${TRIGGER} ${copy}`;
      if (await hui.drawn(selector)) {
        const overflow = await hui.textOverflow(selector);
        expect(overflow).not.toBeNull();
        expect(overflow!.scrollWidth - overflow!.clientWidth, `${selector} is not clipped`).toBeLessThanOrEqual(1);
      }
    }
    await trigger.tap();
    const panel = screen.getByLabel("Run status");
    await expect(panel).toBeVisible();
    await expect.poll(() => hui.contentOf(`${scope} .chat-run-status__head .chat-run-status__count`)).toBe("· 1 helper");
    for (const copy of [".chat-run-status__label", ".chat-run-status__count"]) {
      const overflow = await hui.textOverflow(`${scope} .chat-run-status__head ${copy}`);
      expect(overflow).not.toBeNull();
      expect(overflow!.scrollWidth - overflow!.clientWidth, `panel ${copy} is not clipped`).toBeLessThanOrEqual(1);
    }
    if (nav) {
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(nav.x);
      if ((await hui.viewportSize()).width === 390) {
        await expect.poll(async () => Math.abs((await panel.boundingBox())!.width - 318)).toBeLessThanOrEqual(1);
      }
    }
    expect(await hui.overflowsSideways()).toBe(false);
    await panel.getByLabel("Close run status").tap();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeVisible();
    await fixed();
    await hui.provider.release();
    await expect.poll(() => hui.drawn(`${scope} ${BADGE}`)).toBe(false);
  };
  const header = "[data-testid='chat-header']";
  const botHeader = screen.getByTestId("chat-header");
  await expect(botHeader.getByRole("button", "Call Layout helper")).toBeVisible();
  await expect(botHeader.getByRole("button", "Actions for Layout helper")).toBeVisible();
  await check(header);
  await hui.phoneScreen();
  // A fresh bot has no earlier helpers: the phone exercises the same 0 → 1 live count.
  const phoneBot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Phone layout", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${phoneBot.id}`);
  await expect(screen.getByRole("button", "Open navigation")).toBeVisible();
  await check(header);
  await signedIn.stop();
});
