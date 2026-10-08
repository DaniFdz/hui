/**
 * `hui slack`: the gateway's Slack connection (HUI-18, Slack triggers) from a terminal, through the running gateway's
 * `/__hui/slack` route, as Settings → Integrations → Slack uses it: connect, status and disconnect. `connect` reads the
 * token at a hidden prompt, or from stdin when piped; never from the command line, where it would stay in the shell's
 * history and the process list.
 */
import type { SlackConnection } from "../shared/slack.ts";

export type SlackIO = {
  out(text: string): void;
  err(text: string): void;
  /** Whether a person types at a terminal: then the token is asked for with echo off. */
  interactive: boolean;
  readHidden(prompt: string): Promise<string>;
  readStdin(): Promise<string>;
};

/** The terminal's IO: a hidden prompt on the terminal (raw mode, nothing echoed), stdin otherwise. */
export function terminalSlackIO(): SlackIO {
  return {
    out: (text) => { process.stdout.write(text); },
    err: (text) => { process.stderr.write(text); },
    interactive: Boolean(process.stdin.isTTY),
    readStdin: async () => {
      let text = "";
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) text += chunk as string;
      return text;
    },
    readHidden: (prompt) => new Promise((resolve, reject) => {
      const input = process.stdin;
      process.stderr.write(prompt);
      input.setRawMode(true);
      input.setEncoding("utf8");
      input.resume();
      let value = "";
      const done = () => {
        input.off("data", onData);
        input.setRawMode(false);
        input.pause();
        process.stderr.write("\n");
      };
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n" || character === "\u0004") {
            done();
            resolve(value);
            return;
          }
          if (character === "\u0003") {
            done();
            reject(new Error("Cancelled."));
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else if (character >= " ") value += character;
        }
      };
      input.on("data", onData);
    }),
  };
}

/** `3 min ago` for a status line. */
function ago(at: string | undefined, now = Date.now()): string {
  const time = Date.parse(at ?? "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1_000));
  if (seconds < 45) return "just now";
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  return `${Math.round(seconds / 3_600)} h ago`;
}

/** What `hui slack status` prints. */
export function formatSlackConnection(connection: SlackConnection, now = Date.now()): string {
  if (!connection.configured) return "Slack: not connected. Connect it with hui slack connect (or in Settings → Integrations → Slack).";
  let host = "";
  try {
    host = connection.url ? new URL(connection.url).host : "";
  } catch {
    host = "";
  }
  const reading = connection.watch.error ? connection.watch.error
    : connection.watch.active ? (connection.watch.polledAt ? `read ${ago(connection.watch.polledAt, now)}` : "starting")
      : "not reading (no enabled Slack trigger, or bots are off)";
  return [
    `Slack: ${connection.message}`,
    `Workspace: ${connection.team || connection.teamId || "?"}${host ? ` (${host})` : ""} · as @${connection.user || connection.userId || "?"}${connection.checkedAt ? ` · checked ${ago(connection.checkedAt, now)}` : ""}`,
    ...(connection.missingScopes?.length ? [`Missing scopes: ${connection.missingScopes.join(", ")}`] : []),
    `Slack triggers: ${reading}`,
  ].join("\n");
}

/** Runs one `hui slack` action and returns the exit code: status exits 1 unless Slack accepts the token. */
export async function slackCommand(base: string, action: string, flags: { json?: boolean }, io: SlackIO): Promise<number> {
  const { request } = await import("./bots.ts");
  const print = (connection: SlackConnection, text: string) => io.out(`${flags.json ? JSON.stringify(connection) : text}\n`);
  switch (action) {
    case "connect": {
      const token = (io.interactive ? await io.readHidden("Slack User OAuth Token (xoxp-…, hidden): ") : await io.readStdin()).trim();
      if (!token) throw new Error("No token: paste your Slack app's User OAuth Token at the prompt, or pipe it on stdin.");
      const connection = await request<SlackConnection>(base, "/__hui/slack", { method: "PUT", body: { token }, timeoutMs: 30_000 });
      print(connection, `${connection.message} The token is saved on the gateway's machine only (~/.config/hui/slack.json).`);
      return 0;
    }
    case "status": {
      const connection = await request<SlackConnection>(base, "/__hui/slack?verify=1", { timeoutMs: 30_000 });
      print(connection, formatSlackConnection(connection));
      return connection.status === "connected" || connection.status === "missing_scopes" ? 0 : 1;
    }
    case "disconnect": {
      const connection = await request<SlackConnection>(base, "/__hui/slack", { method: "DELETE" });
      print(connection, "Slack disconnected: the token was removed from the gateway's machine. Slack triggers read nothing until you connect again.");
      return 0;
    }
    default:
      throw new Error("Unknown command. Run hui --help.");
  }
}
