/**
 * The `triggers` tool (HUI-18) of bots' chats, in the `hui-bots-tools` extension: a bot lists, adds, changes and
 * removes its own triggers, what wakes it when a pull request changes on GitHub or a session it started finishes,
 * fails or asks something. HUI's agent-tool handler does the work (`BotTriggerService.tool`), as the calling chat's
 * session, and refuses `add` and `update` in a turn another bot or a trigger started.
 *
 * It is an ordinary tool of the Tools tab, under Bots: on by default, not powerful, and the operator can turn it off.
 * It imports nothing from `durable-bots.ts`, which builds the extension with it.
 */
import { defineTool, type ConversationId, type DocumentReader, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "typebox";
import { BOT_TRIGGER_LIMITS, GITHUB_TRIGGER_EVENTS, SESSION_TRIGGER_EVENTS } from "../../shared/bot-triggers.ts";

export const TRIGGERS_TOOL = "triggers";

/** What the tool adds to HUI's active-tool section. */
export const TRIGGERS_TOOL_CONTRIBUTION = {
  snippet: "List, add, change or remove your own triggers: GitHub pull request and session events that wake you",
  guidelines: [] as readonly string[],
};

/** How the Tools tab names it. */
export const TRIGGERS_TOOL_INFO = { label: "Triggers", description: "Add, change and remove its own triggers: GitHub and session events that wake it" };

const values = (description: string) => Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: BOT_TRIGGER_LIMITS.value }), { maxItems: BOT_TRIGGER_LIMITS.values, description }));

export function triggersTool(options: {
  invoke(conversationId: ConversationId, action: string, params: Record<string, unknown>): Promise<unknown>;
  /** Whether the conversation is a bot's chat. */
  isBot(reader: DocumentReader, conversationId: ConversationId, context: Context): Promise<boolean>;
}): ToolRegistration {
  return defineTool({
    name: TRIGGERS_TOOL,
    description: [
      "Your triggers wake you when something happens: a pull request changes on GitHub, or a session you started finishes, fails or waits for an answer.",
      "Each event arrives in this chat as \"[trigger: <name> · <summary>] <prompt>\" with its details.",
      "action list shows them; add needs name, source (github with repos and events, or session with events) and optionally a prompt and cooldownSeconds (events within it arrive together; default 300);",
      "update and remove name the trigger (its name or id) in trigger; update changes only what you give.",
      "GitHub events: pr_opened, pr_pushed, checks_failed, checks_succeeded, review_approved, review_changes_requested, review_commented, comment, mention (of the operator), pr_merged, pr_closed;",
      "narrow them with authors, labels, base, pullRequests and draft. Session events: finished, failed, waiting.",
      "Only the operator's own turns may add or change triggers. Webhook triggers are the operator's to add; Slack and listener triggers the operator's to add and change.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(["list", "add", "update", "remove"].map((action) => Type.Literal(action))),
      trigger: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: "update and remove: the trigger's name or id." })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: BOT_TRIGGER_LIMITS.name, description: "One line, without [, ] or ·." })),
      source: Type.Optional(Type.Union(["github", "session"].map((source) => Type.Literal(source)), { description: "add only." })),
      repos: Type.Optional(Type.Array(Type.String({ minLength: 3, maxLength: 200 }), { maxItems: BOT_TRIGGER_LIMITS.repos, description: "github: owner/name of each repo." })),
      events: Type.Optional(Type.Array(Type.Union([...GITHUB_TRIGGER_EVENTS, ...SESSION_TRIGGER_EVENTS].map((event) => Type.Literal(event))), { minItems: 1, maxItems: GITHUB_TRIGGER_EVENTS.length })),
      authors: values("github: only pull requests opened by these logins."),
      labels: values("github: only pull requests with one of these labels."),
      base: values("github: only pull requests into these base branches."),
      pullRequests: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: BOT_TRIGGER_LIMITS.values, description: "github: only these pull request numbers." })),
      draft: Type.Optional(Type.Boolean({ description: "github: true only drafts, false only pull requests ready for review." })),
      prompt: Type.Optional(Type.String({ maxLength: BOT_TRIGGER_LIMITS.prompt, description: "What to do when it fires; \"\" clears it on update." })),
      cooldownSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: BOT_TRIGGER_LIMITS.cooldownMax })),
      enabled: Type.Optional(Type.Boolean()),
    }),
    // Adding a trigger again would make a second one: an interrupted call is reported, never repeated.
    replay: "unsafe",
    execute: async (args, api, context) => {
      try {
        if (!await options.isBot(api, api.conversationId, context)) throw new Error(`${TRIGGERS_TOOL} is only available in a bot's chat.`);
        const params = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
        const result = await options.invoke(api.conversationId, TRIGGERS_TOOL, params);
        const text = typeof result === "object" && result !== null && typeof (result as { text?: unknown }).text === "string" ? (result as { text: string }).text : "Done.";
        return { content: [{ type: "text", text }] };
      } catch (error) {
        if (context.abortSignal?.aborted) throw error;
        // A refusal (a turn that may not add, a bad filter, the cap) is the model's to read and act on.
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  });
}
