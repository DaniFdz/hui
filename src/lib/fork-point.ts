/**
 * Where the chat offers a fork: a reply the copy can carry on from. A reply that asked for tools is followed by their
 * calls, and the gateway refuses to fork there, so it is not offered. Pure, so the rule is tested without the view.
 */

/** The fields the rule reads; any transcript item of the browser or the gateway has them. */
type Item = { readonly kind: string; readonly role?: string; readonly entryId?: string };

/** The entry ID to fork at after `message`, or undefined when the reply is not a fork point (yet). */
export function forkPoint(transcript: readonly Item[], message: Item | undefined): string | undefined {
  if (message?.kind !== "message" || message.role !== "assistant" || !message.entryId) return undefined;
  const index = transcript.indexOf(message);
  if (index < 0) return undefined;
  const next = transcript.slice(index + 1).find((item) => item.kind === "message" || item.kind === "tool");
  return next?.kind === "tool" ? undefined : message.entryId;
}
