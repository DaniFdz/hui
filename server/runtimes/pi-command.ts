import { fileURLToPath } from "node:url";

/** The package carries a compatible PI CLI; global PATH installations must not
 * silently change package management or rollback behavior. */
export function piCommand(args: readonly string[], override = process.env["HUI_PI_CLI"]): { command: string; args: string[] } {
  if (override) return { command: override, args: [...args] };
  const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  return { command: process.execPath, args: [cli, ...args] };
}
