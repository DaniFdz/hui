/**
 * What the catalogue deliberately leaves out, each with its reason: collected surfaces no screen uses (`NOT_UI`), and
 * Part 2 sections of SPEC.md that define no user outcome of their own (`SPEC_EXEMPT`).
 */

export const NOT_UI: Readonly<Record<string, string>> = {
  "setting:vscode.enabled": "Kept so older settings files load and save unchanged; the VS Code launcher is always available, so nothing reads or shows it (SPEC.md#vs-code).",
  "route:GET /__hui/api-schema": "Serves the gateway's JSON Schema to tools and clients; no screen reads it.",
  "route:GET /__hui/bots/:id": "The browser reads bots from the list and its stream; only the CLI and agents read one bot.",
  "route:GET /__hui/bots/:id/memory": "Read by `hui bot memory`; the panel no longer has a Memory tab.",
  "route:GET /__hui/bots/:id/memory/html": "Read by `hui bot memory`; the panel's Open memory page link was removed.",
  "route:GET /__hui/bots/:id/memory/zoom": "Read by `hui bot memory`; the panel no longer has a Memory tab.",
  "route:GET /__hui/bots/:id/soul": "Only `hui bot soul` reads SOUL.md; the panel no longer shows it.",
  "route:PUT /__hui/bots/:id/soul": "Only `hui bot soul` replaces SOUL.md; the panel no longer edits it.",
  "route:POST /__hui/bots/:id/messages": "For the CLI and other callers; a bot's composer sends through the session prompt route.",
  "route:POST /__hui/bots/:id/stop": "For the CLI; Stop in a bot's chat uses the session's stop route.",
  "route:GET /__hui/providers/:provider/quota": "Settings → Models reads quota per account; no screen asks for the provider-wide figure.",
  "route:GET /__hui/sessions/:id/thinking": "The thinking level arrives in the session stream's snapshot and frames; no screen reads it separately.",
  "route:GET /__hui/sessions/:id/events": "The browser streams a session over the WebSocket that POST /connect opens; this server-sent events route is for other clients.",
  "route:GET /__hui/sessions/:id/attachments/:message/files/:file": "File attachments carry this address, but their card renders no link, so no screen opens it.",
  "route:GET /__hui/sessions/:owner/terminals/:id": "The terminal view replays over its WebSocket and the agent's terminal tool calls the terminal manager directly; no screen calls this route.",
  "route:HEAD /__hui/media/:id/:name": "For probes and tools; the media players fetch with GET and byte ranges.",
  "route:HEAD /__hui/widget-sandbox": "For probes and tools; the widget frame loads the page with GET.",
};

export const SPEC_EXEMPT: Readonly<Record<string, string>> = {
  "why-this-is-now-possible": "Background for Part 2; it describes no behaviour of its own.",
  "ownership": "Who owns which state; the behaviour it implies is cited by the sections it governs.",
  "decisions": "The decision log; use cases cite individual decisions instead.",
  "explicitly-out-of-scope": "Lists what HUI does not do.",
  "desktop-distribution": "Installing and launching the Electron app; npm run test:package covers it.",
};
