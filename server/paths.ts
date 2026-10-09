/** Where HUI keeps its own state, following XDG. `HUI_CONFIG_DIR` replaces
 * the whole directory (a worker host points it at its mirror of the gateway's)
 * without changing `XDG_CONFIG_HOME` for the agent's own shells. */
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = process.env["HUI_CONFIG_DIR"]
  || (process.env["XDG_CONFIG_HOME"] ? join(process.env["XDG_CONFIG_HOME"], "hui") : join(homedir(), ".config", "hui"));

export const USER_THEME_DIR = join(CONFIG_DIR, "themes");

/** Uploaded files are stored here and handed to the agent as paths, so an
 * upload never has to be inlined into a prompt or written into the user's
 * working directory. */
export const ATTACHMENTS_DIR = join(CONFIG_DIR, "attachments");

/** Immutable, opaque media artifacts explicitly published by an agent for the
 * current conversation. The random directory name is also the browser-facing
 * capability token; no local filesystem path is exposed to the browser. */
export const PRESENTED_MEDIA_DIR = join(CONFIG_DIR, "presented-media");

/** Git worktrees explicitly created from New Session. Their repositories and
 * branches remain user-owned; HUI only chooses an isolated checkout path. */
export const WORKTREES_DIR = join(CONFIG_DIR, "worktrees");

/** The managed browser's own Chromium user-data directory. Agents' cookies and
 * logins persist here; it is never the operator's personal browser profile. */
export const BROWSER_PROFILE_DIR = join(CONFIG_DIR, "browser", "profile");

/** The VS Code view's openvscode-server: its server data, user data and
 * extensions, the connection-token file of the running server and its pid. */
export const VSCODE_DIR = join(CONFIG_DIR, "vscode");

/** openvscode-server releases HUI downloaded for the VS Code view on a Linux machine with no VS Code: one directory
 * per version and architecture, removable from Settings → Tools → VS Code. */
export const VSCODE_SERVER_DIR = join(CONFIG_DIR, "vscode-server");

/** HUI owns scheduled task definitions and their bounded run history. */
export const AUTOMATION_FILE = join(CONFIG_DIR, "automation.json");

/** HUI-owned background watchers: one registry, and one log and exit record
 * per watcher under the watchers directory. */
export const WATCHERS_FILE = join(CONFIG_DIR, "watchers.json");
export const WATCHER_LOG_DIR = join(CONFIG_DIR, "watchers");
