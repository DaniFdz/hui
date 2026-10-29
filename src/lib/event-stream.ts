/**
 * Pure helpers for the gateway's event streams, shared by the stream clients in `src/api/` and the iOS core
 * (`ios/core/entry.ts`): decoding one server-sent event frame, and the delay before a dropped stream reconnects.
 * The first retry waits about half a second and the delay doubles to a four-second ceiling, so a gateway restart
 * recovers in a few seconds without hammering the port while it is down; equal jitter keeps a screenful of tabs off
 * the same retry schedule.
 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 4_000;

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function decodeSseFrame(chunk: string): { name: string; payload: unknown } | undefined {
  let name = "message";
  const data: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      name = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  return { name, payload: JSON.parse(data.join("\n")) as unknown };
}
