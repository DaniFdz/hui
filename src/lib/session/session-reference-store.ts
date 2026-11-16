/**
 * Which `session:<id>` references in chat Markdown resolve to a session: the app's registry is published here once per
 * change (`controllers/sessions-controller.ts`), and every `<hui-session-ref>` the Markdown parser drew
 * (`components/session-ref.ts`, emitted by `markdown/parser.ts`) reads its title and status from this index instead of
 * the paragraph it sits in. A reference that does not resolve — an unknown id, an ambiguous prefix, or a registry that
 * has not arrived yet — stays exactly the text that was typed, and upgrades in place when the list publishes.
 *
 * The index (an id map keyed by lowercase id, plus the sorted lowercase ids a prefix range is found in) is built once per
 * published list, on the first lookup after it, never per message and never per lookup, so a chat with many chips costs
 * one scan per registry change: the list arrives over the session stream and a publish drops the index, so nothing in
 * this path polls. An exact id wins over a prefix two sessions share. The status and stage wording is
 * `lib/session/labels.ts`'s and `lib/kanban.ts`'s; this module owns only resolution.
 */
import type { SessionGroup, SessionStatus } from "../../api/sessions.ts";
import type { SessionStage } from "../../api/schema/sessions.ts";
import { isSessionStage, SESSION_STAGE_LABELS } from "../kanban.ts";
import { sessionStatusLabel } from "./labels.ts";

/** What one resolved `session:<id>` reference shows: the session's title and the status and stage beside it. */
export type SessionReference = {
  id: string;
  title: string;
  status: SessionStatus;
  worker?: { id: string; name: string };
  stage?: SessionStage;
  pullRequestCount: number;
};

/** A full session id: 8-4-4-4-12 hexadecimal digits, in either case. */
const FULL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A hex prefix of an id: at least 8 characters, and never longer than an id. */
const ID_PREFIX_RE = /^[0-9a-f]{8,36}$/iu;

/** The lowercase query a `session:<query>` reference names, or `undefined` when it cannot name a session.
 * A reference is a full id or a hex prefix of at least 8 characters; anything shorter or non-hex is prose. */
export function parseSessionQuery(value: string): string | undefined {
  return FULL_ID_RE.test(value) || ID_PREFIX_RE.test(value) ? value.toLowerCase() : undefined;
}

/** One published registry, indexed once: the references by lowercase id, and their sorted lowercase ids for the prefix
 * range. A reference keeps the id the registry gave it, so a chip links to the id the session really has. */
type SessionIndex = {
  byId: ReadonlyMap<string, SessionReference>;
  ids: readonly string[];
};

let published: readonly SessionGroup[] = [];
/** Dropped on every publish and rebuilt by the first lookup after it. */
let index: SessionIndex | undefined;
const listeners = new Set<() => void>();

function buildIndex(groups: readonly SessionGroup[]): SessionIndex {
  const byId = new Map<string, SessionReference>();
  for (const group of groups) {
    for (const session of group.sessions) {
      // A query is read in either case, so the index is keyed lowercased while the reference keeps the registry's id.
      byId.set(session.id.toLowerCase(), {
        id: session.id,
        title: session.title,
        status: session.status,
        ...(session.worker ? { worker: { id: session.worker.id, name: session.worker.name } } : {}),
        ...(isSessionStage(session.stage) ? { stage: session.stage } : {}),
        pullRequestCount: session.pullRequests?.length ?? 0,
      });
    }
  }
  return { byId, ids: [...byId.keys()].sort() };
}

function currentIndex(): SessionIndex {
  index ??= buildIndex(published);
  return index;
}

/** The first id that is not less than `value`. */
function lowerBound(ids: readonly string[], value: string): number {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((ids[middle] ?? "") < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Takes the app's registry: stores it, drops the index the last one built and tells the connected chips. Nothing is
 * scanned here, so a list that draws no reference costs nothing. */
export function publishSessionReferences(groups: readonly SessionGroup[]): void {
  published = groups;
  index = undefined;
  for (const listener of [...listeners]) listener();
}

/** The session a query names, or `undefined` when it names none: an unknown id, or a prefix two sessions share. An
 * exact id wins over a prefix, so a query that is one session's whole id names that session even when its id is also a
 * prefix of another's. */
export function lookupSessionReference(query: string): SessionReference | undefined {
  const normalized = parseSessionQuery(query);
  if (!normalized) return undefined;
  const { byId, ids } = currentIndex();
  const exact = byId.get(normalized);
  if (exact) return exact;
  const start = lowerBound(ids, normalized);
  const match = ids[start];
  if (!match || !match.startsWith(normalized)) return undefined;
  // A second id starting with the same prefix makes it ambiguous: two sessions, no guess.
  if ((ids[start + 1] ?? "").startsWith(normalized)) return undefined;
  return byId.get(match);
}

/** Told whenever a registry is published; answers the function that stops listening. */
export function subscribeSessionReferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The accessible name of a resolved reference: it opens the session, and says which status it is in. */
export function sessionReferenceLabel(reference: SessionReference): string {
  return `Open session ${reference.title} (${sessionStatusLabel(reference)})`;
}

/** The tooltip of a resolved reference: its title, status, stage and pull requests, where it has them. */
export function sessionReferenceDetail(reference: SessionReference): string {
  const pullRequests = reference.pullRequestCount;
  return [
    reference.title,
    sessionStatusLabel(reference),
    ...(isSessionStage(reference.stage) ? [SESSION_STAGE_LABELS[reference.stage]] : []),
    ...(pullRequests > 0 ? [`${pullRequests} pull request${pullRequests === 1 ? "" : "s"}`] : []),
  ].join(" · ");
}
