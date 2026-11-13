/**
 * `hui doctor`: OptChat documents from before a bot's chat could be rewound. A rewind now keeps a bot's chat, so OptChat's
 * document is `fork: "current"` (`docs/optchat.md`); before that it was `fork: "initial"`, and Durable refuses a typed
 * read whose fork semantics disagree with the stored incarnation. A gateway that meets one says "The runtime could not
 * start"; HUI adopts each document when it opens its conversation, and this check reports the conversations it has not
 * opened, so `--fix` can rewrite them all at once. Only the document's incarnation changes: OptChat's memory files, the
 * chat and the bot are untouched, and the check therefore reports an OptChat that is off too.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ConversationId, Cursor, DocumentAddress } from "@earendil-works/pi-durable";
import { DURABLE_DIR, durableContext } from "../server/runtimes/durable-host.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

const ID = "optchat";
const TITLE = "OptChat documents";

/** One conversation whose OptChat document an older HUI wrote. */
type LegacyDocument = { readonly conversationId: ConversationId; readonly name?: string };

export type OptChatDoctorOptions = {
  /** The Durable store's directory (`DURABLE_DIR`). */
  dir?: string;
};

const address = (conversationId: ConversationId): DocumentAddress => ({
  kind: "hui.optchat", scope: { kind: "conversation", conversationId },
});

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function label(document: LegacyDocument): string {
  const conversation = `conversation ${document.conversationId}`;
  // JSON.stringify escapes the name for a single-line report; an unnamed document is one whose OptChat is off.
  return document.name === undefined ? `${conversation} (no OptChat)` : `${JSON.stringify(document.name)} (${conversation})`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function result(found: readonly LegacyDocument[], items: DoctorItem[], notes: string[]): DoctorResult {
  const remaining = items.filter((item) => item.status !== "fixed").length;
  const adopted = items.filter((item) => item.status === "fixed").length;
  if (!found.length) return { id: ID, title: TITLE, status: "ok", summary: "every OptChat document is the current one", items, notes };
  const summary = adopted
    ? `adopted ${plural(adopted, "OptChat document")}${remaining ? `; ${plural(remaining, "document")} still ${remaining === 1 ? "is" : "are"} not` : ""}`
    : `found ${plural(found.length, "OptChat document")} an older HUI wrote`;
  return { id: ID, title: TITLE, status: remaining ? "issue" : "fixed", summary, items, notes };
}

/**
 * Every conversation whose document is still the legacy incarnation. Reads the store through Durable's own storage, so it
 * works while the gateway owns it: a report is one read per conversation and writes nothing.
 */
async function legacyDocuments(dir: string): Promise<LegacyDocument[]> {
  const file = join(dir, "harness.sqlite");
  if (!await stat(file).then((info) => info.isFile(), () => false)) return [];
  const storage = await openNodeSqliteStorage(file);
  const found: LegacyDocument[] = [];
  try {
    let cursor: Cursor | undefined;
    do {
      const page = await storage.scanConversations({ order: "ascending" }, 200, cursor, durableContext);
      for (const conversation of page.items) {
        const record = await storage.findDocument(address(conversation.id), "current", durableContext);
        if (record === undefined || record.fork !== "initial") continue;
        const stored = await storage.document(record.id, "current", durableContext);
        const name = stored?.value["name"];
        found.push({ conversationId: conversation.id, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}) });
      }
      cursor = page.next;
    } while (cursor);
  } finally {
    await storage.close(durableContext);
  }
  return found;
}

export function createOptChatCheck(options: OptChatDoctorOptions = {}): DoctorCheck {
  const dir = options.dir ?? DURABLE_DIR;
  const items = (found: readonly LegacyDocument[], status: DoctorItem["status"], detail?: string): DoctorItem[] =>
    found.map((document) => ({ id: String(document.conversationId), label: label(document), status, ...(detail ? { detail } : {}) }));
  return {
    id: ID,
    title: TITLE,
    async inspect() {
      const found = await legacyDocuments(dir);
      return result(found, items(found, "issue"), found.length
        ? ["A chat adopts its own document when the gateway opens it; hui doctor --fix adopts every one while the gateway is stopped."]
        : []);
    },
    async fix() {
      const found = await legacyDocuments(dir);
      if (!found.length) return result(found, [], []);
      const { DurableHost } = await import("../server/runtimes/durable-host.ts");
      const { adoptOptChat } = await import("../server/runtimes/durable-optchat.ts");
      const { resolvePiAgentDir } = await import("../server/pi/paths.ts");
      // Never resumes a run, and never follows commits: the store is only written in these commits. Opening fails while a
      // gateway owns it, and doctor checks that before it runs a fix.
      const host = new DurableHost({ dir, agentDir: resolvePiAgentDir(), resume: false });
      host.configureDurableBots(null);
      const fixed: DoctorItem[] = [];
      try {
        const harness = await host.open();
        for (const document of found) {
          try {
            await adoptOptChat(harness, document.conversationId, durableContext);
            fixed.push({ id: String(document.conversationId), label: label(document), status: "fixed", detail: "rewritten as the current OptChat document" });
          } catch (error) {
            fixed.push({ id: String(document.conversationId), label: label(document), status: "failed", detail: message(error) });
          }
        }
      } finally {
        await host.close();
      }
      return result(found, fixed, ["The chats and OptChat's memory files were not changed; only each document's record was rewritten."]);
    },
  };
}

export const optChatCheck: DoctorCheck = createOptChatCheck();
