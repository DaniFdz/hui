/**
 * The side chat (`/btw`) per conversation: the question HUI asked the utility model, the answer, and the failure that
 * replaced it. The composer writes the outcome and the Work pane's Side chat view draws it; a bot's chat, which has no
 * Work pane, draws the same state in the inline rail instead. Nothing here reaches the conversation's transcript.
 */

export type SideChatState = {
  question: string;
  /** Empty while the utility model works, or when it failed (see `error`). */
  answer: string;
  model: string;
  loading: boolean;
  error: string;
};

/** A change to one conversation's side chat. `opened` marks a new question, so the surface showing it comes forward. */
export type SideChatEvent = { sessionId: string; opened: boolean };

const chats = new Map<string, SideChatState>();
const listeners = new Set<(event: SideChatEvent) => void>();

function publish(event: SideChatEvent): void {
  for (const listener of [...listeners]) listener(event);
}

export function sideChatFor(sessionId: string): SideChatState | undefined {
  return chats.get(sessionId);
}

/** A new question replaces the previous exchange; its answer arrives through `settleSideChat`. */
export function startSideChat(sessionId: string, question: string): void {
  chats.set(sessionId, { question, answer: "", model: "", loading: true, error: "" });
  publish({ sessionId, opened: true });
}

/** The utility model's answer, or why it failed. An exchange cleared meanwhile (or closed) stays gone. */
export function settleSideChat(sessionId: string, outcome: { answer: string; model: string } | { error: string }): void {
  const current = chats.get(sessionId);
  if (!current) return;
  chats.set(sessionId, "error" in outcome
    ? { ...current, loading: false, error: outcome.error }
    : { ...current, loading: false, error: "", answer: outcome.answer, model: outcome.model });
  publish({ sessionId, opened: false });
}

export function clearSideChat(sessionId: string): void {
  if (!chats.delete(sessionId)) return;
  publish({ sessionId, opened: false });
}

export function subscribeSideChat(listener: (event: SideChatEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
