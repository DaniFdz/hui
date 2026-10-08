/**
 * Triggers in the gateway (HUI-18): the service, its GitHub pollers, the Slack poller, the session watch and the webhook
 * route, wired to the gateway's bots, sessions, settings and Slack connection. `hui.ts` makes one of these, starts and
 * stops it with the backend, tells it when bots are turned on or off, and routes `/__hui/bots/:id/triggers…`,
 * `POST /__hui/hooks/<token>` and `/__hui/slack` to it.
 */
import type { IncomingMessage } from "node:http";

import type { BotRecord } from "../shared/bots.ts";
import { createBotTriggerRoutes } from "./bot-trigger-routes.ts";
import { BotTriggerService } from "./bot-triggers.ts";
import { DEFAULT_POLL_MS, GitHubPollers, ghRest, type GhRest } from "./bot-triggers-github.ts";
import { SessionWatch } from "./bot-triggers-session.ts";
import { DEFAULT_SLACK_POLL_MS, SlackPoller } from "./bot-triggers-slack.ts";
import { ghRaw, pullRequestReader, type GhRaw } from "./bot-triggers-slack-prs.ts";
import { cursorStore, slackCursorStore, triggerStore } from "./bot-triggers-store.ts";
import { createSlackRoutes } from "./slack-routes.ts";
import { SlackConnector } from "./slack.ts";
import { HOOK_ROUTE, isTailnetOrLoopback, readHookBody } from "./bot-triggers-webhook.ts";
import type { LiveSessions } from "./live-sessions.ts";
import type { SessionRecord } from "./sessions.ts";

export type GatewayTriggerDeps = {
  /** The bot message path (`BotService.send`). */
  send(botId: string, message: { text: string }): Promise<unknown>;
  listBots(): Promise<readonly BotRecord[]>;
  readSessions(): Promise<readonly SessionRecord[]>;
  sessions: Pick<LiveSessions, "watchStatuses" | "transcript" | "snapshot">;
  /** Settings → Labs → Bots. */
  active(): Promise<boolean>;
  /** The GitHub CLI the gateway runs (`HUI_GITHUB_CLI` points tests at a fake). */
  ghCommand: string;
  report(event: { level: "info" | "warning" | "error"; action: string; summary: string; detail?: string }): void;
  /** The gateway's Slack connection (Settings → Integrations → Slack). */
  slack?: SlackConnector;
  /** Overrides for tests: the store files, gh, the poll intervals. */
  triggersFile?: string;
  cursorsFile?: string;
  slackCursorFile?: string;
  gh?: GhRest;
  ghRaw?: GhRaw;
  pollMs?: number;
  slackPollMs?: number;
};

/** `HUI_TRIGGER_POLL_SECONDS`: how often each repo is polled (default 60; GitHub's `X-Poll-Interval` still wins when longer). */
export function triggerPollMs(env: NodeJS.ProcessEnv = process.env): number {
  const seconds = Number(env["HUI_TRIGGER_POLL_SECONDS"]);
  return Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds * 1_000) : DEFAULT_POLL_MS;
}

/** `HUI_SLACK_POLL_SECONDS`: how often Slack is read (default 60; search.messages allows about 20 requests a minute,
 * and a poll makes one or two; Retry-After still wins when longer). */
export function slackPollMs(env: NodeJS.ProcessEnv = process.env): number {
  const seconds = Number(env["HUI_SLACK_POLL_SECONDS"]);
  return Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds * 1_000) : DEFAULT_SLACK_POLL_MS;
}

export function createGatewayTriggers(deps: GatewayTriggerDeps) {
  const report = (level: "info" | "warning" | "error", action: string, summary: string, detail?: string) =>
    deps.report({ level, action, summary, ...(detail ? { detail } : {}) });
  const store = triggerStore(deps.triggersFile, (count) => report("warning", "triggers_invalid_records",
    `bot-triggers.json holds ${count} invalid trigger record${count === 1 ? "" : "s"}; HUI keeps them in the file but does not run them.`));
  let service: BotTriggerService | undefined;
  const pollers = new GitHubPollers({
    gh: deps.gh ?? ghRest(deps.ghCommand),
    cursors: cursorStore(deps.cursorsFile),
    onEvents: (events) => service?.github(events),
    intervalMs: deps.pollMs ?? triggerPollMs(),
    report: (level, action, summary, detail) => report(level, action, summary, detail),
  });
  const connector = deps.slack ?? new SlackConnector();
  const slackPoller = new SlackPoller({
    connector,
    cursors: slackCursorStore(deps.slackCursorFile),
    onEvents: (events) => service?.slack(events),
    intervalMs: deps.slackPollMs ?? slackPollMs(),
    report: (level, action, summary, detail) => report(level, action, summary, detail),
  });
  const readPullRequests = pullRequestReader(deps.ghRaw ?? ghRaw(deps.ghCommand));
  service = new BotTriggerService({
    store,
    bots: {
      list: deps.listBots,
      deliver: (botId, text) => deps.send(botId, { text }),
      runPrompt: async (sessionId) => (await deps.readSessions()).find((record) => record.id === sessionId)?.runPrompt,
    },
    github: pollers,
    slack: {
      sync: (wants) => slackPoller.sync(wants),
      stop: () => slackPoller.stop(),
      status: () => slackPoller.status(),
      connected: async () => Boolean(await connector.config()),
      pullRequests: (urls, diffBudget) => readPullRequests(urls, diffBudget),
    },
    active: deps.active,
    report,
  });
  const triggers = service;
  /** What the Slack section shows of the reading: whether it runs, when Slack was last read, its latest problem. */
  const slackWatch = () => {
    const status = slackPoller.status();
    return { active: slackPoller.active, ...(status?.polledAt ? { polledAt: status.polledAt } : {}), ...(status?.error ? { error: status.error } : {}) };
  };
  const watch = new SessionWatch({
    sessions: deps.sessions,
    readSessions: deps.readSessions,
    wanted: () => triggers.wantsSessions(),
    onEvent: (event) => triggers.session(event),
    report: (error) => report("warning", "trigger_session_event_failed", "A session's event could not reach its triggers", error instanceof Error ? error.message : String(error)),
  });
  return {
    service: triggers,
    pollers,
    slackPoller,
    slack: connector,
    routes: createBotTriggerRoutes({ service: triggers }),
    slackRoutes: createSlackRoutes({ connector, watch: slackWatch }),
    async start(): Promise<void> {
      watch.start();
      await triggers.start();
    },
    /** The session watch first, so an event it is still handing on reaches a service that records it; then the service,
     * its pollers and what they have in flight. */
    async stop(): Promise<void> {
      await watch.stop();
      await triggers.stop();
    },
    /** `POST /__hui/hooks/<token>`: only from this machine or the tailnet (403 otherwise), POST only (405). */
    async hook(request: IncomingMessage, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
      if (!isTailnetOrLoopback(request.socket.remoteAddress)) return { status: 403, body: { error: "Webhook triggers answer only callers on this machine or its tailnet." } };
      if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      const token = HOOK_ROUTE.exec(path)?.[1];
      if (!token) return { status: 404, body: { error: "No trigger has this URL." } };
      return triggers.hook(token, () => readHookBody(request));
    },
  };
}

export type GatewayTriggers = ReturnType<typeof createGatewayTriggers>;
