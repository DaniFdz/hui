/**
 * `hui browser cookies import`: the login another browser exported, handed to the running gateway's
 * `POST /__hui/browser/cookies`. The CLI never reads, opens or resolves the path it is given: it sends the operator's
 * argument exactly as typed, so the route is the one owner of what a cookie file may be and of every refusal (a
 * relative path, `-`, a directory, a missing or oversized file, a malformed export), and the sentence it prints is
 * the gateway's own, which only counts cookies and names domains — never a cookie's name or value.
 */
import type { BrowserCookieImportReport } from "../server/api/browser.ts";
import { BROWSER_IMPORT_NEEDS_FILE } from "./commands.ts";
import { request } from "./gateway-client.ts";

/** The import, once: what the gateway did, printed as its message or as its JSON report. A refusal throws
 * `GatewayError`, which the bin wrapper prints with exit code 1. */
export async function browserImportCommand(base: string, operands: readonly string[], flags: { json?: boolean }, io: { out(text: string): void }): Promise<number> {
  const [file] = operands;
  if (file === undefined || operands.length !== 1) throw new Error(BROWSER_IMPORT_NEEDS_FILE);
  const report = await request<BrowserCookieImportReport>(base, "/__hui/browser/cookies", { method: "POST", body: { path: file }, timeoutMs: 30_000 });
  io.out(`${flags.json ? JSON.stringify(report) : report.message}\n`);
  return 0;
}
