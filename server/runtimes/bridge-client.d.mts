export function invokeHuiBridge(
  action: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<unknown>;
