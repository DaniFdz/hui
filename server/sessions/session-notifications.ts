/** HUI's own desktop notifications about sessions, as Settings → Notifications chooses: a run the operator started
 * that finished or failed, and a conversation that starts waiting for the operator. Delivery, and which chat a banner
 * opens, belong to agent-tools/notifications.ts. */
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { INTER_SESSION_TAG } from "../agent-tools/subagents.ts";
import type { SessionStatus } from "../api/sessions.ts";
import type { Settings } from "../api/settings.ts";
import { recordDiagnosticEvent } from "../observability.ts";
import { botTurnOrigin } from "../runtimes/turn-origins.ts";
import type { LiveSessions } from "./live-sessions.ts";

export type NotificationTarget = NotificationChat & { title: string; subagent: boolean };

function startedByOperator(prompt: string | undefined): boolean {
  return botTurnOrigin(prompt).kind === "operator" && !prompt?.startsWith(INTER_SESSION_TAG);
}

export function watchSessionNotifications(deps: {
  sessions: Pick<LiveSessions, "watchStatuses" | "watchRunEnds" | "questions" | "subagents">;
  settings: () => Promise<Settings["notifications"]>;
  chat: (sessionId: string) => Promise<NotificationTarget | undefined>;
  deliver: (chat: NotificationChat, notification: DesktopNotification) => Promise<unknown>;
}): void {
  const send = async (id: string, wanted: (settings: Settings["notifications"]) => boolean, content: (chat: NotificationTarget) => DesktopNotification | undefined) => {
    try {
      if (!wanted(await deps.settings())) return;
      const chat = await deps.chat(id);
      const notification = chat && content(chat);
      if (chat && notification) await deps.deliver(chat, notification);
    } catch (error) {
      recordDiagnosticEvent({
        area: "session", level: "warning", action: "notification_skipped", summary: "HUI skipped a desktop notification",
        detail: error instanceof Error ? error.message : String(error), sessionId: id,
      });
    }
  };
  const statuses = new Map<string, SessionStatus>();
  const watched = deps.sessions.watchStatuses(({ id, status }) => {
    const before = statuses.get(id);
    statuses.set(id, status);
    if (status !== "waiting" || before === "waiting") return;
    void send(id, (settings) => settings.needsInput, (chat) => {
      const question = deps.sessions.questions(id)[0]?.title.trim();
      return { title: chat.title, subtitle: "Needs your input", ...(question ? { message: question.slice(0, 1_000) } : {}), priority: "normal" };
    });
  });
  for (const { id, status } of watched.statuses) statuses.set(id, status);
  deps.sessions.watchRunEnds(({ id, failed, prompt }) => {
    if (!startedByOperator(prompt)) return;
    void send(id, (settings) => (failed ? settings.runFailed : settings.runFinished), (chat) => {
      const subagentsBusy = deps.sessions.subagents(id).some(({ status }) => ["queued", "starting", "running"].includes(status));
      return chat.subagent || (!failed && subagentsBusy) ? undefined : { title: chat.title, subtitle: failed ? "Run failed" : "Finished", priority: "low" };
    });
  });
}
