/** Run status's side-work badge: stable active-set animation, reduced motion, and fixed header controls (AGENT-075). */
import { expect, type Locator } from "e2e";
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
const BADGE = `${TRIGGER} .chat-run-status__activity`;
const PING = `${BADGE} .chat-run-status__activity-ping`;
const HEAD_BADGE = ".chat-run-status__head .chat-run-status__activity";
const HEAD_PING = `${HEAD_BADGE} .chat-run-status__activity-ping`;

async function utility(hui: Hui) {
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
}

test("side work pings once per active set, not per streamed frame, and respects reduced motion", { tags: ["AGENT-075"], platforms: ["web"] }, async ({ screen, hui }) => {
  await utility(hui);
  await hui.reducedMotion("no-preference");
  const session = await hui.createSession({ title: "Side work" });
  await hui.open(`/sessions/${session.id}`);
  const trigger = screen.getByTestId("run-status-trigger");
  const panel = screen.getByLabel("Run status");
  const idle = screen.getByLabel("Session status: Idle");
  const send = async (text: string) => {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message", { visible: true }).tap();
  };
  await send("E2E_PROGRESS");
  await expect(trigger).toHaveAccessibleName(/1 of 2 steps done/u);
  await expect(idle).toBeVisible();

  // A held helper makes one side task active: the pill grows a badge and its accessible name says the count.
  await send(call("sessions_spawn", helper("First side task").input));
  await hui.provider.held();
  await expect(trigger).toHaveAccessibleName(/1 side task active/u);
  await expect.poll(() => hui.contentOf(BADGE)).toBe("1");
  await expect.poll(async () => (await hui.selectorAnimation(PING))?.startTime).not.toBeNull();
  const first = await hui.selectorAnimation(PING);
  expect(first?.animationName).toBe("chat-run-status-ping");
  expect(first?.count).toBeGreaterThan(0);

  // A streamed frame whose active set is unchanged keeps the same ping node and start time: opening the panel while
  // the held helper runs, then waiting for its elapsed time to advance, proves a later render did not replay the ping.
  await trigger.tap();
  await expect(panel).toBeVisible();
  await expect.poll(() => hui.contentOf(HEAD_BADGE)).toBe("1 active");
  await expect(panel.getByLabel("Task progress steps").getByText("Read fixture")).toBeVisible();
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

  // Reduced motion removes the ping but not the live count. A fresh session keeps this half independent of the
  // first helper's completion turn.
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
  await reducedSend(calls(helper("Reduced first"), helper("Reduced second")));
  await hui.provider.held();
  await expect(reducedTrigger).toHaveAccessibleName(/2 side tasks active/u);
  await expect.poll(() => hui.contentOf(BADGE)).toBe("2");
  const reduced = await hui.selectorAnimation(PING);
  expect(reduced?.animationName).toBe("none");
  expect(reduced?.count).toBe(0);
  await hui.provider.release();
  await expect.poll(() => hui.drawn(BADGE)).toBe(false);
  await hui.reducedMotion("no-preference");
});

// These are the actual controls, not placeholder boxes: Durable has no Continue; a phone has no Close pane.
// A bot supplies Call, bot panel and ⋯; an ordinary desktop split supplies Close. Native phone targets measure only
// their real viewport; the web target starts at 1440×900 and repeats at 390×844.
const controls = [".bot-call-toggle", ".bot-panel-toggle", ".bot-header-menu__trigger", "[aria-label='Continue without a prompt']", ".chat-pane__close-pane", ".chat-pane__nav-toggle"];

test("growing plan and side-work counts leave every control to the right fixed", { tags: ["AGENT-075"], platforms: ["web"] }, async ({ screen, hui }) => {
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
  const check = async (scope: string, pane?: Locator) => {
    const root = pane ?? screen;
    const trigger = root.getByTestId("run-status-trigger", { visible: true });
    const send = async (text: string) => {
      await root.getByLabel("Message", { visible: true }).fill(text);
      await root.getByRole("button", "Send message", { exact: true, visible: true }).tap();
    };
    await send("E2E_PROGRESS");
    await expect(trigger).toHaveAccessibleName(/1 of 2 steps done/u);
    await expect(root.getByLabel("Session status: Idle", { visible: true })).toBeVisible();
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
    await send("E2E_PROGRESS_WIDE");
    await expect(trigger).toHaveAccessibleName(/10 of 12 steps done/u);
    await expect(root.getByLabel("Session status: Idle", { visible: true })).toBeVisible();
    await fixed();
    await send(calls(helper("Layout side task")));
    await hui.provider.held();
    await expect(trigger).toHaveAccessibleName(/1 side task active/u);
    await expect.poll(() => hui.contentOf(`${scope} ${BADGE}`)).toBe("1");
    await fixed();
    await hui.provider.release();
    await expect.poll(() => hui.drawn(`${scope} ${BADGE}`)).toBe(false);
  };
  const header = "[data-testid='chat-header']";
  const botHeader = screen.getByTestId("chat-header");
  await expect(botHeader.getByRole("button", "Call Layout helper")).toBeVisible();
  await expect(botHeader.getByRole("button", "Actions for Layout helper")).toBeVisible();
  await check(header);
  if ((await hui.viewportSize()).width >= 1100) {
    const left = await hui.createSession({ title: "Layout left" });
    await hui.createSession({ title: "Layout split" });
    await hui.open(`/sessions/${left.id}`);
    await screen.getByRole("tab", "Agents").tap();
    await hui.sessionList();
    await (await hui.sessionMenu("Layout split")).getByText("Open in split pane", { visible: true }).tap();
    const pane = screen.getByTestId("session-pane").nth(1);
    await expect(pane.getByRole("button", "Close session pane")).toBeVisible();
    await check("[data-testid='session-pane'][aria-current='true'] [data-testid='chat-header']", pane);
  }
  await hui.phoneScreen();
  // A fresh bot has no earlier WIDE marker in its conversation, so the utility starts at 1/2 again.
  const phoneBot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Phone layout", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${phoneBot.id}`);
  await expect(screen.getByRole("button", "Open navigation")).toBeVisible();
  await check(header);
  await signedIn.stop();
});
