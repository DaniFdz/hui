/**
 * HUI tools that act on the gateway's machine: the shared terminal's PTYs and watchers' processes live where the
 * gateway runs. A session on a remote worker reaches HUI's tools through the gateway's bridge (`workers.ts`), which
 * refuses these; a bot's chat on a worker isn't offered them at all (the worker host's `DurableHost` gets this list as
 * `gatewayOnlyTools`), so its model never calls them, `request_access` can't ask for them and its Tools & skills page
 * doesn't list them. One list for both, so they can't drift. The managed browser is not one of them: a host runs its
 * own (`host.ts`, announced as `HOST_BROWSER_FEATURE`), as the gateway runs the browser of the sessions on its
 * machine, and its tabs stay there. `secret_request` is not one either: its card is answered on the gateway, but its
 * file is written where the session's commands run, so a worker host asks with its own `secret-request` and a bot's
 * chat there keeps the tool.
 */
export const GATEWAY_ONLY_TOOLS: readonly string[] = Object.freeze(["terminal", "watcher"]);

/** What `hello` lists when the host runs a managed browser of its own for its sessions (`browser`). A gateway refuses
 * browser calls from a host without it, which predates a browser that runs where the session does. */
export const HOST_BROWSER_FEATURE = "browser";
