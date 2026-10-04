import type { AsyncLocalStorage } from "node:async_hooks";

export type DirectHuiBridge = (action: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export const directHuiBridge: AsyncLocalStorage<DirectHuiBridge>;

export function invokeHuiBridge(
  action: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<unknown>;
