/**
 * What a provider account's limits block says, without the Lit element: the one meta line built from a quota
 * payload, and the account order a drag drop commits. PI reports usage windows and, at most, a plan name; it
 * never reports a subscription state, a renewal date or a billing state.
 */
import type { ProviderQuota } from "../api/schema/providers.ts";

/** What the connection reports about this account's usage, in one label. An access answer wins over the read
 * status, because it is the provider's own answer about this account. */
export function quotaStatusLabel(quota: Pick<ProviderQuota, "status" | "access">): string {
  if (quota.access === "limited") return "Limit reached";
  if (quota.access === "available") return "Available";
  if (quota.status === "available") return "Usage reported";
  if (quota.status === "unsupported") return "Not supported";
  return "Unavailable";
}

/** The limits block's one meta line: the usage status, the plan only when the connection reports one, when it was
 * read. `checked` is already local time, so the caller owns the formatting. */
export function quotaMetaLine(quota: Pick<ProviderQuota, "status" | "access" | "plan">, checked: string): string {
  const parts = [quotaStatusLabel(quota), quota.plan ? `Plan ${quota.plan}` : "", `Checked ${checked}`];
  return parts.filter((part) => part.length > 0).join(" · ");
}

/** The saved priority order after dragging `id` to `to`: the others keep their relative order, and the target
 * position is clamped to the list, so a pointer past either end still commits a real order. An id the list does
 * not hold is not a reorder and leaves the order as it is. */
export function reorderAccountIds(order: string[], id: string, to: number): string[] {
  if (!order.includes(id)) return order;
  const rest = order.filter((entry) => entry !== id);
  rest.splice(Math.max(0, Math.min(rest.length, Math.trunc(to))), 0, id);
  return rest;
}
