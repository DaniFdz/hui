# Session API contract

The interface between the backend and the browser. Change it deliberately: it is
the seam the whole app is built across.

All routes live under `/__hui/` and require the `x-hui: 1` header. Expected
client errors use `{ "error": "message worth showing the user" }` with a 4xx
status; storage/backend failures use the same shape with 500.

## Desktop shell boundary

The Electron renderer uses the same HTTP/SSE contract. Its main process invokes
`hui gateway start --json` through the recorded Node installation and accepts a
running gateway address only after the existing CLI identity checks. It uses
that gateway's origin rather than exposing control credentials to the renderer.
Window close and application quit do not stop the shared gateway. Existing
stop/restart/update busy-work checks remain unchanged; no desktop HTTP endpoints
or alternate persisted gateway state are introduced.

## Gateway lifecycle boundary

The standalone production gateway and Vite development plugin share the same
`/__hui/` middleware. Production serves compiled `dist/` assets with GET/HEAD,
safe route fallbacks (single-segment page routes such as `/skills` or `/kanban`,
plus `/sessions/…`, `/bots/…` and `/settings/…` deep links) and realpath containment; it never serves source files or
escaping symlinks. Requests must use an allowed Host (loopback, the selected IP,
its explicitly resolved Tailscale DNS name, or a name granted with `--allow-host`
or `HUI_GATEWAY_ALLOWED_HOSTS`, or listed in `allowHosts` of `gateway/config.json`). A proxy that connects over loopback but answers
on a name of its own, such as `tailscale serve`, is the case that needs one;
unusable entries are refused rather than silently ignored. The default production
port is
4173. The CLI accepts `HUI_GATEWAY_HOST` / `HUI_GATEWAY_PORT` as validated
start/run/restart defaults, including when invoked by Electron. Explicit CLI
flags take precedence; without configured defaults, restart preserves its prior
binding. These defaults do not alter state/control/update commands or introduce
new HTTP routes. Startup/shutdown gates return 503 while the backend is unavailable.

The installed CLI controls a **separate loopback-only listener**, not a browser
API route. Private `GET /status` and `POST /stop[?force=1]` require a random
bearer token stored in mode-0600 `$XDG_CONFIG_HOME/hui/gateway/state.json`
(default `~/.config/hui`). Replies bind instance identity, PID and version.
Neither the public health route nor `hui gateway status --json` reveals the
control URL or token. No shutdown route is added to `/__hui/`.

Normal stop returns 409 while turns, questions, follow-ups or HTTP mutations are
active; worker sessions that are `reconnecting` or `disconnected` run on their
worker and count only for the follow-ups HUI holds for them. Forced stop explicitly interrupts work. CLI lifecycle operations are
serialized, refuse unauthenticated live PIDs and wait for the old process to
exit before replacement. `gateway.log` is private and receives the gateway's
stderr, including one line per Logs entry (see `GET /__hui/observability`); the
CLI reads a bounded tail.
Restart does not migrate or delete HUI registries, settings or PI transcripts.

Local archive updates stage and health-check a release against disposable state
before switching a per-installation pointer under
`$XDG_DATA_HOME/hui/updates/<installation-hash>/current.json` (default
`~/.local/share/hui/updates`). The pointer has its own versioned lifecycle format,
separate from all session contracts. Activation failure restores the old pointer
and running gateway; explicit rollback can use the original installed CLI even
if the selected release is broken. GitHub release downloads use unauthenticated,
bounded fixed-repository API reads, stable tags and a mandatory
SHA-256 sidecar. See README for install, trust and host-management limits.

### Browser updates

The browser owns no package, process, token or filesystem access. These guarded
routes expose `UpdateSnapshot` from `src/lib/update-types.ts`:

| Route | Behavior |
| --- | --- |
| `GET /__hui/update` | Running package version, last in-process check and latest updater receipt; no remote request |
| `GET /__hui/update/check` | Background discovery; use the gateway's one-hour in-memory check cache, shared across browsers |
| `POST /__hui/update/check` | Check latest stable GitHub release; never install or restart |
| `POST /__hui/update` | Accept only `{ version: "x.y.z" }` matching an installable check; return 202 after detached updater starts |

Malformed input returns 400; absent/stale checks, active sessions a restart
would interrupt, or concurrent operations return 409. Pi Durable runs do not
block an update; they resume on the new gateway. The browser cannot supply a
URL, file path, force flag, CLI command or credentials. Development mode and externally managed installs
remain read-only. Missing/inaccessible releases are not reported as current.
The background route caches both successful and unavailable check results for
one hour; it skips remote discovery while an updater is starting or running.
Concurrent checks share a single remote lookup. Explicit POST checks bypass
cache freshness and refresh that same cache. GET responses retain the existing
no-store HTTP behavior; the gateway alone owns freshness. Development servers
return their source-managed result without contacting GitHub.

The UI requests background discovery on opening and hourly while visible and
online, pausing while an update dialog is open. Focus, visibility and online
events resume an overdue check without triggering a request on every event.
Errors stay silent outside the explicit dialog. A newer version shows a
non-modal **Review update** banner; the action creates or opens the dedicated
**HUI update** session in **OTHER**, retains `/update` in its composer, and
rechecks using the existing dialog without creating a model turn. Dismissal is
version-specific in page memory only. Running jobs and an already-installed
version suppress stale offers. No automatic installation or host timer exists.

The worker re-resolves and pins the checked version, serializes with all CLI
lifecycle operations, verifies both assets, probes, then rechecks active work
atomically before stopping the gateway. A turn started during staging therefore
prevents activation. Original installation identity travels over private IPC,
not by changing the existing gateway state-file format.

An operational `job.json` receipt beside the installation's release pointer
survives gateway replacement and contains status/version/message, never session
content or credentials. A dead worker is an explicit failure, not success.
The UI polls while open, tolerates the restart disconnect, and offers Reload HUI
only after confirmed success at the expected running version. Closing the dialog
does not cancel the transaction; the retained `/update` draft reopens its
status. The dedicated HUI update session is persisted in the HUI registry, but
no `/update` prompt or synthetic message is written to the PI transcript.

`/update` is reserved by the composer, separate from `RuntimeCommand`. It is
available without catalog discovery or an initial prompt; opening its dedicated
session starts only the idle runtime needed to make the session resumable. The
prompt, steer and follow-up routes reject it (including invalid arguments)
rather than sending it to PI. `/update --check` never presents an install
action.

## Durable runtime binding

The browser never connects to the harness either. New sessions use the
`durable` runtime: one Pi Durable harness inside the gateway, over the SQLite
store `~/.config/hui/durable/harness.sqlite` (`HUI_DURABLE_DIR` overrides the
directory). A lock file refuses a second gateway on the same store; Durable has
no cross-process locking of its own. Each HUI session is one Durable
conversation and stores `durable:<conversationId>` in `piSessionFile`.

Opening the store resumes every unfinished run, once the gateway has reopened
the sessions that own them and they have loaded their PI extensions again
(`DurableHost.beforeResume`, at most 30 seconds), so a resumed tool call finds
its tool. A gateway restart therefore
does not interrupt Durable work: the run continues, an interrupted tool call is
reported to the model as interrupted (never rerun), and HUI's recovery prompt is
not used (`RuntimeSession.resumesInterruptedRuns`). Prompts, steering and
follow-ups are Durable inbox submissions. Rewind forks the conversation at the
chosen point and stores the fork's reference; the earlier conversation is kept. `/skill:name` and
prompt templates expand as in PI. HUI tools run in the gateway process and reach
the agent-tool handler directly with the conversation's bound HUI session,
falling back to the registry after a restart. Usage totals read Durable's
per-conversation spend. `HUI_SESSION_RUNTIME=pi` creates new sessions on the
PI worker described below.

Each session loads its PI extensions (`server/runtimes/durable-extensions.ts`):
the set the PI worker would load, with the same plugin policy, as fresh
instances driven by PI's `ExtensionRunner` in the gateway. Their tools and
hooks form one Durable extension, `pi:<HUI session id>`, that only the session's
conversations select; the harness's default selection is HUI's own extensions,
and a session without PI extensions selects nothing more. Durable's hooks carry
`tool_call` and `tool_result` (tool task), `context` (generation
`beforeRequest`) and `session_before_compact` (compaction task); the request's
provider callbacks carry `before_provider_request` and `after_provider_response`;
the session's event stream carries the lifecycle events, one at a time and in
PI's order (a run's start before the prompt that began it), and the session
reports `settled` only after its extensions' `agent_end` and `agent_settled`
handlers ran, or after 30 seconds with a `notice`; until then the session is
still busy for HUI, while its extensions see the run over. Prompts pass
`input` handlers, then skill and template expansion, then
`before_agent_start`; the prompt request returns once the input is submitted or
a handler first asks something, as for PI sessions. The session is not running
until the input is submitted, and Stop meanwhile sends nothing.
`session_start` holds a session's opening only until it ends or first asks
something. Each lifecycle handler's `ctx.signal` is the signal of the run its
event belongs to, aborted by Stop. An extension command runs when sent as `/name` (or the
`$name` alias); its prompt request returns once it ends or first asks
something. Dialogs are `question` events answered through the question routes,
and Stop dismisses them; `notify` is a `notice`. `ctx.sessionManager` is an
in-memory PI session projected from the history. `appendEntry` data is stored
as a `hui.pi-entry` entry. A custom message is a `hui.pi-message` entry the
model reads as user input, written before the prompt `before_agent_start` added
it to (PI places it after), so a rewind to before that prompt leaves it out too;
one that starts or steers a turn is input whose text part carries its
`customType`. The transcript leaves both out, as for PI sessions. Load errors and handler failures appear in the session's tool
inspection `diagnostics`; handler failures are also `notice`s.

`hui doctor --fix` moves a PI session into a new conversation
(`server/runtimes/pi-import.ts`) with the gateway stopped. One commit writes the
active branch's entries, the spend HUI totalled for the PI file into
`pi.usage`, and a store-wide `hui.pi-import` document keyed by the HUI session
with the conversation, source path and file digest, so a rerun reuses the copy.
PI's `context_edit` entries become `hui.context-edit` entries that carry only
Durable edits. The registry record then switches to `durable:<conversationId>`;
the PI file is never changed.

The transcript is the conversation's whole fork-aware history since its latest
reset (`/clear`), so compaction never hides a message. It is read from the
store in pages that yield to the event loop: all of it when the session opens,
then only entries past the newest one read, after each run and compaction. Each
message carries its Durable entry ID (`entryId`, the rewind target), and each
summary is a `compaction` entry where Durable placed it, its wrapper removed.
`tokensBefore` and the context meter use Durable's own context estimate: the
newest answered request after the latest summary or reset, plus estimates of
what follows it.

Compaction is Durable's own, with Durable's semantics where they differ from
PI's. `/compact [focus]` and **Compact now** start its compaction task
(`Conversation.compact`). The harness also compacts by itself with PI's
`compaction` settings: in the background from 32,768 tokens (Durable's
`backgroundTokens`) below `contextWindow - reserveTokens`, blocking above that
threshold, and after a context overflow, always keeping `keepRecentTokens`
verbatim.

- Only a blocking compaction (the threshold one above the line, or an overflow
  one) holds anything: its own run waits for the summary, and input meanwhile
  joins Durable's inbox as in any run.
- A manual or background compaction runs beside the conversation
  (`compaction_start` with `blocking: false`), and the session stays `idle`
  apart from its runs. Input is never held: a prompt starts a run at once, and
  a steer sent with no run to steer starts one as a prompt. Durable places the
  summary at once when the conversation is idle, otherwise at the run's next
  boundary.
- A manual one is cancelled alone with `DELETE /__hui/sessions/:id/compact`
  (Durable's `abortTask`), the divider's **Cancel compaction**. Stop during a
  run cancels it too, as `Conversation.abort()` cancels the conversation's
  ordinary scope, and resolves once Durable reports that work ended. A
  background one (`background: true`) is Durable's own and survives both.
- One compaction runs at a time: `/compact` returns 409 while one runs.
- Each reports a `compaction_end` built from the task's receipt: `done`,
  `cancelled`, or `failed` with Durable's reason. A requested compaction with
  nothing old enough to summarize reports PI's "Nothing to compact (session too
  small)". A summary placed while no turn is in flight shows at that end,
  without a settle; otherwise the turn's settle shows it.
- A rewind or `/clear` may run while a background compaction works. A reset
  makes its summary stale, so Durable drops it and HUI reports nothing for it;
  after a fork it finishes on the abandoned branch.
- A compaction already running when a session opens (Durable resumes it after a
  restart) is reported to each new subscriber.
- Extensions get `session_compact` when a summary entry is placed, with that
  entry; a compaction that places none (declined, nothing to summarize, or
  dropped as stale) sends none. An extension's `ctx.compact()` waits for its
  own task's summary, at the run's next boundary if a run is going, and calls
  `onComplete` with that entry or `onError` once with why it was not placed.
  `/clear`, `/reload`, a rewind or closing the session ends a pending one with
  "Compaction cancelled". These go beside the gateway's own compactions and
  bypass the 409 above. Unlike PI, completion callbacks do not wait for queued
  `session_compact` handlers. The projection retains Durable's summary wrapper
  and reports `tokensBefore: 0`. After a stream gap, `fromExtension` can be false
  when the summary's originating compaction cannot be recovered from its entry;
  the summary and callback correlation still use the actual placed entry.

## PI process binding

The browser never connects to PI. The long-lived HUI gateway owns one isolated
PI SDK worker per active HUI session and speaks PI's newline-delimited RPC JSON
over that child's stdin/stdout. A cold open starts PI with the stored
`piSessionFile`, calls `get_state` and `get_entries`, and then streams normalized
events to the browser through this HTTP API. Gateway restarts discard child
processes but not PI conversation files; the next open resumes them.

The worker's command line is only its script path. Launch settings such as the
working directory, transcript and model travel in the private
`HUI_PI_WORKER_LAUNCH` environment variable, removed before PI, extensions or
tools start: endpoint security agents can SIGKILL a script launch whose working
directory plus one argument reaches `MAXPATHLEN` (1024 bytes).

The worker pins `@earendil-works/pi-coding-agent@1.0.1` and uses its public
`runRpcMode`. `HUI_PI_BACKEND=cli` opts into the previous adapter;
`HUI_PI_CLI` optionally pins its executable (otherwise HUI runs the bundled SDK
CLI with Node, without relying on a global `pi` or npm's PATH). PI package
install/remove uses the same resolver. Backend selection is process configuration, not a
persisted session format change. Running sessions never switch automatically.

HUI does not implement an agent selector or approval queue. PI runs with the
user's installed configuration in Full Access, and HUI does not insert a tool
allowlist, sandbox toggle or approval interception layer.

HUI resolves PI's agent directory using `PI_CODING_AGENT_DIR` (PI's canonical
override), then the legacy-compatible `PI_AGENT_DIR`, then
`$PI_CONFIG_DIR/agent`, and finally `~/.pi/agent`.

### `GET /__hui/pi`

Returns a redacted, read-only projection of PI settings, model defaults, the
credential-filtered model catalog, configured packages/extensions, tools and
skills. Credential values, URL userinfo and signed query strings are never
returned. When the short-lived catalog cache expires, the model catalog is
obtained through a single-flight ephemeral worker with an in-memory session,
empty resource settings and extensions/skills/context disabled, so concurrent
reads share one probe and it neither creates a transcript nor executes
workspace/package code or installs packages. CLI fallback probes use the legacy
`--no-session --no-extensions --no-skills --no-context-files` flags.

The `tools` field reports shipped PI/HUI definitions (`kind: builtin | hui`), not
configured packages. Package labels remain under `settings.packages` and
`settings.extensions`; `settings.resources` pairs each safe label and kind with
an opaque stable id. Raw sources, credentials and signed queries remain server-only.
Each skill also has an opaque stable `id` for the reader route; its existing path
remains informational and is never accepted back as a read target.
HUI-bundled skills add `origin: "hui"`, `tags: ["good practices"]` and
`preferencePath` (for example `hui:skill:create-verification-skill`). The physical
`path` is still the readable file; `preferencePath` is the stable opt-out key.
The inventory includes HUI defaults even when PI has no configured skills and
even when the default is disabled. It does not add them to PI's configured roots.

### `GET /__hui/pi/resources/:kind/:id`

Reads one resource already present in the current PI inventory. `kind` is
`skill` or `plugin`; `id` must be the 24-character opaque id returned by
`GET /__hui/pi`. Skills return their `SKILL.md`. Plugins return a package's
top-level README (falling back to `package.json`) or a direct extension's source
file. The response is `{ id, kind, title, fileName, format, content, truncated }`,
where `format` is `markdown`, `code` or `json`.

The route does not load extension code, install missing packages, or accept a
filesystem path. It re-reads PI settings and rejects stale/unknown ids with 404.
Text is bounded to 256 KiB; `truncated` reports when the source was larger.

### `GET /__hui/tools`

Returns the global `ToolsCatalog` from `src/lib/tools-types.ts`: selected backend,
pinned SDK version, shipped tools (`name`, `description`, `source`,
`defaultEnabled`), redacted configured global sources, diagnostics and the HUI
base prompt text/revision. It requires no session, model or credentials and runs
no extension/package discovery. Default-enabled is not a live availability claim;
workspace settings and extensions may change it. The CLI has its own defaults.

### `GET /__hui/sessions/:id/tools`

Returns `SessionTools` without opening or starting a session:

- `status: cold` when no initialized runtime exists (including during startup).
- `status: unsupported` when the running adapter cannot inspect itself (CLI).
- `status: live` with backend/version, content-derived revision, registered tool
  names/descriptions/schemas/source categories/active flags, current assembled
  prompt, base prompt provenance and load/model diagnostics. Tool registration
  and activation are read afresh on each request; there is no catalog cache.

Unknown session IDs return 404, worker errors/timeouts/malformed payloads return
502. Inspection IPC uses protocol version 1, a 5-second deadline and a 2 MB
response limit, with pending calls released on exit/disposal. Effective prompt
text may contain private workspace instructions; it is only returned by this
explicit guarded request, not diagnostic exports. Before the first turn it is
the initialized base composition; after a turn it includes extension changes.
The `promptPhase` distinguishes `initialized`, `current-turn` and `last-turn`.
PI clears turn overrides at settlement, so HUI retains the last observed turn
composition in memory; after a worker restart it explicitly reports initialized
state until another turn runs. Prompt edits on disk require runtime reload/reopen.

### Model catalog selection

Both this catalog and the live session model picker first apply HUI-managed
provider selections (exact IDs; an empty list selects nothing), then apply the
operator's PI `models.json` selection to the remaining providers, using the same
rules as the `model-name` extension:

- Only providers present in `providers` are included.
- A provider's explicit non-empty model list selects exact IDs, including `/`
  inside an ID. Entries without string IDs are ignored.
- A missing/empty list, or one without any string IDs, includes that provider's
  whole available catalog. An empty `providers` object selects nothing.
- A missing, unreadable or malformed file/structure leaves the available catalog
  unfiltered. HUI never writes this file or returns its transport/auth fields.

PI's RPC still determines availability: unlike the extension's `getAll()`, HUI
does not add models that PI's `get_available_models` omits for missing credentials.
These rules limit choices, not permissions, and do not switch an existing session.
`enabledModels` remains PI's independent Ctrl+P cycling configuration. New Session
keeps a selected/default model only if it is in the returned catalog, otherwise
chooses its first entry. With no catalog it retains PI-default startup behavior.
Model search matches all whitespace-separated terms across display name, provider,
ID and full `provider/id` reference, case-insensitively.

### HUI-managed model providers

Settings → Models owns built-in connections separately from PI custom providers.
The add-provider modal offers OpenCode Go, OpenAI (ChatGPT account or API key),
and Claude (Pro/Max or API key). The generic routes retain
existing providers for backwards compatibility; custom setup UI is deferred.
Only added connections have cards. Unauthenticated cards expose sign-in only;
authenticated cards load quotas independently and keep model lists collapsed.
All routes retain the `x-hui` guard and `no-store` responses. Metadata never
includes saved credentials; a login response may contain a short-lived device
code, sign-in URL and input prompt for this local user's active login.

| Route | Contract |
| --- | --- |
| `GET /__hui/providers` | Built-in names, supported login methods, configured/auth-available flags, selected IDs, model context/output limits, active login state; ordered `accounts` with opaque ID, fallback name, optional display-only email, auth availability and optional epoch-ms `cooldownUntil` |
| `POST /__hui/providers/:provider/login` | `{ method: "api_key" or "oauth", name?: string, accountId?: string }`; a new account by default, or reconnect exactly `accountId`; starts PI's provider-owned login; returns opaque login ID and pending state |
| `POST /__hui/providers/login/:id` | `{ promptId, value }`; responds to the exact current prompt; never echoes the value |
| `DELETE /__hui/providers/login/:id` | Cancels a pending login |
| `PUT /__hui/providers/:provider` | `{ models: string[] }`; validates exact catalog IDs and atomically saves the deduplicated selection; empty explicitly disables all models for this provider |
| `DELETE /__hui/providers/:provider` | Removes this HUI selection and all its accounts/credentials; PI config/auth is untouched |
| `PUT /__hui/providers/:provider/accounts` | `{ order: string[] }`; must contain every existing account ID exactly once; durable priority order |
| `DELETE /__hui/providers/:provider/accounts/:account` | Removes only that account/credential; keeps other accounts and the shared model selection |
| `GET /__hui/providers/:provider/accounts/:account/quota` | Account-specific quota with the same response shape below |
| `GET /__hui/providers/:provider/quota` | `{ status, checkedAt, windows, plan?, email?, access?, message? }`; status is `available`, `unsupported` or `unavailable`; windows contain measured `usedPercent`, `scope` (`account`, `scoped`, `spend`) and optional epoch-ms `resetAt` |

Credentials use PI's locked auth storage at `$XDG_CONFIG_HOME/hui/providers/auth.json`
(default `~/.config/hui/providers/auth.json`, mode 0600). Selections use a separate
0600 `models.json` mapping provider IDs to `{ models: string[] }`; writes are
serialized and atomic. Account order, names and optional `cooldownUntil` are a
0600 `accounts.json` mapping provider IDs to ordered account arrays. The legacy
`auth.json` remains in place as account `default` (fallback label Account 1); new accounts
use `accounts/<opaque-uuid>/auth.json`, with PI's locks/refresh, never raw secrets in
metadata. Existing model selection and auth formats remain readable unchanged.
Names are 1–80 characters; at most 20 accounts per provider. Cancelled/failed new
logins do not replace existing credentials or enter the priority list.
This is HUI state, not a migration of PI files. PI custom
endpoints, transport options and credentials remain configured through PI.
A built-in explicitly added to HUI takes precedence over a PI provider of the
same ID. Removing it reveals the PI configuration again, if present.

Login permits one pending flow, expires after ten minutes and rejects stale
prompt IDs. Prompt values are bounded to 16 KiB. Completing login stores auth;
the browser then calls `PUT` with the existing selection or an empty list to
add the connection. If that separate write fails, sign-in remains saved and the
modal offers **Use this connection** to retry. **Save models** in each card
commits its dropdown selection. Auth availability means
credentials are configured, not that a live request or subscription is verified.
Models expose the pinned SDK's catalog metadata, not invented limits or aliases.

The SDK composes these connections into ordinary PI sessions, including utility
and safe catalog probes. New sessions pick up the connection; reopen existing
runtimes after changing credentials/provider registration. Selection filtering is
re-read for model-picker requests. CLI fallback remains available for PI-owned
configuration; when HUI-managed PI connections exist it explicitly requires the SDK rather
than silently using a different account. No transcript format changes.

Within an already managed provider, account order and cooldowns are re-read for
each SDK request. Credentials are pinned per async request across OAuth refresh;
parallel sessions never change a shared active key. Both `stream` and
`streamSimple` (including their completion helpers) route accounts. SDK request
retries are disabled for these calls so rotation is bounded to one attempt per
ready account. A 429 or explicit quota/usage-limit error before content triggers
the next account; no replay after content/thinking/tool events, on Stop, auth or
server/network errors. Exhaustion is an explicit error, not a retry loop.
`Retry-After`/`retry-after-ms`, or a Codex-reported retry time, determine cooldown;
without them HUI retries the account after 60 seconds. Account quota reads can
extend cooldown to the reported reset of an exhausted global window, but never
block a whole account for a model-specific Sonnet/Opus window. Reset re-enables the
highest-priority account on the next request. Existing in-flight requests retain
their account; removal/order changes affect subsequent requests. PI-owned custom
providers and cross-provider fallback are outside this policy.

Quota requests use fixed first-party HTTPS endpoints for Anthropic and OpenAI
Codex OAuth accounts and OpenCode Go API keys saved in HUI, disable redirects, bound response size/time,
and cache/coalesce for one minute. Tokens refresh through PI's locked HUI auth
store. Other API-key accounts and providers without a supported quota API explicitly
report unsupported; malformed/missing windows and failures are unavailable,
never inferred zero usage. Partial decoding retains readable periods and reports a
warning. Values above 100% are retained (the visual meter saturates at 100%).
`plan` is the provider-reported plan type, when present; `access` is reported
usage availability (`available`/`limited`) or a currently exhausted account-wide
window, not billing status. No active subscription, renewal or expiry is inferred.
All windows are visible: Codex primary/secondary and other reported periods,
code-review and additional model limits, monthly credit budgets; Claude period
windows, scoped `limits` entries and enabled monthly extra usage. Only `account`
windows affect account cooldown; scoped and spend budgets never disable unrelated
models. Missing reset times are explicit. Monthly budgets without readable usage
remain unavailable, not zero or unlimited. No persisted format changes.
OpenCode Go reads `/zen/go/v1/usage` on `opencode.ai`, retaining its rolling
5-hour, weekly and monthly percentages (already 0–100) and reset dates. Only the
requested HUI account's key is used, never ambient credentials. An HTTP failure
(including 403, which can mean no Go subscription) remains unavailable; HUI does
not infer a billing state or an email from an API key.

Codex `accounts[].email` is derived locally from the OAuth token's profile/email
claims; quota responses can also include the refreshed email. Claude quota reads
add a best-effort bounded `/api/oauth/profile` request and return its reported
`email`. Profile and usage failures are independent. Only the validated email is
exposed, never tokens or other profile fields. The UI prefers the reported email
to the fallback name. Identity is display-only, not JWT authorization or a dedupe
key; same-email subscriptions retain separate opaque account IDs. No email is
persisted and existing connections need no migration/re-login.

This does not aggregate per-session token estimates.

PI is the only session runtime. The native Claude Code CLI provider
(`claude-code`) was removed; its routes reject that ID like any unknown provider.

### PI package and skill mutations

All mutation requests are serialized; a concurrent request receives `409`.
Input errors receive `400`, and a PI command/agent failure receives `502`.
Every successful response contains `{ kind, target, message, snapshot }`, where
`snapshot` is the refreshed `GET /__hui/pi` shape.

`POST /__hui/pi/packages/install` accepts `{ "url": "https://pi.dev/packages/<package>" }`.
Only clean HTTPS catalog URLs without credentials, query strings or fragments
are accepted. HUI derives the npm source and invokes PI's own `install` command.

`POST /__hui/pi/packages/remove` accepts `{ "source": "<browser label>" }`.
The label must resolve to exactly one currently configured raw package source;
HUI then passes that exact source to PI's own `remove` command. Extensions that
were configured directly rather than as packages remain inventory-only.

`POST /__hui/pi/skills/install` accepts `{ "url": "https://..." }`. HUI starts
a short-lived PI process with no session, context files, extensions or existing
skills, minimal thinking and a low-cost catalog model. It refuses to fall back
to an expensive default when no low-cost candidate is present. The optional
`HUI_SKILL_INSTALL_MODEL` environment variable pins the installer model. The
request succeeds only when the refreshed PI inventory contains a new skill
path. Output is bounded and credential-shaped URL material is redacted.
All HUI-launched PI processes, including extension-free utility and installer
workers, receive `PI_CLIENT_SESSION_ID` for provider header interpolation. An
explicit nonblank environment value is preserved; otherwise each process gets
a fresh UUID without changing the gateway environment or creating a transcript.
Durable sessions run inside the gateway, so each of their model requests gets it
from the request instead: the gateway's explicit value, otherwise a fresh UUID
per HUI session for each gateway run.

Resource enablement is HUI-owned rather than a PI mutation. `GET /__hui/settings`
and `PUT /__hui/settings` include `disabledSkills`, a normalized array of
`{ "name", "path" }` identities, and `disabledPlugins`, containing opaque
`{ "id", "name", "kind" }` package/extension identities. Disabling keeps PI's
files and configuration untouched and applies when a HUI PI runtime next starts.
The SDK worker filters packages and direct extensions from a process-local
settings view before PI discovers resources, so their executable code and
bundled skills/prompts never load. Durable sessions load extensions, skills and
prompts through the same filtered view. Individual disabled skills are removed before
prompt and command assembly. Existing live runtimes are not killed or restarted.
When `HUI_PI_BACKEND=cli`, an active plugin policy fails startup explicitly rather
than silently loading disabled code.

For a bundled skill, write its `preferencePath` into the existing
`disabledSkills[].path` field; ordinary PI skills continue to use their path.
Both SDK and CLI start with enabled HUI defaults appended after PI-discovered
skills, so PI's same-name user/project/package resources take precedence.
Disabling a HUI default excludes only that fallback, not a same-name override.
An empty opt-out list enables the default without writing PI configuration.
Read-only catalog probes never load bundled skills.

The same settings document includes `models: { primary, fallback, utility }`.
Each non-empty value is a canonical `provider/id` from PI's filtered catalog.
Primary is the default for new sessions; fallback is an automatic one-time retry
when a primary turn fails before text, thinking, or tool activity; utility is a
cheap, fast, tool-free route for generated session titles and `/btw`. Example:

```json
{ "models": { "primary": "openai/gpt-6-astra", "fallback": "anthropic/claude-sonnet-4-6", "utility": "openai/gpt-5.6-luna" } }
```

It also includes `calls: { voice }` (Settings → Models → Calls, HUI-18): the GPT-Live
voice of a bot without one of its own ([GPT-Live calls](#gpt-live-calls)).
Anything else normalizes to the default, `{ "voice": "cove" }`. A file saved while
HUI also had VoiceStudio may hold `calls.engine` and `voice.sendNotesImmediately`:
neither is read, and the next `PUT` leaves them out.

### `GET /__hui/health`

Returns gateway uptime, `HTTP + SSE`, the fixed `Full Access` product mode and
registered/live PI runtime counts per session status. This endpoint is diagnostic and read-only.

### macOS power

`Settings.power.keepAwake` (default `true`; only an explicit `false` turns it
off) is the one saved power choice. On macOS the gateway applies it at startup
and on each `PUT /__hui/settings` by running
`/usr/bin/caffeinate -i -w <gateway pid>`, which prevents idle sleep while the
display can still sleep. Turning it off or stopping the gateway ends the child,
and `-w` ends it if the gateway is killed.

Staying awake with the lid closed is never saved: it lasts one gateway run.

- `GET /__hui/power` returns `{ power: null }` off macOS, otherwise
  `{ power: { keepAwake, lidAwake, lidOn } }`. `keepAwake` and `lidAwake` are
  `{ state: "off" | "pending" | "active" | "error", detail }`, what the gateway
  actually holds; `lidOn` is the lid switch. The UI polls it every three seconds
  while visible and shows a top notice while `lidOn` is true and `lidAwake` is
  active.
- `PUT /__hui/power` with `{ "lidAwake": boolean }` sets the switch and returns
  the status at once; the outcome of a password prompt appears in later reads.
  JSON without a boolean `lidAwake` is 400, and off macOS it is 404.
- Turning it on runs `pmset -a disablesleep 1` through one macOS administrator
  prompt (`osascript … with administrator privileges`; macOS closes an
  unanswered dialog after about 30 seconds, and HUI abandons it after two
  minutes at the latest). The same root script leaves a watcher that runs
  `pmset -a disablesleep 0` and deletes its flag file under
  `~/.config/hui/power/` once HUI renames that flag to `.stop` (turned off,
  gateway stop) or the gateway PID is gone (crash). A cancelled, timed-out or
  failed prompt turns the switch back off with the reason. Turning it off withdraws a prompt
  still asking to turn it on; a switch changed again before its prompt opens
  gives way to the newer choice.
- Every gateway start begins with the switch off and never prompts. It first
  stops every watcher it finds and waits briefly for each to restore sleep.
  Flags are named with their gateway PID; another live gateway's flag (a
  development server sharing the config dir) is left alone unless it predates
  the last boot. A flag that outlives its watcher (reboot, power loss) means HUI
  left `disablesleep 1`: the switch shows on with a note saying so, without a
  prompt (also when turned on while such a flag holds it), and turning it off
  asks for approval to restore sleep. The flag stays until that approval
  succeeds.
- When `pmset -g` already reports `SleepDisabled 1` without a HUI flag, turning
  the switch on reports it active and changes nothing, and turning it off
  reports that it is still on outside HUI.

### `GET /__hui/workspaces`

Returns a read-only inventory derived solely from canonical working directories
already present in HUI's session registry. It includes safe workspace context or
memory files and `git worktree list --porcelain -z` results. Symlinks escaping a
workspace and every workspace under `~/.openclaw` are excluded. The route never
creates, deletes or modifies memory files or worktrees; removal lives under
`/__hui/worktrees/remove`. Worktree creation is
available only as part of the explicit `POST /__hui/sessions` transaction below.

### `GET /__hui/worktrees`

Returns `{ worktrees, diagnostics, pending }` (`WorktreeInventory` in
`shared/worktrees.ts`). Repositories come from registered session directories
and HUI's worktree root; each repository's main checkout is not listed. `dirty`, `bytes` and `pullRequests` are absent until a
background `git status`, `du` or `gh pr list --head <branch>` answers; a failed
lookup is listed in `unavailable`. `pending` is true while any lookup runs.

### `POST /__hui/worktrees/remove`

Body `{ "paths": ["/abs/path"], "mode": "single" | "merged", "acknowledged": [] }`;
`single` takes exactly one path, `merged` up to 200. Each row reports `risks`
(`dirty`, `unknown`, `locked`, `running`, `missing`, `external`). A `single`
removal proceeds only when every current risk is in `acknowledged` (`unknown`
also covers `dirty`); it then stops running linked sessions and forces only the
acknowledged risks. `merged` rejects any `acknowledged` and requires a
HUI-created worktree with no risk, a merged pull request and no active session (every
linked session archived), all
re-read at removal time, and never forces. The local branch is deleted only when
a merged pull request's head equals the branch's commit. Returns
`{ results: [{ path, removed, branchDeleted, error? }], inventory }`; refused
items are reported per path with HTTP 200. Malformed bodies return 400.

### `GET /__hui/git-checkout?cwd=<directory>`

Returns the read-only Git context for New Session's checkout picker: whether the
directory belongs to a repository with a commit, its current branch, the default
base ref and at most 80 local/known remote branch suggestions. The base ref
prefers the locally recorded `origin/HEAD` (using the remote-tracking ref when no
local branch exists), then local `main`/`master`, then the current branch or `HEAD`.
The backlog dialog uses one shared searchable Branch picker in both checkout
modes and accepts custom branch/commit refs. Both modes initially select this
default base ref.
Discovery never fetches or mutates a remote or checkout. Failure to enumerate
refs keeps worktree creation available and marks suggestions unavailable; in
that case the base falls back to `origin/HEAD`’s target, the current branch or `HEAD`.

## Shapes

```ts
type SessionStatus = "idle" | "running" | "waiting" | "starting" | "error"
  | "reconnecting"   // worker session: connection down, HUI retries by itself
  | "disconnected";  // worker session: HUI is not retrying (disconnected or removed worker)

type SessionView = {
  id: string;
  title: string;
  group: string;        // already flattened: "pr-signal-notifications - v1"
  cwd: string;
  displayCwd: string;   // cwd with home shortened to "~/", display only
  tool: string;         // "pi"
  status: SessionStatus;
  creating?: WorktreeProgress; // Git worktree still being created (see POST)
  initialPrompt?: string; // only on a failed pending worktree session
  runtime?: {             // ephemeral; absent for cold/failed sessions
    active: true;
    memoryBytes?: number; // RSS of the runtime root and current descendants
    bootDurationMs?: number;
  };
  model?: string;       // "provider/id"
  pinned?: true;
  parentId?: string;
  subagent?: SubagentRecord;
  bot?: { id: string; handle: string; name: string }; // the bot whose forever chat this is; see Bots
  pullRequests?: SessionPullRequest[]; // oldest first, at most 20
  jiraIssues?: SessionJiraIssue[];     // oldest first, at most 20
  stage: SessionStage;                 // effective Kanban column
  stageOrigin: "operator" | "agent" | "pullRequest" | "default";
  createdAt: string;
  updatedAt: string;
};

type SessionStage = "investigation" | "implementation" | "testing" | "done";
// The board's first column, "backlog", holds backlog items, never sessions.

type SubagentStatus =
  | "starting" | "running" | "completed" | "failed"
  | "cancelled" | "timed_out" | "interrupted";
type SubagentRecord = {
  taskId: string;
  task: string;
  label?: string;
  status: SubagentStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  completionDelivery?: "pending" | "delivered"; // absent for legacy tasks
};
type SubagentTaskView = SubagentRecord & {
  sessionId: string;
  parentSessionId: string;
  title: string;
};

// `url` is present for images whose bytes the gateway can serve:
// GET /__hui/sessions/:id/attachments/:message/:image (x-hui: 1, or
// `sec-fetch-site: same-origin` so <img> can load it; cross-site is refused).
// 200 with the image's raster MIME type, `cache-control: no-store` (a rewind
// gives the next message the same position, so the URL can name new bytes),
// `x-content-type-options: nosniff`; 403 without x-hui, 404 for an unknown
// session, index or non-image part, 405 for other methods.
// Files a user attached have `url` GET /__hui/sessions/:id/attachments/:message/files/:file
// with the same guard and headers, served as `application/octet-stream`; 404 also
// when the stored path is missing or resolves outside HUI's attachment store.
type TranscriptAttachment = { name: string; kind: "image" | "file"; mimeType?: string; url?: string };

type TranscriptEntry =
  | { kind: "message"; role: "user" | "assistant"; text: string; entryId?: string; attachments?: readonly TranscriptAttachment[] }
  // The record of a GPT-Live call with a bot (CallRecord, GPT-Live calls below): one card; no turn ran for it.
  | ({ kind: "call" } & CallRecord)
  | { kind: "compaction"; summary: string; tokensBefore: number }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; args?: unknown; output?: string; failed?: boolean }
  | { kind: "error"; message: string };

type RuntimeQueue = { steering: readonly string[]; followUp: readonly string[] };
type RuntimeModel = { provider: string; id: string; name: string; contextWindow?: number; maxTokens?: number };
type RuntimeCommand = {
  name: string; // Exact invocation name, without the leading slash.
  description: string;
  source: "extension" | "skill" | "prompt";
};
type RuntimeQuestion =
  | { id: string; method: "select"; title: string; options: readonly string[] }
  | { id: string; method: "confirm"; title: string; message: string }
  | { id: string; method: "input"; title: string; placeholder?: string }
  | { id: string; method: "editor"; title: string; prefill?: string }
  // HUI's own `secret_request` prompt, never a runtime's: title is the label,
  // message the reason. See Secret requests.
  | { id: string; method: "secret"; title: string; message: string };
type SessionSnapshot = {
  transcript: readonly TranscriptEntry[];
  status: SessionStatus;
  model?: RuntimeModel;
  thinking?: string;
  queue: RuntimeQueue;
  questions: readonly RuntimeQuestion[];
  subagents: readonly SubagentTaskView[];
  // A running compaction, or one that ended without writing a summary. Without
  // flags it blocks (PI): the session is busy and Stop cancels it.
  // `blocking: false`: the runtime runs it beside the conversation (Durable),
  // the session stays idle and input is never held; `background: true`: the
  // runtime's own, which nothing in HUI cancels.
  compaction?: { status: "running" | "failed" | "cancelled"; reason: CompactionReason; message?: string; blocking?: false; background?: true };
};

type CompactionReason = "manual" | "threshold" | "overflow";

// Same shape as server/runtimes/types.ts RuntimeEvent.
type RuntimeEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; args?: unknown }
  | { type: "tool_update"; id: string; name: string; output?: string }
  | { type: "tool_end"; id: string; name: string; output?: string; failed?: boolean }
  | { type: "queue_update"; queue: RuntimeQueue }
  | { type: "question"; question: RuntimeQuestion }
  | { type: "notice"; message: string; level: "info" | "warning" | "error" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "compaction_start"; reason: CompactionReason; blocking?: false; background?: true }
  | { type: "compaction_end"; reason: CompactionReason; outcome: "done" | "failed" | "cancelled"; willRetry: boolean; message?: string }
  | { type: "settled"; historyRefreshed?: boolean }
  | { type: "error"; message: string };
```

The gateway also handles a runtime-only `{ type: "history" }`: entries written
beside a run (a call's record) changed a Durable chat's history. It never reaches a
browser: an idle session answers it with a fresh `snapshot`; a busy one shows the
record when its turn settles.

`status` is HUI's own, derived: `starting` while a runtime is booting (pi takes
4.5–5.7s), `running` from prompt dispatch until the runtime settles, `error` if
it failed, `idle` otherwise.

Tool output is human-readable normalized content. An empty PI `content` array
produces an empty output string (including initial streaming updates), not the
serialized protocol envelope. Unknown custom result shapes retain the existing
JSON fallback.

`turn_end` is informational. PI can emit it while the agent loop is still
working. Only PI's `agent_end` (normalized to `settled`) makes the session
accept another prompt. The adapter first refreshes `get_entries` so the durable
PI transcript normally replaces the live projection. If that refresh fails, it
emits an error followed by `settled` with `historyRefreshed: false`; the gateway
keeps the completed live projection rather than replacing it with stale history.

On the PI worker, PI compacts at its threshold after a run's `agent_end`, before a prompt when
the context is already full, and inside a run before the next model call; it
also compacts around an overflow it recovers from, and for `/compact`.
`compaction_start` makes the session `running` with `snapshot.compaction.status:
"running"`, so the browser shows a live divider instead of its working
indicator. A prompt PI compacts before is accepted at `compaction_start` (PI
answers its RPC only after the summary) and settles with its run. Prompts and
steers sent while PI compacts outside a run join HUI's follow-up queue, because
PI refuses prompts then; inside a run PI delivers steers itself.
`compaction_end` reports the outcome with PI's message (its own "… failed:"
heading removed). A compaction that ends with no run active, no prompt pending
and no PI retry keeps the session busy until it settles again: the history then
holds the `compaction` entry, usage is refreshed and the queue drains. A settle
whose refresh finishes after PI started another run leaves the session to that
run. A failed or cancelled compaction stays in `snapshot.compaction` until the
next turn, rewind or clear. Abort cancels a running compaction, and a released
subagent stays open until PI's compaction after its turn ends. A compaction the
runtime runs beside the conversation (`blocking: false`) leaves the session
idle, holds no input, keeps the working indicator of a run beside it, keeps
nothing open and refreshes the history itself when it ends.
Durable sessions follow Durable's compaction semantics; see
[Durable runtime binding](#durable-runtime-binding).

## Session stages

Every session has a development stage shown as its Kanban column. Sessions
never sit in the Backlog column, which holds [backlog items](#kanban-backlog).
The effective `stage` in a view is resolved by `effectiveSessionStage`
(`shared/session-stages.ts`) with this precedence:

1. An **operator** placement (`PATCH … { stage }`) wins until the operator
   sends `stage: null`. Neither the agent nor pull requests can move it.
2. Otherwise the stored **agent** stage (from `set_stage`) or previously
   persisted pull-request stage.
3. **Pull-request** evidence from the session's transcript advances — never
   regresses — that stage: any open or draft PR proves `testing`; otherwise a
   merged PR proves `done`. Closed-unmerged and unconfirmed PRs prove nothing.
   PRs that already existed at the last explicit placement (operator or agent)
   are recorded in `stagePullRequests` and ignored, so a PR merged in an earlier
   iteration does not drag new work back to Done.
4. With nothing stored, `investigation` (`stageOrigin: "default"`). A legacy
   stored `backlog` is dropped when the registry is read, so it resolves the
   same way.

Pull-request facts are only visible while a transcript is loaded, so the
session list persists an inferred advance as `stageSource: "pullRequest"`.
Only a changed stage writes; polling an unchanged board stays read-only.

## Persisted ownership

| Field/data | Owner | Persistence and mutation rule |
|---|---|---|
| `id` | HUI | UUID in `sessions.json`; never reused |
| `title`, `group`, `pinned`, `archived`, `unread`, `icon` | HUI | Writable organizer metadata; changing it never renames or rewrites a PI file. Sidebar drag/drop and **Move to group** both update `group` through the session PATCH route. |
| `cwd`, `tool`, `createdAt`, `source` | HUI | Fixed when registered |
| `updatedAt` | HUI | Advanced when PI accepts a prompt; drives recency ordering |
| `model`, `thinking` | HUI | Session preference passed back to the runtime on reopen |
| `parentId`, `subagent` | HUI | Optional additive lineage/task state for `sessions_spawn`; PI still owns the child transcript |
| `bot` | HUI | Optional id of the bot whose forever chat this record is (see [Bots](#bots)); set at creation, never changed. No registry version bump. The bot registry decides: a record whose bot is gone is an ordinary session |
| `stage`, `stageSource`, `stagePullRequests` | HUI | Optional Kanban stage and who placed it (`operator`, `agent`, `pullRequest`); absent means Investigation. A session started from a backlog item is created with an operator placement in the target column. See [Session stages](#session-stages). `stagePullRequests` is server-only and never returned in views. |
| `piSessionFile` | Runtime identity, HUI pointer | PI: learned from `get_state`, then stored by HUI for `--session` resume. Durable: `durable:<conversationId>`, replaced by a rewind's fork |
| messages and tool results | PI | PI's JSONL only; never copied into `sessions.json` |
| `status` | HUI process | Derived live state; never persisted |
| `~/.config/hui/bots.json` | HUI | Bots, separate from `sessions.json`: `{ version: 1, bots: BotRecord[] }`, mode 0600. Serialized mutations, atomic rename. A record that does not validate is skipped, reported once in Logs and written back untouched; a file with a newer `version` or invalid JSON is refused and never overwritten. See [Bots](#bots). |
| `~/.config/hui/backlog.json` | HUI | Kanban backlog, separate from `sessions.json`: `{ version: 1, tasks: BacklogLocalTask[], jira: { [KEY]: { group } } }`. A task is `{ id, title, problem, fix, cwd?, group, createdAt, jira?: { key, url } }`. Per Jira key only non-default HUI metadata (its group) is stored, never Jira facts. Serialized mutations, atomic rename; a file with a newer `version` or invalid JSON is refused and never overwritten. See [Kanban backlog](#kanban-backlog). |

Registry mutations are serialized inside the gateway and written with an
atomic rename. This prevents a boot-time `piSessionFile` save, a rename and a
prompt timestamp update from replacing one another with stale snapshots. Group
catalog/default mutations use the same queue and registry write, so a group
rename cannot split its catalog entry from its member sessions.

## PI session coordination tools

Regular PI sessions load these HUI coordination tools, modeled on OpenClaw's
session-tool contract (see also [Suggested tasks](#suggested-tasks)):

| Tool | Contract |
|---|---|
| `sessions_spawn` | Persist and start one isolated child session; accepts task, optional label/model/thinking and a bounded run timeout; a model missing from the caller's available models is rejected before any child is created, naming close matches (an unavailable or empty catalog does not block); returns immediately with task and child session ids |
| `sessions_list` | Return metadata for at most 100 sessions in the caller's parent/child tree |
| `sessions_history` | Return at most 100 recent structured entries from a visible session; tool entries are opt-in and the UTF-8 serialized result is capped at 80 KiB. A single entry larger than the cap becomes an explicit omission error entry |
| `sessions_send` | Prompt or queue a message to a visible session; `timeoutSeconds: 0` is fire-and-forget, otherwise waits up to 120 seconds for the correlated reply |
| `subagents` | List visible spawned tasks, steer a running child, or cancel an active child |
| `set_stage` `{ stage }` | Set the caller's own Kanban stage: `investigation`, `implementation`, `testing` or `done` (Backlog holds backlog items, never conversations, and is rejected). Refused (reported, not thrown) while an operator placement stands. See [Session stages](#session-stages) |

The tools do not use `/__hui/` browser routes. Each PI child inherits an
immutable HUI session id plus a process-local random bearer token for a private
HTTP listener bound to `127.0.0.1`. Calls are authorized to the caller's root
tree before registry or transcript data is returned. The token, PI file paths
and unrelated session metadata never enter tool output. A PI child cancels a
call (Stop) by dropping its connection; the handler sees that as the call's
abort signal, as it sees a Durable tool call's own.

`sessions_spawn` allows at most eight active descendants per root. A child has
its own PI process/session file and receives `[Subagent Task]` as its first user
turn. On settlement HUI persists the terminal lifecycle and bounded summary,
then prompts an idle parent or attempts steering on a running/waiting parent.
If steering fails or is unsupported, HUI queues the result as a follow-up;
if the parent settled during that attempt, HUI prompts it directly instead.
Successful steering does not also enqueue a follow-up or abort the parent.
Active tasks left by a gateway restart become `interrupted`; HUI never reconstructs a false
live process from persisted metadata. Once a terminal result has been delivered,
HUI closes the child's runtime process without deleting its registry row or PI
transcript. Cleanup waits for an active browser reader to leave; later navigation
reopens the same durable session normally.

## Rich Markdown embeds

Assistant Markdown has six bounded rich forms in addition to CommonMark/GFM:

- A fenced `mermaid` block becomes a `<hui-mermaid>` presentation element. The
  Mermaid runtime is a lazy browser chunk, uses strict security, and receives
  escaped source through a template child. Rendering is serialized because
  Mermaid configuration is process-global. Parse/render failures stay inside
  the element; ordinary fenced code keeps HUI's copy, wrap and reveal controls.
- Fenced `chart`, `vega-lite` or `vegalite` JSON becomes a
  `<hui-vega-chart>`. HUI rejects specifications above 100 KiB, excessive
  nesting and every `url`/`href` key before lazy-loading Vega/Vega-Lite. Data
  must be inline under `data.values`; the default chart is bounded to the
  transcript width and emits SVG without editor/actions chrome.
- `$…$` inline math and `$$` blocks whose delimiters occupy their own lines
  become `<hui-math>` elements. KaTeX is lazy-loaded with `trust: false` and
  malformed formulae fail locally. Unpaired currency dollars remain prose.
- GitHub-style `> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION`
  blockquotes become semantic callouts while ordinary blockquotes are unchanged.
- A paragraph containing only an autolinked HTTPS
  `x.com/<user>/status/<digits>` or `twitter.com/<user>/status/<digits>` URL
  becomes `<hui-tweet-embed>`. Its initial facade makes no third-party request.
  **Load post** fetches X's official widget script with `dnt: true`; failure
  leaves an ordinary external-link fallback. Markdown-labeled links, URLs mixed
  with prose, profile links and HTTP URLs never become embeds.
- An isolated canonical HTTPS Slack message or channel permalink becomes a
  `<hui-slack-link>` card showing only the link-derived workspace/type and an
  external **Open in Slack** action. The same card is used for an isolated link
  in a user message. HUI performs no Slack request, stores no Slack credential
  and never implies that the agent has read the private conversation. Labeled,
  mixed-prose, HTTP and non-canonical Slack URLs remain ordinary text or links.

Raw author HTML, SVG, scripts and arbitrary iframes remain escaped; interactive
HTML and SVG are [agent widgets](#agent-widgets). The runtime
system prompt renders one compact `hui_presentation` section from the structured
capability catalog. Declarative renderers are not presented as callable tools.
The separate `hui_tools` and `hui_tool_guidelines` sections continue to come
from PI's live selected-tool names, snippets and guidelines, so late extension
registrations and overrides remain discoverable without a stale hard-coded tool
list. This follows Hermes's stable capability guidance versus progressive tool
disclosure distinction; HUI's current tool count remains small enough that a
search/describe/call bridge would add round trips without saving meaningful
context. No route or persisted transcript format is added; PI continues to
store the original Markdown source.

Rendered diagrams and transcript images share one browser-only viewer
(`src/components/media-viewer.ts`). Mermaid and chart embeds gain an expand
control once their SVG renders; image links and inline data images opt in with
`data-media-viewer`. The viewer clones the rendered SVG rather than re-running
Mermaid, copies a PNG through the async Clipboard API with a rich-content
selection fallback on insecure origins, and saves images by re-reading their
same-origin or `data:` URL. Diagram exports freeze the label typography that
app stylesheets applied during layout and use the current panel background.
No request, route or persisted format is added.

## Agent-presented media

The HUI-owned `present_media` tool accepts one to eight local paths. Relative
paths resolve against the session working directory. HUI validates regular
files before copying them into `presented-media/<opaque-id>/`; one item is capped
at 100 MB and one call at 200 MB. The PI tool result durably stores only this
browser-safe projection:

```ts
type PresentedMedia = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "file";
  mimeType: string;
  size: number;
  url: `/__hui/media/${string}/${string}`;
};
```

Tool-result `details` cross the generic runtime event/transcript contract so a
live call and a reopened PI transcript paint identically. `present_media` is
isolated from collapsed run details and rendered as ordinary assistant media.
The tool description and turn-time guidelines are part of the effective system
prompt, including supported image/audio/video extensions, codec uncertainty,
remote-image behavior and the prohibition on publishing unrelated private data.

`GET|HEAD /__hui/media/:id/:name` serves the immutable artifact. Native media
elements cannot add the `x-hui` header, so the random id is the read capability;
the route additionally requires the exact stored display name and sends
`Cross-Origin-Resource-Policy: same-origin` plus `nosniff`. It supports one HTTP
byte range (`206`/`416`) for native video/audio seek. Recognized media is inline;
unknown formats use `application/octet-stream` and attachment disposition.

## Agent widgets

The HUI-owned `show_widget` tool (`server/runtimes/show-widget-extension.mjs`) is
registered with the other HUI tools, so Durable conversations, PI SDK worker
sessions and the PI CLI fallback (`--extension`) all offer it. It is a port of
OpenClaw's tool of the same name; see the SPEC decision *Agent widgets run in an
opaque-origin sandbox* for the threat model.

```ts
type ShowWidgetInput = {
  title: string;       // 1–120 characters after trimming: the card heading
  widget_code: string; // an HTML or SVG fragment, at most 262,144 UTF-8 bytes
};
```

`server/runtimes/widget-code.mjs` validates the call where the tool runs. Every
failure is a failed tool result that tells the model what to fix:

- a missing or longer title, empty code, or more than 256 KiB;
- a full document: a leading `<!doctype html>`, `<html>`, `<head>` or `<body>`;
- code that does not start with markup (a file path, a Markdown fence, prose);
- an inline script that does not parse. Classic scripts (no `type` or a
  JavaScript MIME type) compile with `vm.Script`, module scripts with
  `vm.SourceTextModule` in a worker started with `--experimental-vm-modules`;
  nothing runs or links. Scripts with `src` and other types are skipped but
  counted. The first error reads `widget_code has a JavaScript syntax error in
  inline script N at line L, column C: <message>. Offending line: <line>.`, with
  1-based positions in `widget_code` itself. A worker that cannot start leaves
  module scripts to the browser's error notice.

The result tells the model the widget is shown, runs sandboxed and cannot be
read back. Its `details` are the only state the tool records:

```ts
type ShowWidgetDetails = { widget: { version: 1; title: string; mode: "html" | "svg"; bytes: number } };
```

The chat renders a succeeded call's own `args.widget_code` when `details.widget` is
present and the code still passes the size and fragment checks, so a widget
returns with its transcript (reload, Back/Forward, a gateway restart) and leaves
HUI with its session; the runtime transcript keeps it like the rest of the
conversation. A running call shows a pending card, a failed one stays an
ordinary failed tool row, and a succeeded call without usable code says so. No
route serves widget content and nothing is persisted outside the transcript.

### `GET|HEAD /__hui/widget-sandbox`

The static outer page of every widget (`server/widget-sandbox.ts`), identical for
every caller and holding no data, so it needs no x-hui header (an iframe cannot
send one). Other methods answer 405. Headers:

| Header | Value |
|---|---|
| `Content-Security-Policy` | the widget policy below, plus `frame-ancestors 'self'; sandbox allow-scripts allow-forms` |
| `Permissions-Policy` | camera, microphone, geolocation, display capture, clipboard, payment, USB, serial and HID denied |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `no-store` |

The widget policy (`widgetContentSecurityPolicy` in `shared/widgets.ts`) is
`default-src 'none'`; `script-src 'unsafe-inline'` plus cdnjs.cloudflare.com,
cdn.jsdelivr.net, esm.sh and unpkg.com; `style-src` the same plus
fonts.googleapis.com and fonts.bunny.net; `font-src data:`, the script CDNs,
fonts.gstatic.com and fonts.bunny.net; `img-src` and `media-src data: blob:`;
and `'none'` for `connect-src`, `frame-src`, `worker-src`, `object-src`,
`manifest-src`, `base-uri` and `form-action`.

The page's script stops unless it is framed, its referrer is an http(s) page and
it cannot read that page (an opaque origin). The HUI page that framed it is its
host. For each document it receives it builds a new widget frame
(`srcdoc`, `sandbox="allow-scripts allow-forms"`), which inherits the policy, and
relays everything else between the host and the widget, dropping
`ui/notifications/sandbox-*` methods from the widget. It forwards `ui/open-link` only
while the widget frame holds focus and the page has transient user activation.
Its hash may carry `scheme=light|dark`, the first color scheme until the host
context arrives.

### Frame protocol

JSON-RPC 2.0 over `postMessage`, with MCP Apps method names where one exists. The
chat accepts messages only from the window of its own frame, and starts a widget
only when the sandbox page posts as the opaque origin `"null"`.

| From → to | Method | Params | Contract |
|---|---|---|---|
| page → chat | `ui/notifications/sandbox-proxy-ready` | `{}` | the page is ready; within 5 s of its load or the card fails |
| chat → page | `ui/notifications/sandbox-resource-ready` | `{ html, renderId, title }` | the composed document; replaces the widget frame |
| page → chat | `ui/notifications/sandbox-resource-loaded` | `{ renderId }` | the widget frame's first load |
| page → chat | `ui/notifications/sandbox-resource-navigated` | `{ renderId }` | HUI addition: a later load means the widget navigated; the frame is removed and the card stops |
| widget → chat | `ui/notifications/size-changed` | `{ height }` | body height; the frame is clamped to 48–8,000 px |
| chat → widget | `ui/notifications/host-context-changed` | `{ theme, displayMode, styles: { variables } }` | after load and on every theme or display-mode change |
| widget → chat | `notifications/message` | `{ level: "error", logger: "widget", data: { kind, message, source?, line?, column? } }` | uncaught errors, rejections and policy violations, three distinct per load; the card shows the first and a count |
| widget → chat | `ui/open-link` (request) | `{ url }` | http(s) without credentials, at most 2,048 characters, only right after a click in the focused widget; opened with `noopener,noreferrer` |
| widget → chat | `ui/request-display-mode` (request) | `{ mode }` | `inline` always; `fullscreen` only after a click in the focused widget; the result is the resulting mode |

### Canonical document

`buildWidgetDocument` wraps the fragment once: a meta tag repeating the widget policy,
`<meta name="referrer" content="no-referrer">`, the title, `:root` with the color
scheme and HUI's current tokens over OpenClaw's light or dark defaults,
OpenClaw's base stylesheet and helper classes, the bridge script and then the
fragment (an SVG fragment inside `.svg-widget`). Errors in inline widget scripts are
reported with lines counted from the fragment's first line. Tokens are read from
the HUI root on every send and bounded to 256 characters without `; { } < > \`:

| Widget variable | HUI variable | Widget variable | HUI variable |
|---|---|---|---|
| `--surface` | `--bg` | `--accent-fill` | `--primary` |
| `--card` | `--card` | `--accent-fg` | `--primary-foreground` |
| `--elevated` | `--bg-elevated` | `--ok`, `--warn`, `--danger`, `--info` | same names |
| `--text`, `--text-strong`, `--muted` | same names | `--radius`, `--radius-full` | same names |
| `--border`, `--border-strong` | same names | `--font-body` / `--font-mono` | `--font-body` / `--mono` |
| `--accent` | `--accent` | `--scrollbar-*` | same names |

The card (`src/components/widget-card.ts`) is `role="group"` inline. Full screen
promotes the same element to the top layer (a manual popover) as
`role="dialog" aria-modal="true"`, keeps Tab inside it and returns on Escape, the
control or a widget's own Escape, so the frame is never moved or reloaded.

## Remote workers

Workers are stored in `~/.config/hui/workers.json` (`{ version: 1, workers: [{ id,
name, command: string[], extraPaths: string[], createdAt, updatedAt }] }`). A
session record's optional `worker` names the worker it runs on; `piSessionFile`
and `cwd` are then remote paths. `SessionView` adds `worker: { id, name }` and a
`displayCwd` of `name:path`.

### Transport and protocol

Every remote step runs `<command> sh -s` with a script on stdin: a probe, an
optional Node install, an optional release install (gzip+base64 JSON bundle of
the gateway's own worker code, then `npm install --omit=dev`), and finally
`exec node <release>/…/worker/main(.ts|.js) connect`. The bridge prints
`{"t":"ready"}` once it reaches the host's Unix socket; earlier output is shell
noise and ignored. From then on both sides exchange `\n`-delimited JSON frames:
`{t:"req",id,op,p}` / `{t:"res",id,ok,result|error}` requests in either
direction, plus pushed `session.event` and `session.exit` frames. A requester
that gives up on a request (its caller aborted, or it timed out) sends
`{t:"cancel",id}`, which aborts the handler's signal; a closed connection
aborts them all. Peers that predate it ignore the frame.
Gateway requests: `hello` (the host's protocol version and release; a
mismatch replaces an idle host), `shutdown` (only when idle and no other
gateway is connected; running Durable work does not count, it resumes in the
new host), `session.start {key,tool,launch}` (start or reattach the `durable`
or `pi` runtime for one HUI session id; replies `{state,seq,transcript,methods}`
with the optional `RuntimeSession` methods it offers), `session.call
{key,method,args}` (one of those methods; replies `{result?,state,seq,transcript?}`;
a `followUp` that arrives once the run has settled starts the next run, as a
`prompt`), `session.transcript {key,seq,offset}` (one page of at most 8 MB of
the transcript a frame with that `seq` left behind, `{entries,total}`),
`session.dispose {key}`, `forget {keys}`,
`put-file`, `get-file` and `sync-plan`/`sync-put`/`sync-commit`. A host whose
`hello` lists the `bots` feature also answers the bot operations of
[bots on a worker](#bots-on-a-worker), against its own store: `bot.create
{botId,cwd?,model?,thinking?,soul?,memory}` (`{reference,cwd}`; it always makes the
bot's home, and SOUL.md there when `soul` is given), `bot.directory {cwd}`,
`bot.configure {reference,cwd}`, `bot.forget {reference}`, `bot.last-message
{reference}`, `bot.call-record {reference,record}`, `bot.home.prepare {botId}`,
`bot.soul.read {botId}` (`{soul}`, null without one), `bot.soul.write {botId,soul?}`
(without `soul` it removes SOUL.md), `bot.remove-home {botId,cwd?}` (the bot's
home with everything in it, under the gateway's own guard; only SOUL.md when
`cwd`, the bot's working directory, lies inside it),
`bot.memory.configure|status|view|zoom|html {reference,…}` (a memory this store
cannot read answers `{unavailable}`) and `bot.memory.watch {references}`, after
which it pushes `bot.memory.status {reference,status}` frames to that gateway
as each memory changes, starting with the current status. `state` is the runtime's
synchronous view (`sessionId`, `sessionFile`, `isStreaming`,
`resumesInterruptedRuns`, `model`, `usage`, `thinking`, `queue` and
`questions`). Every reply and every `session.event {key,event,state,seq}`
carries it, plus the whole `transcript` after `settled` and `compaction_end`
and after `clear`, `rewind`, `reload`, `abort` and `continueRun` calls. `seq`
grows with every frame and reply sent for a session; the gateway applies
neither state nor transcript when it already holds a newer one, since a reply
resumes after the events that followed it on the stream. A transcript over
8 MB is replaced by `transcriptPaged: true`; the host keeps it as it was under
that frame's `seq`, and the gateway reads it with `session.transcript` before
handling that frame and the ones after it. A
record with `worker` uses this remote adapter and its `tool` names the runtime
the host runs; a Durable `durable:N` names a conversation in that worker's own
store. A PI session's `resumesInterruptedRuns` is false only while its last
run started and was never seen settling (the host records those session ids
in its state directory's `pi-runs.json` before the run starts, and drops them
on `forget`), so HUI recovers exactly the PI runs a host or runtime stop cut
off. The host records which HUI session each Durable conversation belongs to,
including one a rewind moved it to, in `conversations.json`, so runs a
restarted host resumes call HUI tools as that session. Host requests: `credential`
(`read`, `list`, `delete`, `modify` against the gateway store `pi` or
`hui:<providers-relative path>`), the nested `credential-step` that runs an
OAuth refresh callback on the remote while the gateway holds its lock, and
`bridge` (a HUI agent tool call; the gateway refuses callers whose session is
not on that worker, and refuses `terminal`, `browser` and `watcher`, the
`GATEWAY_ONLY_TOOLS` of `server/worker/gateway-tools.ts`, and `secret_request`
from a host that predates `secret-request`),
`bot.section {botId}` (`{ section: string | null }`, the `bots` prompt section of
a bot whose chat runs on that worker; any other bot is refused) and
`secret-request {key,params}`, whose answer `{status:"provided",label,value}`
(or `cancelled`/`expired`) only the host sees: it writes the value to its own
private file and gives the agent the path. The gateway answers it only for a
session on that worker, a bot's chat there included, and a secret request from
anywhere else for a worker's session is refused. A Stop on the worker cancels
the request and closes the card. With no gateway connected a `bridge` or
`secret-request` call fails at once, and one in flight fails when the
connection drops. `read` and `list` answers are cached in host memory
until the credential's `expires` (API keys: while the host runs) and served
while no gateway is connected; nothing is written to disk. Without a cached
answer the remote's own PI login is used (its `auth.json` only if it already
exists; HUI never creates it). The mirrored PI `models.json` holds
no literal secrets: a literal `apiKey` is dropped, and the gateway answers a
`pi` `read` for that provider with `{type: "api_key", key}` when its auth.json
has none (and lists it); a literal value of a credential-like header (a name
with a `-`/`_`/`.`-separated part `auth`, `authorization`, `cookie`, `token`,
`secret`, `password`, `passphrase`, `passcode`, `credential(s)`, `jwt`,
`signature`, `bearer` or `csrf`, or containing `api-key`, `apikey`,
`access-key`, `private-key` or `secret-key`, case-insensitively; provider,
model or model override) becomes `${HUI_SECRET_<16 hex>}`, a name derived from its place,
whose values ride in `sync-commit`'s `env`. The host keeps them in memory
(replaced by each sync, lost when it stops) and serves them to PI as
environment variables, its own reads and those of the PI workers it starts,
while leaving them out of every environment a process it starts inherits. Values PI resolves itself (`$NAME`, `${NAME}`, `!command`) are
mirrored unchanged; an invalid models.json is not mirrored. The worker needs
Node.js 22.19 or newer.

### `GET /__hui/workers`

`{ "workers": WorkerView[] }`: `{ id, name, command, extraPaths, state:
"disconnected" | "connecting" | "connected" | "error", phase?, error?, host?: {
hostname, platform, arch, node, home, release }, sync?: { at, files, uploaded,
deleted, installed, skipped, errors } }`. Connection state is gateway memory.

### `POST /__hui/workers` · `PATCH|DELETE /__hui/workers/:id`

Body `{ name, command, extraPaths? }`; `command` is parsed like a shell would
split plain words and quotes, without expansion. `POST` responds 201 `{ worker
}`. A new command applies to the next connection. `DELETE` returns 409 while any
session record names the worker; nothing on the remote is deleted.

### `POST /__hui/workers/:id/connect|sync|disconnect`

`connect` and `sync` respond 202 and continue in the gateway (a first connect
may install Node and HUI); follow `GET /__hui/workers`. Both sides ping every
15 s and drop a connection that stays silent for 45 s. A worker whose lost
connection had sessions attached reconnects after 5 s, 30 s, 1 min, then every
5 min; sessions the loss interrupted are then reopened and reattach to their
still-running processes. Meanwhile those sessions report `reconnecting`, with
no error event and no `closed` frame: their streams stay open and receive the
caught-up snapshot on reattach, preceded by a `settled` event when a run HUI
saw start finished there meanwhile. A subagent or automation run waiting on a
session fails once it is `disconnected`. A disconnect or removal stops the retries and
reports `disconnected`, as does opening a worker session whose worker cannot be
reached while no retry is scheduled (after a gateway restart, say). Opening a
`reconnecting` or `disconnected` session never connects its worker, nor does
opening any session of a worker this route disconnected (gateway memory, until
a `connect` or `sync`); any successful `connect` (automatic or this route)
reattaches them. Prompts and
other runtime requests to them return 409 with a message saying why.

## Bots

A bot (HUI-18) is a named, persistent agent with one forever chat. The chat is
an ordinary local Durable session (`tool: "durable"`, `group: ""`, title = the
bot's name) registered through `createSession`, New Session's path; its record
carries `bot`. The bot routes below never duplicate the session API: the chat's
transcript, live stream, prompt, steer, follow-up and question routes are the
session routes on `bot.sessionId`. A bot runs on this gateway or, chosen when it
is created, on a remote worker ([below](#bots-on-a-worker)). Shared types are in
`shared/bots.ts`:

```ts
type BotRecord = {
  id: string;
  handle: string;              // unique; lowercase [a-z0-9-], 1–32, no leading/trailing dash; "events" and "import" are reserved
  name: string;                // 1–60, one line
  title?: string;              // role, ≤ 80, one line
  description?: string;        // ≤ 500
  cwd: string;                 // absolute existing directory (on a worker, a directory there); the persona is not here but SOUL.md (below)
  worker?: string;             // the remote worker (Settings → Workers) the chat runs on, by id; set at creation, never changed
  model?: string;              // "provider/id" of the chat
  thinking?: string;
  memoryModel?: string;        // "provider/id" of the bot's utility model (memory summaries, call helper, call summaries); `utilityModel` in a patch; absent: Settings' utility model, then the chat's own model
  memoryThinking?: string;
  avatar?: { emoji?: string /* one grapheme */; color?: string /* #rrggbb */; shape?: "blob" | "round" | "triangle" | "heart" | "cookie" }; // the look, below
  voice?: { language?: string; live?: GptLiveVoice }; // on calls: the language it speaks (one of Whisper's codes, below; absent: Auto) and its GPT-Live voice (absent: Settings' call voice)
  hidden?: boolean;
  archived?: boolean;
  disabledTools?: string[];    // tools the operator turned off in its chat; absent: none (below)
  disabledSkills?: BotSkillRef[]; // skills turned off; absent: none
  sessionId: string;           // HUI session record of the chat
  createdAt: string;
  updatedAt: string;
};

type BotSkillRef = { name: string; path: string }; // a skill's name and SKILL.md path, or a bundled skill's "hui:skill:<name>"

type BotView = BotRecord & {
type BotView = Omit<BotRecord, "worker"> & {
  worker?: { id: string; name: string }; // as SessionView names it
  status: SessionStatus;       // the chat's session status
  soul: boolean;               // SOUL.md exists in the bot's home folder; false while it has its first conversation
  lastMessage?: { role: "user" | "assistant"; text: string /* one line, ≤ 200 */; at: string };
  unread: boolean;             // the chat's session record is unread
  memory?: BotMemoryStatus;    // absent when the gateway cannot read the chat's memory
  routines: number;            // Automation tasks whose sessionId is the chat
};

type BotMemoryStatus = {
  messages: number;            // lines of OptChat's log
  built: number; pending: number; // summary nodes built, and complete ones not built yet
  viewBytes: number; viewLines: number; // the current view
  waiting?: boolean;           // a turn waits for the compactor ("Summarizing memory…")
  failing?: { node: string; error: string; since: string }; // a node OptChat keeps retrying
  usage: BotMemoryUsage;       // the compactor's spend since the gateway (on a worker, its host) opened this memory; not persisted
};

type BotMemoryUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }; // tokens; cost in USD as providers report it

type BotSoul = { soul: string | null }; // GET/PUT /__hui/bots/:id/soul: SOUL.md's text, null while there is none

type BotCatalog = {             // GET /__hui/bots/:id/catalog
  tools: BotCatalogTool[];      // what the operator can turn off, in offer order
  skills: (BotSkillRef & { description: string; source: string /* "HUI defaults" or the directory holding it */; enabled: boolean })[];
  alwaysOn: { name: string; description: string }[]; // never offered: the bot's own tools and OptChat's memory
  disabledTools: string[];
  disabledSkills: BotSkillRef[];
  live: boolean;                // false: its chat isn't running here, so tools lists only those every chat has
  request?: { id: string; sessionId: string; title: string; message: string }; // an access request waiting in its chat
};

type BotCatalogTool = {
  name: string; label: string; description: string /* one line */;
  group: "files" | "shell" | "hui" | "extension" | "bots";
  source: string;               // "Durable", "HUI", or an extension's source label
  powerful: boolean;            // reaches past whatever else is off (below); on by default like every tool
  enabled: boolean;
};
```

A bot's memory is [OptChat](optchat.md): its chat's conversation enables it in
its creating commit, every turn starts fresh from the memory's view, and
Durable's compactions are declined. The gateway reads it through
`DurableHost.optchat` (`optChatBotMemory` in `server/bot-memory.ts`); a chat
whose conversation has no OptChat, or a store this process does not own, has no
memory to read.

**The look.** A bot shows an animated face (a plush `shape` in a `color`, two
dot eyes, after OpenAI's Dots) or, while it has one, its `emoji` on a tile of
that color; clearing the emoji switches it to its face. `shape` is one of
`BOT_FACE_SHAPES` (`round` is labelled Pebble) and `color` any `#rrggbb`; the
Bots tab and `hui bot --color` offer `BOT_FACE_COLORS` (blue `#3a7bfa`,
yellow `#f5c21b`, magenta `#d23ce0`, mint `#2fc49a`, coral `#ff6b4a`, lilac
`#9b7cf6`). A missing `shape` or `color` is not stored: every client derives it
from the bot's id with `defaultBotLook` (`botSeed`, a 32-bit FNV-1a hash with a
final mix: shape `seed % 5`, color `floor(seed / 5) % 6`), so the same bot has
the same face in the roster, its chat, a call and `hui bot show`, across reloads
and machines. `botLook` resolves the whole look; views never carry it. The
face's expression (thinking, using tools, waiting, summarizing, failed,
listening, speaking) is presentation only, derived in the browser from the
bot's status, its open chat and its call.

`model` and `thinking` in a view are the chat's own (its session record), which
the session's model controls may change at any time; `PATCH` sets both, and
`""` clears them: the live chat switches (`setModel`/`setThinking`) to what a
new bot's chat in its directory gets — Settings' primary model
(`settings.models.primary`, as for a session started without a choice; a
primary this gateway cannot resolve is a 400), else PI's default model there,
else the first available one, and PI's default thinking level fitted to that
model, else `off` — and neither the bot nor its chat's session record keeps a
choice, so views omit them, as for a bot created without one.
`lastMessage` comes from the live transcript, or from one read of the Durable
store for a chat nothing has opened since the gateway started.

**Creation** first makes the bot's home folder, `CONFIG_DIR/bots/<id>` (mode
0700), for every bot, and writes `soul` there as SOUL.md when it is given.
Without `cwd` the home folder is also its working directory. Then the Durable
conversation, in one commit: its agent (`cwd`; the bot's model, else Settings'
primary model, else PI's default, as above; thinking clamped to the model; no
instructions), a `hui.bot` conversation document naming the bot, and
OptChat through the `BotMemory` port (`server/bot-memory.ts`; name = bot name,
model and thinking = `memoryModel`/`memoryThinking`). No prompt can reach the
chat before these exist. Then the session record (with `bot` and
`piSessionFile: durable:<id>`) is registered and started, then the bot record
written. A failed step removes what the earlier ones wrote: SOUL.md, the
folders it created (only when empty) and the session record; an unused empty
conversation can remain in the store, never addressed. A bot created without
`soul` speaks first: once it exists, HUI starts its first turn in the
background (below); the create does not wait for it.

### Bots are a preview (Settings → Labs → Bots)

Bots stay behind an opt-in Labs flag while they are work in progress:
`settings.labs.bots`, a boolean in `settings.json` and the only switch for bots
(the sidebar's Agents | Bots switch shows exactly while it is on). Only an explicit
`true` turns it on. Absent, it is off, except in a file from before it where
Settings → Sessions → *Show the Bots tab* (`bots.showTab: true`, now gone) was on:
that reads as `true`, so an operator who had the tab keeps bots, and the next
save writes only `labs.bots`. It round-trips through `GET`/`PUT
/__hui/settings` like the other Labs flags, and the gateway reads it at each use,
so either change applies at once, without a restart. A worker's host reads no
flag: the gateway's refusals cover the bots that run there.

While it is off, bots are dormant and nothing about them is deleted:

- **Every bot route refuses** with `409 { "error": "Bots are off on this gateway:
  they are a preview. Turn them on in Settings → Labs → Bots." }`
  (`BOTS_OFF_MESSAGE` in `shared/bots.ts`): everything under `/__hui/bots`
  (the events stream and the memory page included), `/__hui/calls` and every
  call route, and the session routes of a bot's chat (`/__hui/sessions/:id/…`
  actions, `PATCH`/`DELETE /__hui/sessions/:id` and its live stream's
  WebSocket), since opening or prompting the chat would resume it. A record whose
  bot is gone is an ordinary session, as elsewhere. 409, not 404: the gateway's
  settings refuse the request while the bot and its data are all still there,
  and 404 already means a bot that does not exist (the Bots tab and `hui bot`
  treat it so). `hui bot …` prints that message (`hui: Bots are off…`) and
  exits 1; the bots stream's client stops at the 409 and reads the settings
  again.
- **Nothing starts a bot's turn**: every turn HUI starts for a bot (a message,
  a routine, a `message_bot` message, a call's hand-off, a new bot's first turn)
  passes one check in `BotService` that refuses with that message, as do the
  bot-only tools `message_bot` and `set_profile`. A bot's chat that starts a
  turn anyway (Durable resuming a run a restart interrupted, a worker's host
  reattaching, a subagent reporting back) is stopped as soon as it reports
  `running` or `waiting`.
- **Routines** are kept, enabled, and skipped ([Routines](#routines)).
- **Turning it off** (a `PUT` that changes it from on to off) stops what bots
  were doing, as archiving does without archiving: messages still waiting in
  HUI's queue for a bot are withdrawn and a running turn stops; held calls end
  and are recorded as usual (one passive entry in the chat, no turn), and their
  browsers stop at the next heartbeat's 409; open bot streams end.
- What still runs: the queue of clean-ups that deleting bots on offline workers
  left (`bot-cleanup.json`), the one-time migration of instructions to SOUL.md,
  and the read-only check of the roster's tool lists against each bot's chat at
  start and at each worker connection; none of them starts a turn.

Session views keep naming a bot's chat (`bot`), so the browser keeps it out of
every session list whatever the flag says, and `GET /__hui/session-activity`
leaves bots' chats out while it is off. The browser shows nothing of bots
while it is off: no Agents | Bots switch, `/bots` and `/bots/:id` land on the
home page (a remembered Bots tab shows Agents until the switch is back), no bot
unread marks, no Settings → Sessions → Bots or Settings → Models → Calls, and no
routines or their runs in Automations (whose next wake then counts only the
tasks it lists).

### Routes

All under `/__hui/bots`, with the usual `x-hui` guard (the memory page also
accepts a same-origin page load, below). While bots are off every one answers
409 ([above](#bots-are-a-preview-settings--labs--bots)). `:id` is a bot's id or handle. Bodies are JSON (create, edit and soul up to 256 KiB, messages up to 24 MB);
unknown fields are refused, and `instructions` with a message saying the persona is SOUL.md now. Errors use the common `{ "error" }` shape: 400 for
input (including an unknown model or a missing directory), 404 for an unknown
bot, 409 when the bot's state refuses the request, 503 when the gateway cannot
read the chat's memory or the bot's worker is offline, 500 for storage
failures; other methods answer 405.

| Route | Success | Behavior |
| --- | --- | --- |
| `GET /__hui/bots[?archived=1]` | 200 `{ bots: BotView[] }` | Active bots, or with `archived=1` only archived ones, sorted by name |
| `POST /__hui/bots` | 201 `{ bot }` | `BotInput`: the record fields, all optional (`{}` is enough), `handle`, `disabledTools` and `disabledSkills` (below; tools checked against those every chat has, before an extension's, and skills against its directory's, on the machine it runs on), `worker` (a worker's id or name: [the bot runs there](#bots-on-a-worker), with its home folder and SOUL.md) and `soul` (SOUL.md's text, ≤ 20,000 characters after trimming; given, the bot skips its first conversation and no kickoff runs). Without `name` the bot is `New Bot` (`NEW_BOT_NAME`), which its first conversation replaces (`set_profile`). Without `handle` one is derived from the name (`-2`, `-3`… on collision); an explicit handle that is taken is 409 |
| `GET /__hui/bots/:id` | 200 `{ bot }` | |
| `PATCH /__hui/bots/:id` | 200 `{ bot }` | Only what changes (`worker` is 400: a bot stays on the machine it was created on); `""` clears `title`, `description`, `model`, `thinking` (back to the gateway defaults, above), `memoryModel` (also as `utilityModel`, the same field; giving both with different values is 400), `memoryThinking` (back to Settings' utility model, then the chat's model, and OptChat's default level); an avatar key `""` clears it (`emoji: ""` switches the bot to its face, `shape: ""` and `color: ""` go back to the ones its id picks), `avatar: null` clears all three (an unknown `shape` or a color that is not `#rrggbb` is 400); a voice `language: ""` (back to Auto) or `live: ""` (back to Settings' call voice) clears that key, `voice: null` clears both (other voice keys are 400, VoiceStudio's old `profile` and `speed` included, and so is a `language` that is not one of Whisper's codes, a name such as `Spanish` included, or a `live` that is not one of GPT-Live's voices). `disabledTools` and `disabledSkills` replace the whole list (`[]` turns everything back on), checked against the running chat's catalog (below; on its worker for a bot there); they apply from its next request. `soul` is refused (400): SOUL.md has its own route. A given handle replaces the old one (409 if taken); a new `name` without one re-derives the handle while it is still the automatic one, derived from the old name (kept unique), and a handle chosen before stays. `model`/`thinking` go through the live chat (`setModel`/`setThinking`); `name` and the memory fields reconfigure OptChat, `name` also the session title; `cwd` is accepted only while the chat is idle (409 otherwise) and boots its runtime again there; a turn that starts during that edit (a routine, say) makes it answer 409 after the conversation and the chat's session record already moved, with the bot record still naming the old directory, so repeat the edit once the bot is idle to finish it. Archived bots are 409 |
| `DELETE /__hui/bots/:id` | 200 `{ bot }` | Archives, deleting nothing: marks the bot, disables every Automation task aimed at its chat, withdraws messages still in HUI's follow-up queue for it, stops a running turn and archives the chat's session record. Idempotent |
| `DELETE /__hui/bots/:id?permanent=1` | 200 `{ ok: true }`, plus `queued: true` for a bot whose worker is offline ([then](#bots-on-a-worker) its memory and home there go at the worker's next connection) | Deletes a bot for good, active or archived: withdraws messages still in HUI's follow-up queue for it and stops a running turn; its conversation stops being a bot's chat and its memory goes, in one commit (the `hui.bot` document cleared, OptChat turned off) and then OptChat's files; then every Automation task aimed at its chat, the chat's session record as `DELETE /__hui/sessions/:id` does (its runtime stops), its home folder `CONFIG_DIR/bots/<id>` with everything in it (SOUL.md and every file HUI or the bot put there; only `<BOTS_DIR>/<id>` itself, resolved, never following a link out), then the bot. A working directory the operator chose is never touched (when it lies inside the home folder, only SOUL.md goes). pi-durable cannot delete a conversation yet, so its raw log stays in the Durable store, where nothing reads it back. Each step can run again, so deleting again finishes an interrupted attempt; afterwards the bot is 404 |
| `POST /__hui/bots/:id/restore` | 200 `{ bot }` | Unarchives the bot and its session record; routines stay disabled |
| `POST /__hui/bots/:id/messages` | 202 or 200 | See below |
| `POST /__hui/bots/:id/stop` | 200 `{ bot }` | Aborts the chat's running turn; an idle bot is unchanged; 409 while its chat starts |
| `GET /__hui/bots/:id/memory` | 200 `{ status: BotMemoryStatus, view: string }` | The rendered current view (`<chat>`, one `id+n\|text` line per part, `</chat>`), read once the memory has caught up with the chat; the status counts the same messages |
| `GET /__hui/bots/:id/memory/zoom?id=&n=` | 200 `{ text }` | OptChat's `zoom(id, n)` output: the two lines under line `id+n`, `n = 1` the whole message (`id+0\|kind: text`), or its own "No line id+n."; `id`/`n` must be whole numbers (400) |
| `GET /__hui/bots/:id/catalog` | 200 `BotCatalog` | What the operator can turn off in the bot's chat and what is off, read from its `hui.bot` document; a roster copy that differs is repaired. It opens the chat (as a message would), so an extension's tools are listed; an archived bot's chat, or one that can't start, gets only the tools every chat has (`live: false`). An access request the chat waits on comes along as `request`. Archived bots too |
| `GET /__hui/bots/:id/soul` | 200 `BotSoul` | SOUL.md's text, trimmed (at most 256 KiB is read), or `null` while the bot has none. Archived bots too |
| `PUT /__hui/bots/:id/soul` | 200 `BotSoul` | `{ soul }`, nothing else: text of at most 20,000 characters after trimming (line ends become `\n`), written atomically (a temporary file and a rename, mode 0600) in the bot's home folder; `""` removes SOUL.md, which brings the first conversation back at the bot's next turn (no kickoff). Answers what was stored. The bot's `updatedAt` moves, so every screen reads it again. Archived bots are 409 |
| `GET /__hui/bots/:id/memory/html` | 200 `text/html` | OptChat's self-contained browse page (the view, every message, each tree level; everything escaped). A link opens it, so like an attachment it takes `x-hui: 1` or a browser-attested `sec-fetch-site: same-origin` page load; any other request is 403 (cross-site, same-site, `none`, none at all). Served with `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (inline styles only, never framed), `nosniff`, `cache-control: no-store` and `cross-origin-resource-policy: same-origin` |

`POST /__hui/bots/:id/messages` takes `{ text, attachments?, wait?: boolean,
timeoutSeconds? }`. `attachments` follow the prompt route's rules; an image
alone is a message, a file needs text. HUI commands (`/clear`, `/compact`,
`/reload`, `/update`) are refused (400). An archived bot is 409. The chat is
started if cold; an idle chat gets a prompt, a busy one (running or waiting) a
HUI follow-up. Without `wait`: 202 `{ status: "sent" | "queued" }`. With
`wait: true` (`timeoutSeconds` 1–3600, default 300, only with `wait`): 200
`{ status, reply?, error?, questions? }` once the run that answers this message
settles; for a follow-up that is the run HUI starts when it drains the message,
not the run before it. `answered` carries the last assistant text of that run
as `reply` (absent when it wrote none); `failed` carries `error` (the run ended
on an error, or the runtime failed or exited); `needs-input` comes as soon as
that run asks a question, with `questions` (answer them with `POST
/__hui/sessions/:sessionId/question`; a `secret` one is a [secret
request](#secret-requests), whose `title` and `message` are its label and
reason); `timeout` ends the wait, never the turn.
A client that disconnects ends only its wait.

`GET /__hui/bots/events` is a server-sent event stream like the session list's,
over every bot (archived ones included): the first `bots` frame lists them all,
later frames only the bots whose view changed. `ids`, every bot in list order,
is present only when membership or order changed. While a client listens the
gateway recomputes the list every second.

```text
event: bots
data: {"revision":12,"ids":["<id>","<id>"],"upserts":[/* BotView[] */]}
```

### Soul and the first conversation

A bot's persona is its **SOUL.md**, in its home folder `CONFIG_DIR/bots/<id>`,
never in a working directory the operator chose. The gateway's `hui-bots`
extension renders it as the prompt section `soul`, the last section, after
`bots`, where a persona goes (OptChat's prompt points to the user's
instructions at its end): the file's absolute path; that the bot follows it
and, when the operator asks for a change, rewrites it with `write_soul` (the
whole file, at most 20,000 characters) and says what it changed; then the file. It is read
from disk on every request of the host that runs the conversation, through
the resolver that host sets (`DurableHost.botSouls`: the gateway's resolves
each bot's home folder; a host without one leaves the section out), so it is
byte-identical while the file is. Past 20,000 characters it is cut, with a
note giving the file's length. Bots never use Durable `instructions`.

While SOUL.md does not exist (or holds only whitespace), the section is the
**first conversation** instead, in the spirit of OpenClaw's `BOOTSTRAP.md`:
the operator's request always comes first (a ritual, not a gate); otherwise the
bot greets the operator, by Settings' profile name when it is set (not the
default), and finds out over a few messages what to look after, how to work and
sound, how proactive to be and when to message them, and its boundaries, one or
two questions at a time, never a questionnaire. A bot still called `New Bot`
first asks what the operator wants to call it and saves the answer with
`set_profile` (the host's resolver gives the section the bot's name). Messages from routines (`[routine: …]`) and
other bots (`[from @…]`) are not the operator. It writes down only what the
operator said or agreed to, asking about the rest (often its boundaries) rather
than guessing. Once it knows enough, usually after a few exchanges, it saves
SOUL.md with `write_soul` (suggested sections: who I am, what I look after,
how I work, when I reach out, boundaries) and, in the same reply, says so,
gives a short summary and says how to change it (the Soul tab of its panel, or
telling it). Those last details come only in `write_soul`'s result, once the
file is written, so they stay out of SOUL.md.

`set_profile({ name?, title? })`, beside it, changes the calling bot's own name
and title in HUI under `PATCH`'s rules (so a derived handle follows the name). It
goes through HUI's agent-tool handler, as `message_bot` does, and is refused in a
turn that a routine or another bot started (its run's originating input,
`runPrompt`, starts with `[routine: ` or `[from @`): only the operator names a
bot.

`write_soul({ soul })` lives in `hui-bots-tools` beside `message_bot`, so only
bots' chats are offered it. It replaces the whole SOUL.md: the text is trimmed
(line ends become `\n`), must not be empty and holds at most 20,000
characters; it is written atomically (a temporary file and a rename, mode
0600) in the bot's home folder through the same host resolver as the section,
so a bot needs no file tools for its own soul and the next request already
carries it. Its result says what the bot's reply owes the operator: after the
first save (there was no SOUL.md), that this ends the first conversation, so the
reply says the soul was saved, sums it up and says how to change it; after a
later one, to say what changed. Its replay is safe (the same soul written again
is the same file).
Refusals (empty, too long, not a bot's chat, a host without a resolver) are
tool errors the model reads.

The **kickoff**: right after a create without `soul`, the gateway delivers one
message to the new chat, as a prompt (like a routine's, so the run is
recoverable and a message arriving meanwhile queues behind it):
```text
[HUI bot created]
name: <bot name>
HUI just created you. This note is from HUI, not the operator, who will read your chat when they open it. Write your opening message to them now (your greeting and first question, as your soul section says) and reply with that message only.
```
Clients show a user message whose first line is exactly `[HUI bot created]`
as a note (`<name> was created`), never as the operator's message; previews
(`lastMessage`) skip it, and `hui bot chat` prints `· <name> was created`.
A run that fails shows in the chat like any run's error; a chat that cannot
start is reported as the diagnostic `bot_kickoff_failed`.

The `soul` flag of a view is read once, then again only when the chat's
status or session record changed (a settled turn, in which the bot may have
written SOUL.md), every 10 seconds (a hand edit) or right after HUI wrote it:
the events stream recomputes the list every second. SOUL.md is reached through
the `BotSouls` port of `server/bot-service.ts` (`localBotSouls` in
`server/bot-souls.ts`), so a bot that runs elsewhere can route it.

Bots from before SOUL.md had their persona as `instructions` in `bots.json` and
in their conversation's Durable instructions. At each start the gateway gives
every bot its home folder and, for each record still carrying `instructions`,
writes them as SOUL.md (only while it has none), clears the conversation's
Durable instructions, then drops the field: in that order, so a restart in
between finishes the rest, and a bot that fails is retried at the next start
(diagnostic `bot_soul_migration_failed`). Until then `bots.json` keeps the
field through every write. No turn starts: a bot with neither has its first
conversation at its next turn.

### Tools and skills

Every bot has every tool and skill a session in its directory has (the coding
tools, HUI's tools, its PI extensions' tools, `message_bot`, and the skills PI
finds there, Settings' choices applied) until the operator turns some off. What
is off lives in the chat's `hui.bot` conversation document as `disabledTools`
(tool names) and `disabledSkills` (skills by name and source: the SKILL.md path,
or a bundled skill's stable `hui:skill:<name>` path, as Settings' disabled
skills name them), so the host that runs the conversation (this gateway, or a
worker host for a bot on a worker) reads and enforces the same lists. Both are
optional fields of the document's version 1: absent means nothing is off, so a
document from before them needs no upgrade, and an older HUI reads the ones this
one writes and ignores the lists (a rollback keeps every bot's chat). `bots.json`
keeps a copy in each record for the roster and the bots stream, which reads no
Durable state; it follows grants made in the chat (`DurableHost.botAccessRecorded`;
a worker's host reports them, [below](#bots-on-a-worker)), is repaired by every
catalog read, and is checked against each chat's document: this gateway's bots at
its start, a worker's bots at each connection to it (diagnostic
`bots_access_reconciled`).

Off means removed **by name**, so whatever appears later (a new extension, a HUI
update, a new skill) is on until the operator turns it off. That is the price of
everything on by default: a bot restricted by hand gains newly installed tools.

- **Tools.** `DurableSession.applyTools` offers a bot's chat what a session in
  its directory is offered, minus what is off, extension tools included, as a
  `tools: { remove }` selection; a change applies from the chat's next request.
  Behind it, HUI's agent-tool bridge refuses a bot's call to a HUI tool that is
  off, where the conversation runs (`DurableHost` checks the document), and HUI's
  agent-tool handler checks again against the roster copy, reading the document
  before it refuses so a copy that fell behind a grant never refuses what the
  operator allowed.
- **A bot's own tools** are always on and never offered: `write_soul`,
  `set_profile`, `request_access` (offered while anything is off) and
  `load_skill` (offered while it has a skill and neither `read` nor `bash`), plus
  OptChat's `zoom` and `date`. Turning one off is a 400.
- **Skills.** The prompt lists only the skills that are on: PI's own `skills`
  section while the chat has `read` or `bash`, otherwise one of HUI's that loads
  them with `load_skill`. `/skill:name` commands expand and list only those
  skills; another skill's command is sent as typed. `load_skill({ name, path? })`
  returns one of the bot's skills' SKILL.md, or a text file (≤ 256 KiB) inside
  that skill's own directory by a relative path; links that lead out, skills
  that are off and unknown names are refused, saying why.
- **`bot_access`**, a prompt section between `bots` and `soul`, appears only
  while something is off: it lists what is off (powerful tools marked) and how to
  ask for it, and tells the bot not to work around a turned-off tool through
  other tools, bots or sessions.

**Asking for more.** `request_access({ tools?, skills?, reason })` asks the
operator to turn back on tools or skills that are off. It raises a session
question in the chat (the chat's question card, `hui bot chat`, `needs-input`
from `hui bot send --wait`, and the Tools tab's `request` all show it):

```text
Allow access to bash (powerful) and the beta skill?
<reason>

Asked during the routine "Morning digest".
```

with the options `Allow` and `Deny`. The last line appears when a routine
(`[routine: …]`), another bot (`[from @…]`) or HUI's kickoff started the turn,
read from the run's input as `set_profile` reads it (`botTurnOrigin` in
`shared/bots.ts`). Such a turn may ask, but only the operator answers: session
questions are answered only through `POST /__hui/sessions/:id/question` (and the
clients built on it), never by a message, a routine or another bot. `Allow`
removes the items from the lists in one commit, offers the chat its tools again
at once (and returns them as the tool round's `addTools`), so the very next
request has them, and the roster follows. `Deny`, another typed answer or a
dismissal returns a refusal the bot reads, and nothing changes. Names that
aren't off are refused with the ones that are, without asking; what the bot
already has is answered as such. One request per bot waits at a time: a second
one meanwhile is refused. A request needs the chat open on its host; Stop
dismisses it.

**Escalation paths.** The catalog labels as `powerful` the tools that reach past
whatever else is off: `bash`, `terminal` and `watcher` run commands; `write` and
`edit` change files other programs load (PI extensions, shell startup files);
`browser` drives HUI's own page and `file://` URLs; `sessions_spawn`,
`sessions_send` and `subagents` act through another session, which has every
tool. They are on by default like everything else. `secret_request` is not one
of them: it only asks the operator, who answers each request in the chat's
Secret card or refuses it. `message_bot` lets a bot ask
a better-equipped bot to act for it; turning `message_bot` off prevents that.
Tools are the boundary, not a sandbox: a bot with `bash` or `read` reaches
whatever the user's account can, the files of turned-off skills and HUI's own
API included. Real isolation means running the bot on a worker in a container.

### A forever chat

Bot chats refuse what would reset, shorten, fork or delete them, with 409 and a
message naming the bot: `POST /__hui/sessions/:id/clear`, `POST …/compact`,
`POST …/rewind` and `DELETE /__hui/sessions/:id` (archive the bot instead, or
delete it with `DELETE /__hui/bots/:id?permanent=1`).
Model and thinking changes stay allowed. The prompt route already refuses
`/clear` and `/compact` text for every session.

A bot's chat has several writers: its routines, other bots, the bot messages
route and every client of the session routes. So that each sees a message
another sent before the reply to it, the chat's session stream sends a
`snapshot` as soon as it accepts a prompt (its transcript ends with that user
message); steering already arrives that way when a turn takes it in. Ordinary
sessions send no such frame. `hui bot chat` prints each user message it did
not send itself as a `> ` line, as the Bots tab shows it.

### Routines

Routines are Automation tasks whose `sessionId` is a bot's chat; there is no
other scheduler. For such a task the executor delivers `[routine: <task name>]
<prompt>` as a prompt when the bot is idle and as a follow-up when it is busy,
instead of skipping the run, and the run completes when the turn answering that
message settles (its last assistant text becomes the run's `summary`; an error
fails it). Cancelling the run, or its timeout, withdraws the queued message or
stops the turn answering it. A turn that asks a question waits for its answer
like any turn, so its routine's run stays active until someone answers in the
chat or the task's timeout (`timeoutSeconds`, default 900) stops that turn. An
archived bot's routine fails. Archiving disables a bot's routines; restoring
leaves them disabled.

While bots are off ([above](#bots-are-a-preview-settings--labs--bots)) the
executor skips a routine's run instead: it ends `skipped` (not `failed`), with
`error` saying `Skipped because bots are off: turn them on in Settings → Labs →
Bots. The routine is kept and runs at its next time once they are on.`
(`BOTS_OFF_ROUTINE_MESSAGE`), and nothing reaches the chat. The task is
neither disabled nor deleted. That is the scheduler's existing rule for a run
its target can't take (as for a busy ordinary session): the time it came due is
consumed and not run later, and once bots are on the routine runs at its next
time. A once (`at`) routine that comes due while they are off is turned off by
the scheduler, as every one-off task is once its time comes. Times missed while
the gateway was down follow the start-up rule instead: each overdue task runs
once when the scheduler starts.

### Bot-to-bot messages

Every gateway's default Durable selection includes the `hui-bots` extension,
whose prompt sections `bots` and `soul` (above) read the conversation's
`hui.bot` document and render nothing without it. The tool `message_bot({ to, message })` (`to` ≤ 100,
`message` ≤ 20,000 characters) lives in a second extension, `hui-bots-tools` (with `write_soul`, `set_profile`, `request_access` and `load_skill`),
installed but selected only by a bot's chat (`DurableSession.applyTools`), and
refuses in any conversation without the document. Every other conversation's
offered tools, system prompt and stored agent are unchanged. The section lists
the bot itself and the other non-archived bots (handle, name, title, ordered by
handle) and how to use the tool; it is byte-identical while that roster is
unchanged. The same extension carries `write_soul` (above).

`message_bot` reaches HUI's agent-tool handler as the calling chat's session,
which must be a non-archived bot's chat. Targets resolve by handle (`@`
optional, any case), then exact name in any case; an unknown or shared name, an
archived target and the bot itself are refused, unknown and shared names with
the list of bots it can message. The message is delivered like an operator's
message without a wait (prompt when idle, follow-up when busy), and the tool
returns "Queued for @<handle>." once it is accepted. Loop guard: when the
sender's current run started from `[from @x] …` (hop 1) or `[from @x · hop N]
…`, the delivered text is `[from @<sender> · hop N+1] <message>`, otherwise
`[from @<sender>] <message>`; beyond hop 3 the tool refuses. The run's
originating input is the session's recovery journal (`runPrompt`). Each bot may
send 30 bot messages per hour (gateway memory, a backstop). Refusals are tool
errors the model reads.

### Bots on a worker

A bot can run on a remote worker (Settings → Workers) instead of this machine:
`POST /__hui/bots` takes `worker`, a worker's id or exact name (as `hui workers`
names them; an unknown or shared name is 400). It is chosen once: a `PATCH`
naming `worker` is 400, "A bot stays on the machine it was created on.", since
the bot's conversation and memory live in that machine's store. The record
keeps the worker's id; views carry `worker: { id, name }` like session views,
and HUI shows its folder as `<worker>:<path>` (`botDisplayCwd`).

Creating one needs a live connection to the worker (503 naming it otherwise:
"HUI is not connected to <worker>. Connect it in Settings → Workers, then
create the bot again."). The gateway asks the worker's host to create the
conversation there (`bot.create`), in the same one commit a local bot gets: the
host runs `bot-conversations.ts` and `bot-memory.ts` against its own
`DurableHost`. The host always makes the bot's home there, HUI's private folder
for it, `<worker data dir>/bots/<id>` (mode 0700; usually
`~/.local/share/hui-worker/bots/<id>`), with SOUL.md when `soul` is given, and the
bot works in it unless it names a `cwd`, which must be absolute or `~/` (400 here
otherwise) and exist there (400 with the host's message); SOUL.md never goes in
that directory. A failure there removes the home again. The
gateway then registers the chat through `createSession` with that `worker`, so
the chat is an ordinary remote Durable session (`durable:N` names a
conversation in the worker's store). The model and its defaults are still
checked and chosen here; a `PATCH` of `cwd` is checked on the worker and the
conversation is reconfigured there, as are the memory's settings.

Its SOUL.md is in that home on the worker. The host gives its `soul` prompt
section the same resolver the gateway gives its own (`BotSoulHost`: the home, the
operator's name from the Settings the gateway mirrors there, and the bot's name
as the gateway last gave it, at creation and with each `bots` section), so the
first conversation and `write_soul` work there, and `GET`/`PUT
/__hui/bots/:id/soul` and calls read and write it through the host
(`bot.soul.read`, `bot.soul.write`); 503 naming the worker while it is offline. A
bot created without a soul has its first turn started through its remote
session, like any message. `set_profile` reaches this gateway through the
agent-tool bridge as the bot's session, so the origin check reads that session's
`runPrompt` here, as for a bot here. A remote bot's `soul` in a list is what the
worker last said, read in the background when its chat's state changes (known
at once after a create or a `PUT`), never a request per list.

The host's `bots` prompt section comes from this gateway: the host asks it
(`bot.section`), which answers only for a bot that runs on that worker, so a
bot on a worker knows the whole roster and `message_bot` crosses both ways
(its tool call reaches the gateway through the agent-tool bridge, as any HUI
tool of a remote session). With no gateway attached the section is left out,
as `message_bot` could not deliver anything then either. OptChat's compactor
runs on the worker with the bot's utility model, else the utility model of the
Settings the gateway mirrors there, else the chat's own model, as locally.

A bot list never waits on a worker: a remote bot's `memory` is the status the
worker last reported for it (the gateway watches each listed memory through
`bot.memory.watch`, and the host pushes `bot.memory.status` frames as it
changes; `bot.memory.view` replies with the status it counts), and its
`lastMessage` comes from the live chat or one background read per connection
(`bot.last-message`), so the first list after a connect may lack it. While the
worker is offline the view keeps the chat's session status (`reconnecting` or
`disconnected`), the newest message HUI saw and no `memory`. The memory routes
answer 503 then, naming the worker ("<worker>, where this bot runs, is offline:
HUI is not connected to it. …"), and so do messages, once the chat's session
is unreachable ("The bot's chat runs on <worker>, which HUI is disconnected
from. …"); the session routes answer 409 as for any remote session. A worker
whose host predates bots (its `hello` lists no `bots` feature: a host that was
busy when this gateway connected keeps serving its sessions) is refused with
409 naming it until it is reconnected idle.

Routines, queued messages, steering, questions, Stop, archive and restore go
through the session paths a remote session uses. Deleting asks the host to
forget the conversation (`bot.forget`: its memory is turned off and deleted
there) and to remove the bot's home with everything in it (`bot.remove-home`,
with the bot's working directory, so a chosen one inside the home keeps all
but SOUL.md), then removes the chat's session record and the bot. With the
worker offline the bot goes at once all the same (`{ ok: true, queued: true }`):
those two steps wait on this machine, in `~/.config/hui/bot-cleanup.json`
(owner-only), and run at the worker's next connection; one the worker refuses
then stays for the next, and removing the worker drops them. With the worker
connected, a refusal fails the delete, which can run again. The raw
conversation stays in the worker's store, which cannot delete one. A call's helper reads the remote memory's view and the
call's record is written to the remote conversation (`bot.call-record`);
hand-offs are ordinary messages.

What the operator turned off in its chat ([Tools and skills](#tools-and-skills))
is in its `hui.bot` document on the worker, and the worker's host enforces it from
that document alone, as this gateway does for its own bots: its tool offer leaves
out what is off, its HUI tool bridge refuses those tools, and its prompt lists only
the skills that are on, which `load_skill` reads there; `request_access` raises its
question there, which comes here like any of a remote session's. The gateway
reaches the lists through the host: `bot.access.read` and `bot.access.write` for
the catalog, a `PATCH` and its own check of the bot's HUI tool calls (which come
back through the worker's bridge), and `bot.offer` for what can be turned off: a
session's offer there, extension tools included, and the skills the host's loader
finds in the chat's directory there, Settings' disabled skills applied as the
gateway mirrors them. The gateway's own skills are there at their mirrored paths
(`~/.local/share/hui-worker/mirror/agent/skills/…`), which the catalog shows and
the lists store; a skill given as `{ name, path }` by this gateway's own path is
matched by its mirrored path too, as remote sessions' Settings name skills
(`WorkerService.skillPath`). A create with lists asks `bot.offer` (for the folder
asked for, or the bot's home there) before `bot.create` writes them in its
creating commit. When the operator allows a request there, the host sends every
connected gateway a `bot.access` frame with the new lists, and the one whose bot it
is updates `bots.json`. While the worker is offline the catalog and a `PATCH` of
the lists answer 503 naming it, and the gateway's own check refuses what the
roster says is off; a host whose `hello` lists no `bot-access` feature is refused
with 409 naming it.

A bot's chat on a worker is never offered the tools that act on the gateway's
machine, `terminal`, `browser` and `watcher`: the same `GATEWAY_ONLY_TOOLS` the
bridge refuses, which the worker's host gives its `DurableHost`
(`gatewayOnlyTools`). They are left out of its requests and of `bot.offer`, live or
not, so the catalog doesn't list them and they never count as off;
`request_access` can't ask for them, whatever an older list holds; and a list
naming them is 400, e.g. *terminal stays on this machine, so a bot on devbox
can't use it and there is nothing to turn off: leave it out.* Ordinary sessions
on a worker are still offered them, and the bridge refuses their calls.
`secret_request` is not one of them: its card is answered on the gateway and the
worker's host writes the file (`secret-request`), so a bot's chat on a worker
keeps it, on or off like any other tool.

A bot on a worker has a remote session's limits: the `terminal`, `browser`
and `watcher` tools act on the gateway's machine, so its chat isn't offered them
(above), and it cannot use worktrees. A worker with bots cannot be removed while their
chats' session records exist (409, as for any session on it).

### Importing and exporting bots

A bot can be made from another platform's template, and exported as a file HUI
imports again (`server/bot-template-import.ts`; the importers are pure functions in
`server/bot-templates/`, the shared types in `shared/bot-templates.ts`). The routes
are under `/__hui/bots`, so they answer 409 while bots are off like every bot
route; `import` is a reserved handle, so no bot's `/__hui/bots/:id` is ever one of
them.

| Route | Success | Behavior |
| --- | --- | --- |
| `POST /__hui/bots/import/preview` | 200 `BotImportPreview` | `{ source, pick?, worker? }`, at most 32 MB. Reads the source (fetching a Grok Bot page now, on this request only) and answers what creating its bot would do: `template` (what to send back), `bot` (name, the handle it will get, title, description, look, worker), `soul` (SOUL.md as it will be written), `opener`, `model`, `thinking`, `utilityModel`, `memories: { included, total }`, `skills` (each with the name it is written as and its `original`), `routines` (each with the Automation schedule HUI read from it, the source's `scheduleText` and `guessed` when a part was assumed), `integrations` (each with the HUI `tool` it maps to, absent: missing), `disabledTools`, `disabledSkills`, `dropped` and `notes` (one line each). A file with several agents (CrewAI, Letta, a folder of Claude Code subagents) adds `candidates` (`{ key, name, title? }`) and the shown `pick`; send `pick` to preview another. `worker` previews for a bot on that worker. Nothing is created |
| `POST /__hui/bots/import` | 201 `BotImportResult` | `{ template, worker? }`, at most 24 MB: the `template` a preview returned, checked again field by field (types, lengths, list sizes) and planned again exactly as the preview was. Creates the bot (`POST /__hui/bots`'s path: its home folder, SOUL.md, its conversation with memory, its chat), then writes its own skills, then creates its routines; a failure in either deletes the new bot again and answers the error. Then a HUI export's turned-off skills, and the opener's first turn: their failures leave the bot and come back in `warnings`. Answers `{ bot, skills, routines, opener, warnings }` |
| `GET /__hui/bots/:id/export[?memory=1]` | 200 `application/zip` | The bot as `<handle>.hui-bot.zip` (`content-disposition: attachment`, `no-store`, `nosniff`): `bot.json` (`BotExportManifest`: `format: "hui-bot"`, `version: 1`, its name, handle, title, description, look, model, thinking, utility model and voice, its routines with their exact schedules and whether they were on, `disabledTools`, `disabledSkills` and the names of its own skills), `SOUL.md`, `skills/<name>/SKILL.md` for each of its own skills and, with `memory=1`, `memory.md` (its memory's current view). Archived bots too; a bot on an offline worker is 503 |

`source` is one of `{ kind: "file", name, data }` (the file's bytes in base64, at
most 8 MB decoded), `{ kind: "files", files: [{ path, data }] }` (a folder: at most
1,000 files and 16 MB, each path relative and inside it), `{ kind: "url", url }` or
`{ kind: "text", text }` (at most 2,000,000 characters). Only Grok Bot marketplace
links are fetched (`https://x.ai/bot/marketplace/bots/<slug>`, or `www.x.ai`): over
https, redirects followed only to another such page, 20 s and 4 MB at most; any
other link is 400. Archives are read in memory, stored or deflated only, bounded
by those limits before and while they unpack, every path checked to stay inside;
nothing is ever written from a source but the bot's own files below.

| Format | Recognized by | What it brings |
| --- | --- | --- |
| Grok Bot | a marketplace link, or a page's source pasted | The bot object in the page's server-components payload (its `self.__next_f.push` chunks, text rows resolved): name, author, description, instructions (the soul), memories `{ name, description }`, skills `{ name, description, content }`, routines, integrations `{ name, description }` and an emoji. x.ai can change the page: a page without one is 400, and its message says to copy the bot's instructions and paste them instead |
| OpenClaw workspace | SOUL.md or IDENTITY.md at the top of a folder or a zip (one wrapping folder allowed) | SOUL.md (the soul); IDENTITY.md's `- Name:`, `- Emoji:`, `- Vibe:` (description) and `- Creature:` (title) lines, bold or not, a value on the line below too, template hints skipped; MEMORY.md's sections and USER.md (memories); HEARTBEAT.md's checklist (a routine every 30 minutes); `skills/*/SKILL.md`. Left out with the reason: AGENTS.md (OpenClaw's operating manual: memory files, heartbeats, group chats; it describes OpenClaw's runtime rather than the bot, and HUI's own prompt covers how a bot works here), TOOLS.md, BOOTSTRAP.md, the daily `memory/*.md` logs, an avatar image and a skill's supporting files |
| Claude Code subagent | front matter with `name` or `description` (a `.md`, or `.claude/agents/*.md` in a folder, each a candidate) | `name` (as a display name: `code-reviewer` is Code Reviewer), `description`, `model` (`inherit` is none), `color` (its face's color), the body (the soul), and `tools`: only the HUI tools those map to stay on (below); `mcp__…` tools become integrations |
| Letta agent file | JSON with `agents` (blocks and tools by id beside them), or one agent with `system` and `core_memory`/`llm_config` | The `persona` block (the soul), the system prompt under *Instructions* unless it is Letta's stock prompt, the `human` block and custom blocks (memories), tools (integrations; their code is never imported; Letta's memory and messaging tools are left out), `llm_config` (the model). The message history is skipped |
| Character card | V2/V3 JSON (`spec`), V1 fields, or a PNG's `ccv3` (first) or `chara` text chunk | `system_prompt` (its `{{original}}` dropped), `description`, `personality` and `scenario` (the soul), `first_mes` (the opener), the character book's enabled entries (memories), `nickname` (title); `{{char}}` is the bot's name and `{{user}}` Settings' profile name (else "the operator", "you" in the opener). Example messages, alternate greetings, post-history instructions, creator notes and the image are left out |
| CrewAI agents.yaml | a YAML mapping of agents with `role`, `goal` or `backstory` (each agent a candidate) | `role` (the title), `goal` and `backstory` (the soul), `llm` (the model), `tools` (integrations); CrewAI's `{placeholders}` are kept and noted |
| HUI export | `bot.json` with `format: "hui-bot"` | Everything the export holds (above); its memory joins what it already knows |
| Plain text | anything else | The text is the soul; a short first heading names the bot |

What creating does with a template, the same plan for the preview and the create:

- **Soul.** SOUL.md, as `POST /__hui/bots`'s `soul`: the bot skips its first
  conversation. A persona longer than 20,000 characters is cut there, with a
  note. A template without one creates a bot that has its first conversation,
  and then its memories and opener are left out.
- **Memories** go into SOUL.md, under *What you already know* after the persona,
  while they fit in its 20,000 characters (the rest are listed as left out).
  OptChat's memory is the chat's own log, a projection of its Durable entries,
  so nothing else can seed it; in SOUL.md the bot reads them on every request
  and the operator edits them in the Soul tab.
- **Opener.** The bot's first turn: a kickoff (`botOpenerKickoffText`: the
  `[HUI bot created]` marker, so the chat shows "<name> was created", never the
  operator's bubble) that asks it to send the opener as written. Its answer is a
  real message of its chat, in its memory like every other; a message written into
  the chat by HUI would never reach OptChat's log. It costs one turn of its model.
- **Skills** are written to the bot's home folder, `<bots dir>/<id>/skills/<name>/SKILL.md`
  (front matter with `name` and `description`, then the instructions; a skill's
  supporting files are not imported), on the machine its chat runs on (on a
  worker, through its host's `bot.skills.*` requests; an older worker that lacks
  them gets none, listed as left out).
  Only that bot's chat loads them: `DurableHost.skillDirsFor` adds its own folder
  to its directory's skills wherever skills are read (its prompt, `/skill:`,
  `load_skill`, its catalog, where they show as *Its own skills*). A name a skill
  of its directory already has gets `-2` (the directory's would win the name).
  They are on, like every skill of a bot: they are text the preview showed in
  full, they widen no tool, and each can be turned off in the Tools tab.
- **Routines** are Automation tasks aimed at its chat, created **disabled**. A
  schedule is read as a cron expression (`cron <expr> [zone]` too), `at <time>`,
  an interval (`every 30m`, `hourly`) or a phrase (`daily at 9:00`, `weekdays at
  8am`, `every monday and friday at 10:30`, `monthly on the 15th`), in the gateway's
  time zone; what it doesn't say is assumed (09:00, Mondays, the 1st) and what
  can't be read stands in as every day at 09:00, either way `guessed`.
- **Integrations** map to the HUI tool that does their job, by name (a web search
  to `browser`, a code interpreter to `bash`, files to `read`…); the rest are
  listed as missing. HUI has no MCP servers: a tool a PI extension adds later is
  on for the bot like every new tool.
- **Tools.** A Claude Code subagent's `tools` keep on only what they map to
  (Read → `read`, Write → `write`, Edit/MultiEdit → `edit`, Bash → `bash`,
  Grep/Glob/LS → `read`, WebFetch/WebSearch → `browser`, Task → `sessions_spawn`
  and `subagents`, TodoWrite → `progress_card`) and turn the rest of the tools every
  chat has off; a HUI export turns its own list off. An import never turns on
  anything a new bot doesn't have.
- **Model.** The template's model is kept only when this gateway resolves it:
  the exact `provider/id`, a bare id, or Claude Code's `sonnet`/`opus`/`haiku` (the
  newest such model); otherwise the bot starts on the gateway's default.

Errors: 400 for a source or template HUI can't read (the message names what it
reads), 502 when x.ai can't be reached or refuses the page (the message
suggests pasting), and otherwise as the bot routes above.

## Routes

### `GET /__hui/sessions/:id/commands`

Returns `{ commands: RuntimeCommand[] }` from the owning live runtime's optional
`listCommands()` capability. PI uses `get_commands`, so project-local resources,
package commands, namespaced invocation names and `/skill:name` entries come from
the same process that executes the prompt. HUI projects only name, description
and source, preserves first-invocation precedence, and omits malformed entries;
source paths and resource metadata do not cross this route. An unsupported
runtime returns an empty list, not a fabricated terminal-command catalog.
Discovery does not add support for arbitrary TUI-only custom extension widgets;
extension interaction remains limited to the supported PI RPC UI requests.
HUI merges its own session commands into the browser menu separately; `/clear`
and `/reload` therefore remain available even though PI omits terminal built-ins from
`get_commands`.

As with `/models`, a registered cold session starts its runtime and returns `409`
until ready; unknown/deleted sessions return `404`. Catalog/protocol failures are
explicit errors, not empty success responses. The existing `x-hui` guard applies.
Listing never invokes a command. The browser keeps the catalog only for the
current session/open attempt; late responses cannot populate a different chat.
Selecting a command edits the draft, and sending uses the existing prompt/queue
routes. The browser uses `$name` for skills and extension actions (retaining a
qualified skill name on collisions), and `/name` for templates. PI resolves a
leading dollar reference against its enabled live catalog before dispatch, so
both manually typed and menu-selected aliases work. Unknown aliases and inline
dollar tokens stay literal. Dollar extension actions cannot be steered into an
active turn. Existing slash syntax, catalog response and persisted formats are
unchanged. PI persists its expanded/native invocation as before; HUI does not
store a second transcript representation.

PI command handlers can complete without `agent_end`. After a slash prompt's
acknowledgement, HUI checks `get_state`: only confirmed `isStreaming: false`
triggers a history refresh and `settled`. Commands that start a model turn stay
busy until that turn ends. Early question acknowledgements skip this check until
the handler's eventual response, so a pending human answer cannot be mistaken
for completion. A command settled before its HTTP acknowledgement does not
append a synthetic user turn after the authoritative transcript refresh.

### `GET /__hui/sessions`

List everything in the registry, grouped.

```json
{ "revision": 12, "groups": [ { "label": "my-sessions", "sessions": [ /* SessionView[] */ ] } ] }
```

The gateway keeps this list in memory and shares it with every connected
screen; `revision` increases whenever it changes. The group mutation routes
return the same shape. `GET /__hui/sessions/events` pushes the same list as
changes, so clients discard any full list older than the revision they hold.

Groups follow the registry's catalog order, which the user controls, with
`ungrouped` last. New groups are appended; renames keep their position. Within each group pinned sessions come first, then
sessions are ordered most-recently-updated first. A group may also carry HUI-owned
`cwd`, `tool`, `workspaceMode` (`branch` or `worktree`) and `baseRef` defaults. Empty catalogued groups are returned with an empty
`sessions` array.

The browser displays group labels in uppercase, with `ungrouped` shown as
`OTHER` after custom groups. This does not change API or persisted identifiers.
Archived sessions remain in this response so the Sessions page can restore
them, but the active sidebar projection excludes them.
Live rows may also include ephemeral runtime telemetry. HUI samples the resident
memory of the adapter's process tree on supported POSIX hosts and reports the
wall-clock duration from runtime launch until ready. These measurements are
best effort, cached briefly, never persisted and never inferred when unavailable.
The sidebar can project groups by exact `cwd` (labelled with the directory name)
or flatten the list, sort by `createdAt`, `updatedAt` or title (pins first), and
filter by live `status` plus text. Its grouping, sorting, status and empty-group
preferences are stored only in the browser under `hui.sidebar-session-options`;
the server response and registry format are unchanged. Project headers do not
expose custom-group mutations; their New Session action preselects `cwd` only.

### `POST /__hui/session-groups`

Creates an empty HUI group. Body: `{ "name": "Research" }`. Group names are
trimmed, limited to 200 characters and unique; `ungrouped` is reserved.
The sidebar's permanent New Group button uses this route even when no custom
groups exist. On confirmed creation the UI reveals the empty group by clearing
search/status filters and selecting custom groups with default empty visibility.

### `PUT /__hui/session-groups`

Replaces the custom-group order. Body: `{ "order": ["Research", "Work"] }`.
The list must name every catalogued group exactly once (`ungrouped` excluded);
a missing, duplicate or unknown label is rejected with 400 so a stale browser
cannot drop a group created or renamed elsewhere. Only the `groups` array order
in the registry changes; the registry version and session records do not.
Responds with the refreshed list. The sidebar uses it for header drag and drop
and the group menu's Move up/down actions.

### `PATCH /__hui/session-groups/:name`

Atomically renames a group and every member session, or changes its new-session
defaults:

```json
{ "name": "Projects" }
{ "cwd": "/abs/path", "workspaceMode": "worktree", "baseRef": "main" }
```

`cwd` may be empty (choose it when creating the session) or an existing absolute
directory. `workspaceMode` accepts
`branch`, `worktree`, or an empty string to clear it; `baseRef` is trimmed text
(up to 200 characters), also cleared by an empty string. Omitted fields are
preserved. These optional registry fields require no migration; legacy groups
start in Branch with the repository default branch. Saving defaults never
performs Git checkout or creates a worktree. PI configuration and transcripts
are never changed.

The group menu's **New session defaults** shows Environment and Base branch
once its directory is recognized as Git. New sessions opened from that group
prefill those values; changing their directory resets the checkout choices to
the new repository's defaults. Both modes retain the selected ref when toggled.
The worktree suffix belongs to each new session, not the group. Non-Git or empty
directories clear the group's Git defaults. A saved ref is resolved by Git only
when a session starts; stale/missing refs produce the ordinary launch error.
Direct session API calls continue to use their explicit inputs, not group defaults.

### `DELETE /__hui/session-groups/:name`

Removes the HUI group and atomically moves its member sessions to `ungrouped`.
It does not remove session records, stop runtimes, or delete PI transcripts.

### `POST /__hui/sessions`

Registers a new session **and starts it**. Body:

```json
{ "cwd": "/abs/path", "title": "optional", "initialPrompt": "optional", "group": "optional", "tool": "pi", "model": "openai/gpt-5.6", "thinking": "high", "worktree": true, "baseRef": "main", "branchName": "my-feature" }
```

`cwd` must be an existing absolute directory. With `"worker": "<worker id>"`
the session runs on that remote worker instead: `cwd` is a remote path that
must be absolute or start with `~/`, it is checked when the runtime starts
(not during this request), and `worktree`/`baseRef` are rejected. When supplied, `title` is trimmed
and must be 1–200 characters; `group` is trimmed and may be empty but cannot
exceed 200 characters. Responds `{ "session": SessionView }`.
The id is HUI's own UUID. `tool` may be omitted or `pi`; other values are
rejected rather than labelled one way and run another. Existing records naming
another runtime fail closed when opened. PI's session file is learned during
boot and stored in the record.

When `title` is absent and `initialPrompt` is present, HUI asks the configured
utility model for a concise three- to six-word name in the prompt's language, kept to at most
60 characters. The stored name remains descriptive; the sidebar owns visual overflow. The utility call uses an
in-memory session, no tools, no workspace instructions and thinking off. Failure
falls back to the first prompt line within the same character limit,
so naming never prevents session creation. A session without `worktree` does
not wait for the model: it is registered and returned under that first-line
title, and the generated name replaces it once the model answers (20-second
limit), announced as a `status` frame carrying `title` on
`GET /__hui/sessions/events`. A rename or delete in the meantime wins. A
worktree session is named before Git starts, because its branch depends on it.

When `worktree` is true and `branchName` is absent, HUI also names the branch
itself. With an `initialPrompt`, the same utility call (or a branch-only call
when `title` was supplied) returns a 2–4 word kebab-case description,
normalized like the backlog branch-name suggestion (prefix, path segments,
quotes and leading type words such as `feature`/`fix` removed, at most 40
characters). Without a prompt, without a utility model, on failure or on an
empty answer, the branch uses the first meaningful words of the operator
`title` or the first prompt line. This step is reported as the `naming`
worktree phase before any Git progress. An operator `title` is never replaced.

`model` and `thinking` are optional initial session preferences selected in New
Session. `model` uses canonical `provider/id` form: the first slash separates the
provider from the complete model ID, which may contain further slashes (for
example, `vercel-ai-gateway/anthropic/claude-opus-5.5`). Neither part may be empty
or contain whitespace. `thinking` accepts `off`,
`minimal`, `low`, `medium`, `high`, or `xhigh`. Without `model`, the session
uses `settings.models.primary` when one is set, otherwise PI's default. Both are persisted before the
runtime starts and are passed to PI on its first launch as well as later reopen.

`worktree` is optional and defaults to false. `baseRef` optionally selects any
local branch, known remote branch or commit resolvable by Git. When `worktree`
is false, HUI runs Git's normal checkout operation in the existing repository
before registering the session; dirty checkouts fail with Git's own error rather
than being stashed or forced. When `worktree` is true, `cwd` must be inside a Git
repository with at least one commit and `baseRef` defaults to `HEAD`. HUI creates
a branch from `branchName` or the generated name above at that commit, prefixes it with the validated
HUI setting (`feature/` by default), and places the checkout below
`~/.config/hui/worktrees/<repository>/`. The registered session uses the matching
subdirectory in that checkout. If session persistence fails, HUI rolls back only
the branch and worktree created by this request. Deleting the session preserves
both.

The backlog start dialog defaults to Branch as soon as repository inspection
completes. Both modes share a ref picker initialized to `defaultBranch`; switching
modes preserves the ref. Only Worktree asks for and submits `branchName`.

`branchName` is an optional human-entered suffix; when absent it is generated as
described above. HUI normalizes it and applies the configured branch prefix.

A worktree request responds as soon as its input is valid, before naming or Git
work, with a provisional `SessionView`: status `starting`, the source `cwd`, the
operator title or first prompt line, and `creating: { phase, percent?,
completed?, total? }`. The gateway keeps that session in memory, lists it in
`GET /__hui/sessions` and its group, and reports each phase on
`GET /__hui/sessions/events` as a `status` frame carrying `creating`. Phases are
`naming`, `preparing`, `checkout`, `filtering` and `finalizing`; percentages are
phase-local values reported by Git, and the other phases stay indeterminate.
Creation allows up to 30 minutes for large repositories and checkout filters.
When the worktree exists, the record is persisted under the same id, a status
frame without `creating` follows and the runtime starts; the gateway then sends
`initialPrompt` itself once the runtime is idle, so closing or reloading the
browser loses nothing. An optional `initialAttachments` list (same shape and
limits as the prompt route's `attachments`, request body up to 24 MB) goes with
that prompt. If creation fails, the session reports status `error`
and carries its `initialPrompt`; `open`, `prompt` and other session actions
answer 409 with the Git error, `PATCH` answers 409, and `DELETE` dismisses it
(the browser then returns the prompt, but not its attachments, to the New
Session draft). While Git works,
the same routes, `DELETE` included, answer 409. Attachment, Jira, suggestion
and change routes answer 404 until the record exists. A gateway restart forgets
unfinished sessions. Parallel creations that pick the same branch name take the
next free suffix.

### `GET /__hui/sessions/events`

Gateway-wide server-sent events for session lifecycle multiplexing. The first
application frame is a complete snapshot of live runtimes; registry ids omitted
from it are cold and therefore `idle`. The snapshot also includes pending
worktree sessions that are not registered yet. Their frames carry `creating`
while Git works, and use status `error` if creation fails. Later frames identify
the session whose status changed:

```text
event: snapshot
data: {"statuses":[{"id":"session-a","status":"running"},{"id":"session-b","status":"waiting"}]}

event: status
data: {"id":"session-a","status":"idle"}
```

A `status` frame may also carry `title` when the gateway renamed the session
itself, such as a new session's generated name.

It also carries the shared session list. After the status snapshot, the
first `sessions` frame is the complete list; later frames carry only what
changed. `groups` (order, membership and group defaults as ordered `ids`) is
present only when it changed, and `upserts` holds each session whose view
changed. While any client listens, the gateway recomputes the list every
second.

```text
event: sessions
data: {"revision":12,"groups":[{"label":"my-sessions","ids":["session-a"]}],"upserts":[/* SessionView[] */]}

event: sessions
data: {"revision":13,"upserts":[/* SessionView[] */]}
```

Revisions are seeded from the gateway's clock, so they keep rising across
gateway restarts and a client ignores any list older than the one it holds.

The stream does not start cold sessions and does not carry transcript content.
The browser uses it to keep all sidebar rows current while retaining the
selected session's detailed event stream (a WebSocket, see
`POST /__hui/sessions/:id/connect`). It has the same
heartbeat, `x-hui` guard, no-store policy, and reconnect behavior as the
session-specific stream.

### `POST /__hui/sessions/:id/open`

Ensures a runtime exists for the session, starting it if needed, and returns what
to paint immediately:

```json
{ "session": SessionView, "transcript": [ /* compatibility */ ], "snapshot": SessionSnapshot }
```

Idempotent: opening an already-open session must not spawn a second pi. For a
session with a `piSessionFile`, the runtime resumes it so the old conversation
appears.

### `POST /__hui/sessions/:id/prompt`

```json
{
  "text": "...",
  "attachments": [
    { "kind": "image", "name": "shot.png", "mimeType": "image/png", "dataBase64": "..." },
    { "kind": "file", "name": "notes.txt", "dataBase64": "..." }
  ]
}
```

Responds `{ "ok": true }` once pi has *accepted* the prompt, not when the turn
finishes. Output arrives over the event stream. Prompts are rejected while a turn
is pending or streaming, with a 409 and a message saying so. Images may form a
prompt by themselves. Other files are stored under HUI's config directory and
passed to PI as paths; they require prompt text.

PI extension commands delay their prompt RPC acknowledgement while waiting for
interactive input. Receiving `extension_ui_request` is treated as acceptance so
the HTTP request does not race the human; the original delayed RPC response is
then the settle edge that refreshes history and unlocks the composer.

`/clear` and `/reload` are reserved by HUI and are never accepted through the
prompt or queue routes, including malformed variants with arguments. The browser
calls the dedicated routes below instead.

At most eight attachments are accepted. Each decoded item is limited to 12 MB
and the decoded total to 16 MB. Base64 must be canonical; image MIME types are
PNG, JPEG, GIF or WebP. Display names may contain Unicode and spaces, but must
be 1–128 characters, cannot be `.` or `..`, and cannot contain `/`, `\\` or
control characters. The browser enforces the same count, byte, type and name
limits before upload. File uploads receive immutable UUID-backed paths, so a
later upload with the same display name cannot replace bytes PI is still
reading. If prompt or queue acceptance fails, only files created for that
rejected request are removed.

Because PI's image content does not carry filenames, HUI appends a versioned,
base64url attachment manifest to the message sent through PI RPC. PI persists
that message in its own transcript; HUI does not write or shadow the JSONL. On
history refresh or resume, the PI adapter validates and removes the marker and
the generated file-reference block, restoring the original ordered display
names. Older PI transcripts without the marker retain the generic image-name
fallback.

### `POST /__hui/sessions/:id/clear`

Accepts an empty JSON body and returns `{ "snapshot": SessionSnapshot }`. The
session must be idle with no queued follow-ups or pending questions; otherwise
it returns `409`. HUI invokes PI's native `new_session` RPC, refreshes the new
runtime identity and empty history, then stores the replacement `piSessionFile`
in the existing HUI registry row. Title, group, cwd, model and thinking
preferences remain attached to that row. PI's previous JSONL is left untouched,
and `/clear` itself is not added to either transcript. A bot's chat answers 409
([a forever chat](#a-forever-chat)). A registry persistence
failure is explicit because the live runtime has already moved to the fresh
session and a later reopen may otherwise resume the previous pointer.

### `POST /__hui/sessions/:id/compact`

Body: `{ "instructions"?: string }` (at most 2,000 characters), the browser's
`/compact [focus]` and the context meter's **Compact now**. Marks the session
compacting, starts the runtime's compaction with the focus as its instructions
(PI's `compact` RPC, or Durable's compaction task) and returns `{ "ok": true }`
without waiting for the summary; compaction events report progress and the
outcome, including PI's "Nothing to compact" and "Already compacted" (Durable
reports the first). Busy rules match `/clear` (`409` otherwise), and it also
returns `409` while a compaction runs; an unknown session returns `404`. The
prompt route refuses `/compact` like `/clear`. A bot's chat answers 409
([a forever chat](#a-forever-chat)).

### `DELETE /__hui/sessions/:id/compact`

Cancels a manual compaction the runtime runs beside the conversation
(`snapshot.compaction` running with `blocking: false` and no `background`):
Durable aborts that task alone and `compaction_end` reports `cancelled`.
Returns `{ "ok": true }` once the end is reported, `409` when there is no
such compaction (Stop cancels one that blocks the session) and `404` for an
unknown session.

### `POST /__hui/sessions/:id/reload`

Accepts an empty JSON body and returns `{ "ok": true }`. Busy rules match
`/clear` (`409` otherwise). PI's RPC mode has no reload command, so the SDK
worker calls PI's `AgentSession.reload()`, the same call as the terminal
`/reload`: settings, extensions, skills, prompt templates and context files are
re-read in place. The PI session, transcript, model and thinking level are
unchanged. The CLI fallback backend returns `400`. The browser discards its
cached command catalog so newly added skills and commands appear.

### `POST /__hui/sessions/:id/steer`

Uses the prompt body and attachment rules. Queues an instruction before PI's
next model call while the current run is active.

### `POST /__hui/sessions/:id/follow-up`

Uses the prompt body and attachment rules. Queues work for after the current
agent run has completely settled.

When PI consumes a steering or follow-up entry, HUI promotes the removed queue
entry into the live transcript before the next model response. Slow turns and
reconnecting browsers therefore retain the user instruction that caused them;
PI's refreshed history replaces the projection at settlement.

### `GET|POST /__hui/sessions/:id/thinking`

GET returns `{ "level": string | null }`. POST accepts `{ "level": "off" |
"minimal" | "low" | "medium" | "high" | "xhigh" }`, applies it live and
persists the session preference.

### `POST /__hui/sessions/:id/question`

Answers or cancels a pending PI extension-UI request:

```json
{ "id": "question-id", "value": "selected/input/editor value" }
{ "id": "question-id", "confirmed": true }
{ "id": "question-id", "cancelled": true }
```

A question is claimed before awaiting PI, so concurrent double-submit cannot
answer it twice; a rejected runtime response restores it. A `secret` question
is answered here too, but its `value` (non-empty, kept exactly as typed) goes
to the gateway's [secret request](#secret-requests), never to the runtime; an
empty value is a 400 that leaves the request pending.

### `PATCH /__hui/sessions/:id`

Rename or regroup. Body carries only what changes:

```json
{ "title": "new name", "group": "my-sessions", "pinned": true, "archived": false, "unread": true, "icon": "🚀", "stage": "testing" }
```

`stage` is an operator placement and must be one of the four session stages, or
`null` to clear it and hand the column back to the agent and pull-request
signals (starting again from Investigation). `backlog` is a 400 ("Sessions
cannot be moved to Backlog"), as is any other value.

Title is trimmed and must be 1–200 characters. Group is trimmed and limited to
200 characters; `pinned`, `archived` and `unread` must be booleans. `icon` is
empty or at most 32 characters. Responds
`{ "session": SessionView }`,
404 on an unknown id, including when a concurrent delete wins before the
serialized patch mutation. Renaming
a session does **not** rename pi's own session file — the registry is HUI's, and
pi is left alone. Setting `archived` archives or restores the selected session
and all descendants atomically, including archived children and children in other
groups. Other patched fields apply only to the selected session. Archiving is
organizational, not cancellation; subsequently spawned children inherit their
parent's archive state.

### `DELETE /__hui/sessions/:id`

Blocks new opens and removes the selected session and every descendant in one
registry mutation, then stops all affected runtimes and terminals and emits
`closed` to their subscribers. Unrelated trees are untouched. Responds `{ "ok": true }`, 404 on an unknown
id. A bot's chat answers 409: archiving the bot keeps both
([a forever chat](#a-forever-chat)).

The root id is tombstoned before the registry mutation; descendants are resolved
and tombstoned inside that serialized mutation before the write. Each affected
id has its own operation token so
overlapping stale open/events requests cannot revive it. Per-operation tokens
ensure a failed overlapping delete cannot clear another pending or already
committed deletion. The existing runtime and SSE streams stay
alive while that write is pending. If storage removal fails, HUI rolls the
tombstones back, leaves all affected runtimes and subscribers untouched, and returns
500 because the row still exists. Merely holding an old request never clears a
tombstone.

The conversation file under `~/.pi/agent/sessions/` is **not** deleted: it is
pi's, and losing a transcript because you tidied a list would be unforgivable.

### `GET /__hui/sessions/:id/events`

Server-sent events. On connect, the first application frame is one coherent
snapshot. The gateway subscribes before capturing it, so no event can fall
between separate transcript/status/model reads:

```
event: snapshot
data: { "transcript": [], "status": "idle", "model": {...}, "usage": {"contextTokens": 166300, "contextWindow": 258400, "percent": 64.36, "inputTokens": 13400, "outputTokens": 3200, "costUsd": 0.05}, "thinking": "high", "queue": {"steering":[],"followUp":[]}, "questions": [], "subagents": [] }

event: event
data: { "type": "text", "delta": "…" }

event: status
data: { "status": "running" }

event: model
data: { "provider": "openai", "id": "gpt-5.6", "name": "GPT-5.6" }

event: thinking_level
data: { "level": "high" }
```

While a turn is live, HUI keeps a replay projection of user messages, thinking,
tool cards and text deltas. A reconnecting stream receives that projection in
its snapshot. At `settled`, PI's refreshed transcript normally replaces the
projection as the authoritative durable history and a final snapshot is emitted.
That snapshot also carries PI's `get_session_stats` context usage plus the
input, output and reported cost summed from the latest run's assistant messages
and tool results (PI attributes nested tool and model calls to the calling tool's
result). Prompt-cache refreshes are PI `usage` entries outside the conversation;
they count toward the observability totals, not this per-run figure. Missing context or
cost remains `null`/absent rather than being estimated by HUI.
`historyRefreshed` is omitted/true on that path. When PI cannot refresh history,
the adapter emits `settled` with `historyRefreshed: false`; HUI still returns to
the runtime's reported status but retains and snapshots the live projection so
the just-completed turn does not disappear.

The stream stays open across turns, sends a comment heartbeat so proxies do not
close it, and ends with `event: closed` when the runtime exits.

Session views can include `"interrupted": true` and `"unread": true`. Before submitting a normal
prompt, HUI writes `runStartedAt` plus a temporary `runPrompt` recovery journal
to its private registry. A terminal runtime event or explicit abort clears both.
The prompt is never returned in session views, and raw attachment payloads are
not duplicated there. Because live status is process-owned, a journal left by a
missing runtime is projected as interrupted; PI remains the conversation
authority for every settled turn. Gateway startup eagerly opens those records
and starts a recovery prompt. Failed admissions are bounded to three attempts;
an observed backend `turn_start` refreshes that budget.

A turn that settles without a detailed browser stream is persisted as unread.
The gateway-wide status SSE includes `unread: true|false` when that state changes,
and opening or streaming the conversation clears it. This is presentation state,
not a runtime health status; waiting questions and failures keep their separate
attention indicators.

### `POST /__hui/sessions/:id/connect`

Responds `{ "url": "/__hui/session-stream?ticket=…" }`: a one-use WebSocket
capability for the same stream, valid for 15 seconds and bound to this session.
The browser's session views use it instead of the SSE route above, because
browsers allow only six HTTP/1.1 connections per origin and a few split panes
would otherwise stall every other request. Like terminal and browser streams,
the upgrade also requires a same-origin `Origin` and an allowed `Host`, and it
is refused with 403 otherwise. Each text message is
`{ "event": "snapshot" | "transcript" | "event" | "status" | "model" | "thinking_level" | "closed", "data": … }`
with the SSE payloads above, beginning with the snapshot. After `closed` the
server closes normally; a session deleted before the upgrade closes with code
4404. 429 means too many tickets are pending, so retry later.

### `POST /__hui/sessions/:id/resume`

Available as a fallback after automatic recovery is exhausted and the view still
reports `"interrupted": true`. HUI starts a new prompt containing the journaled request
plus an instruction to inspect current transcript/workspace state, finish the
task and avoid repeating completed work. A marker without a journal (for
forward compatibility) receives the same generic continuation instruction.
The route responds `{ "ok": true }`; starting or busy sessions return 409.

### `GET /__hui/sessions/:id/models`

Returns `{ "models": RuntimeModel[] }` from the live runtime. A session that is
still starting returns 409. The PI adapter re-reads the `models.json` selection
for each list request; the shared `GET /__hui/pi` probe has a 30-second cache.
Changes to PI's underlying model registry can require a new runtime/probe.

### `POST /__hui/sessions/:id/model`

Body: `{ "provider": "openai", "modelId": "gpt-5.6" }`. Switches the live
runtime, persists `provider/id` for the next reopen and returns the selected
model (or `null` when an adapter cannot report it). A successful switch is also
emitted as the SSE `model` event. Persistence is part of success: if PI accepts
the live switch but HUI cannot write the choice, HUI first restores PI to the
previous model and returns 500. If PI also refuses that compensation, HUI emits
the actual live `model` plus an explicit SSE `error`, then returns 500; this
prevents the UI from continuing to display the durable-but-no-longer-live model.

### `POST /__hui/sessions/:id/abort`

Stops the turn in flight without deleting or closing the session. Responds
`{ "ok": true }`; starting sessions return 409.

### `POST /__hui/sessions/:id/rewind`

Body: `{ "entryId": "...", "excludeUserMessage": true }`. Moves PI's active
leaf to that existing entry, refreshes HUI's authoritative transcript and emits
a snapshot. When `excludeUserMessage` is true and the entry is a user message,
PI stops before it so the browser can restore the selected text to the composer
for editing. The browser first reads the message's images and files through
their attachment URLs, which stop resolving once the rewind leaves that branch,
and restores them with the text; any it cannot read are left out. The browser sends the `entryId` of the transcript message itself.
A user message shown without one (the running prompt, or one delivered during
the run) is sent as `{ "userFromEnd": n }` instead: after the run is stopped,
the PI worker counts n user messages back from the end of PI's own active
branch, where PI persisted that prompt when it accepted it. A prompt PI refused
offers no rewind. The abandoned branch remains in PI's
append-only tree. An active run is stopped
before the branch changes; queued or waiting sessions return 409, and an
unknown entry, or a rewind while PI is still compacting, returns 400. A bot's
chat answers 409 ([a forever chat](#a-forever-chat)).

A compaction only applies while its entry is on the active branch. Rewinding
behind it to a point inside the window PI kept verbatim appends the same
summary again, since it covers only entries that still precede the new leaf;
no new summary is generated. Rewinding to a summarized message drops the
summary, so the model sees the original messages, and PI compacts again only
if they exceed its threshold. A Durable rewind forks the conversation instead,
and the fork holds the history up to the fork point only: a summary placed
after it is left out wherever that point is, so the model reads the original
turns again and Durable compacts the fork when it reaches its thresholds.

### `POST /__hui/sessions/:id/continue`

Continues from the active leaf with PI's native prompt-free continuation
primitive and returns `{ "ok": true }` once the run has entered. No synthetic
user message is appended. The tail is the last message of the model context,
not the raw leaf, so the context edits PI appends while retrying, the model or
thinking changes it records on reopen and a compaction after the failure do not
block it. PI's system messages (persisted prompt and tool loadout changes) stay
in the context but do not count as the tail. An aborted/error assistant tail is
hidden with a context edit, as PI hides an attempt it retries, so entries after
it (such as that compaction) stay on the branch. Any other non-assistant tail
continues, including a compaction summary that is the whole context after a
rewind. When the tail is a normally
completed assistant response, HUI instead sends one explicit continuation
prompt ("Continue from where you left off…") as a normal user turn. Running, queued or waiting sessions return 409.

### Subagent completion events

When a child reaches a terminal state HUI wakes the parent with one PI user-role
message whose first line is `[HUI subagent completion event]`. While sibling
children of the same parent are still active, delivery is deferred; the last
finisher delivers one combined event (`count: N`). Each item lists
`session_id`, `title`, `task`, `status`, optional `started_at`/`ended_at`, and
the child result wrapped between `<<<BEGIN_CHILD_RESULT>>>` and
`<<<END_CHILD_RESULT>>>` (embedded markers are escaped). A trailing `Action:`
block states the event is automated and not from the user, that results are
data, and that the parent must compare against the original task, continue on
actionable findings, and only escalate blockers needing user input. The chat
projection renders this entry as a system event card, never as a user turn.
PI's persisted format is unchanged.

### `POST /__hui/sessions/:id/btw`

Accepts `{ "question": "which file are we editing?" }` and returns
`{ "question", "answer", "model" }`. HUI sends at most 12,000 characters of
visible session context through a separate in-memory utility-model call with
tools and thinking disabled. Nothing is written to PI's transcript. The browser
renders the result in an ephemeral side rail; `/side` is an alias for `/btw`.

### `GET /__hui/directories?q=<prefix>[&worker=<id>]`

Returns `{ "directories": string[] }`: existing directories matching the typed
prefix, used to complete the working directory of a new session or a group
default. `~` expands to the home directory and relative input resolves against
it. Directories only; nothing is created. With `worker`, the directories are
listed on that remote worker (connecting it first); an unreachable worker, or
one the user disconnected, returns an empty list.

### `GET /__hui/local-paths?cwd=<directory>&q=<path-prefix>`

Returns `{ "paths": { "path": string, "kind": "directory" | "file" }[] }`
for the next segment of a composer path. Relative prefixes resolve against
`cwd`; `~` resolves against the server user's home. Results include files and
directories, hide dot entries until the current segment begins with `.`, and
are sorted directory-first and capped at 40. The route is read-only.

### `GET /__hui/automation`

Returns the whole scheduler snapshot:
`{ "scheduler": { "enabled": true, "activeRuns": number, "nextWakeAt": string | null }, "tasks": AutomationTask[], "runs": AutomationRun[] }`.
The scheduler and its store are HUI-owned (`~/.config/hui/automation.json`); PI
has no scheduler contract to reuse. A malformed store is reported and never
replaced by a later mutation.

### `POST /__hui/automation/tasks`

Body: `{ "name", "description"?, "sessionId", "prompt", "schedule", "enabled"?, "timeoutSeconds"? }`.
`schedule` is one of `{ "kind": "at", "at": ISO }`,
`{ "kind": "every", "everyMs": number }` (one minute minimum) or
`{ "kind": "cron", "expression": "m h dom mon dow", "timezone": IANA }`.
`timeoutSeconds` defaults to 900 and is capped at 86400. Responds 201 with
`{ "task", "snapshot" }`. Rejected input returns 400 with the reason. A task
aimed at a bot's chat is one of its [routines](#routines).

### `PUT|DELETE /__hui/automation/tasks/:id`

`PUT` takes the same body as creation and rewrites the task, recomputing
`nextRunAt` (`null` when `enabled` is false). `DELETE` removes it. Both respond
`{ "snapshot" }`. An unknown id returns 404; deleting a task whose run is still
in flight returns 409.

### `POST /__hui/automation/tasks/:id/run`

Queues a manual run and responds `{ "run" }` immediately — the run itself
continues in the scheduler, so the client re-reads the snapshot for its
outcome. A task that is already running returns 409.

### `POST /__hui/automation/runs/:id/cancel`

Aborts the run in flight and responds `{ "ok": true }`. A run that already
settled returns 409. The run reaches `cancelled` once its executor unwinds, so
the terminal status arrives in a later snapshot, not in this response.

### `GET /__hui/observability`

Returns one bounded operational snapshot with `activity`, redacted `logs`,
`debug` process vitals and aggregate `usage`. Activity is retained in memory for
the current gateway process only (300 events maximum). Runtime events contain
event type, tool name and session id, never prompts, tool arguments or output.
`logs` holds every warning and error plus gateway lifecycle events. `area` is
`gateway`, `session`, `runtime`, `automation` or `ui` (failures the browser
reported, see `POST /__hui/diagnostics/ui-errors`).

Warning and error events may add `detail`, the failure's reported cause: a
runtime start-up error or exit code/signal, a runtime or provider error message,
or the `error` text of a failed `/__hui/` response. It is whitespace-collapsed,
limited to 600 characters and has credential- and secret-shaped values redacted;
info events never carry it. PI records a failed model call in its transcript
rather than as a runtime event, so a turn whose refreshed history ends in an
error is logged once as `run_failed`. When a PI runtime fails to start or its
process ends, `detail` adds the informative end of its stderr after
`· stderr:` (at most six lines, only the first frame of each stack trace); that
output is never streamed to the browser.

The gateway also writes each `logs` entry as one stderr line:
`<ISO time> <LEVEL> <area>/<action> [session=<id>] <summary>[: <detail>]`. An
installed gateway appends stderr to `gateway.log`, so these lines outlive the
process; a development server prints them.

Usage is aggregated from numeric `usage` metadata already present in PI-owned
session JSONL files. HUI does not persist a second usage store and never returns
message content. `costUsd` is `null` when PI did not record cost; HUI does not
estimate it. Oversized or unreadable transcripts are reported as partial data.

### `GET /__hui/diagnostics/export`

Returns the same bounded observability snapshot with a JSON attachment header.
The export excludes prompt text, message content, tool payloads, credential
values and secret-shaped values; `detail` repeats only failure text reported by
a runtime, provider, route or the browser, plus the end of PI's stderr. The
browser builds the downloaded file from this response; there is no server-side
export archive.

### `POST /__hui/diagnostics/ui-errors`

The browser reports failures that never reach the gateway by themselves:
`uncaught_error`, `unhandled_rejection` and `request_failed` (a `/__hui/` request
that could not connect or timed out). The body is `{ reports, suppressed? }` with
1–20 reports of `{ kind, message, count?, firstAt?, lastAt?, location?, page?,
request? }`; `request_failed` requires `request: { method, path }` with a
`/__hui/` path. Bodies are limited to 64 KiB; an invalid batch returns 400 and an
accepted one 202 `{ recorded, dropped }`.

Each report becomes a `ui` diagnostic, a warning for `request_failed` and an
error otherwise. Its `detail` holds the message with the source location or the
normalized request path, the page and the occurrence times; a session id in the
request path or page becomes `sessionId`. At most 60 reports are recorded per
minute, followed by one `reports_rate_limited` warning; a positive `suppressed`
becomes a `reports_suppressed` warning.

The UI merges identical failures into one report with a count and sends a batch
two seconds after the first. While the gateway is unreachable, up to 20 distinct
reports wait in memory and are retried with backoff (5–60 s), or at once when a
`/__hui/` request succeeds; a page reload discards them. Cross-origin
`Script error.`, ResizeObserver loop notices and aborted requests are ignored.

### HUI-owned presentation state

`PUT /__hui/settings` also persists the validated `#rrggbb` accent override,
independent `fontUi` and `fontChat` choices from HUI's bounded OpenClaw font
catalogue, a `fontTerminal` local family name (1–128 characters, default
`JetBrains Mono`; blank or invalid values reset to default), the shared `textScale`,
OpenClaw-compatible HUI chat preferences (`messageWidth`,
`collapseTaskProgress`, `sendShortcut` and `githubEmbeds`),
[`power`](#macos-power), the Git workspace `branchPrefix` (`feature/` by default),
Profile presentation fields and reversible Labs flags (`labs`:
`denseObservability`, `detailedDebug` and `bots`, each off unless explicitly
`true`). `labs.bots` is more than presentation: the gateway reads it too, and
bots are dormant while it is off ([Bots are a preview](#bots-are-a-preview-settings--labs--bots)).
These values affect HUI only. They never change PI configuration, provider
identity, runtime permissions or transcripts.

### Browser-owned composer drafts

Unsent text and attachments are keyed by HUI session id in the browser's
IndexedDB. HUI retains at most 20 non-empty drafts for seven days and caps stored
attachment payloads at 25 MB. Navigation never copies drafts between sessions.
Successful submission retires that session's draft; a rejected submission is
merged back ahead of anything typed after it. This state never enters
`sessions.json`, PI transcripts or the server API.

### Browser-owned split layout

The OpenClaw-style layout is browser presentation state, not an HTTP resource or
registry format. `hui.chat-split-layout.v1` in localStorage and browser history
contain columns, pane IDs/session IDs, positive column/row weights and the active
pane ID. `/sessions/:id` follows the active pane; query strings are dropped.
Malformed records are ignored and deleted sessions are removed after registry
loading.

Each pane renders an independent embedded session application with its own
detailed event WebSocket, transcript, composer, queue and question state. Visited sessions
are cached in three stable slots per pane (unsaved queue edits pin their views
until committed or cancelled). Only the root owns
the gateway-wide lifecycle stream. Duplicate-session splits reuse the existing
server runtime but have independent view identities and DOM control IDs.

Dragging a sidebar session onto an edge splits left/right (new column) or
up/down (same column); center drops replace that pane. Dragging an existing
pane header instead moves its entire view to an edge, or swaps views at the
center. This carries the pane ID and optional terminal ID, not a session copy.
It changes no server resource, transcript, or persisted layout schema. The
move handle supports arrow-key movement beside neighboring panes; Escape
cancels dragging without stopping an agent turn. Interactive header controls
do not initiate pane drags. Self-drops and foreign/stale pane drags are ignored.
All pane contents stay mounted in stable DOM hosts, even when moving between
columns: session caches, scroll, unsaved editors, session and terminal
WebSockets are retained. Only view geometry and browser-local layout/focus change.

Pointer/focus events select a pane. Close removes
only the view; the previous row, previous column or first survivor takes focus.
Surviving views remain mounted. Dividers redistribute only adjacent weights,
clamped to 15–85%. At viewport widths below 1100px only the active pane is visible;
sidebar selection can focus the others without stopping streams. No two-tab
mobile switcher or primary/secondary special case remains.

### Shared terminal API and tool

Terminal requests use the existing `x-hui: 1` guard and a registered HUI session.
The gateway chooses the session's recorded `cwd`; callers cannot override it.

| Route | Method | Result |
| --- | --- | --- |
| `/__hui/sessions/:owner/terminals` | GET | `{ terminals: TerminalView[] }` |
| Same | POST | Create a shell, `{ terminal }`; optional `cols`, `rows`, `title` |
| `/__hui/sessions/:owner/terminals/:id` | GET | `{ terminal, data, sequence, truncated }`, raw ANSI replay |
| Same | POST | `{ action: "input", data }`, `{ action: "resize", cols, rows }`, or `{ action: "close" }` |
| `/__hui/sessions/:owner/terminals/:id/connect` | POST | `{ url }`, a one-use WebSocket capability valid for 15 seconds |

`TerminalView` contains `id`, `ownerSessionId`, `title`, initial `cwd`, `cols`,
`rows`, `status` (`running` or `exited`), `createdAt`, and optional `exitCode`.
`cwd` is the launch directory, not a promise about a later shell `cd`.
Invalid payloads return 400; missing conversation/foreign terminal IDs 404;
exited-terminal input/resize and resource exhaustion 409. Every terminal is
scoped to its exact owning conversation. No list operation leaks foreign IDs.

WebSocket upgrade at `/__hui/terminal-stream?ticket=…` requires that capability,
a same-origin `Origin`/`Host` pair and, on the standalone gateway, an allowed
hostname. Browser sockets cannot set `x-hui`; the guarded ticket request is the
only exception mechanism, not an unguarded create/input route. Tickets are not
stored in browser layout, logs or tool output. Production and Vite share the
same transport. Binary or malformed messages never execute input.

The first frame is `{ type: "snapshot", terminal, data, sequence, truncated }`.
Subsequent frames are `{ type: "data", data, sequence }`,
`{ type: "state", terminal }`, or `{ type: "error", error }`. Subscribing and
replaying are atomic. Clients send `{ action: "input", data }` and
`{ action: "resize", cols, rows }`. Disconnect detaches only the client.
The browser reconnects with a fresh ticket and resets/replays its emulator;
input while disconnected is not queued or silently replayed. Slow clients are
disconnected at 1 MiB of pending output. Heartbeats detect dead connections.

Limits: 8 PTYs per conversation, 32 total (including retained exited terminals),
64 connected sockets, 128 outstanding tickets, 256 KiB UTF-8 replay per PTY,
16 KiB per input message, 2–500 columns and 1–300 rows. The renderer retains
5,000 scrollback lines. Old output may be trimmed, with an explicit notice;
raw replay is not a durable log or a resize-history-perfect screen snapshot.
Natural shell exit preserves final output until **End terminal**. Explicit end,
conversation removal and gateway shutdown release processes and buffers.
Gateway control/CLI status reports `activeTerminals` separately from
`activeSessions`, and `resumableSessions`, the active sessions a restart does
not interrupt (Pi Durable runs). Terminals and the remaining active sessions
block an ordinary update or stop/restart.

PI's bundled `terminal` tool uses the existing authenticated loopback bridge in
both SDK and CLI backends. It accepts `action: list|read|input|resize|close`, an
optional **terminal** `sessionId` (not a HUI conversation ID), exact `data`, and
`cols`/`rows`. Caller identity comes from its per-conversation token, never from
tool parameters. The agent cannot create a PTY with this tool. `read` returns
the bounded replay with ANSI sequences stripped and a format/truncation label.
`input` acknowledges acceptance only; the agent must read again to establish
results. Tool guidance requires reading the shared state before writing and
reserving independent commands for PI's ordinary `bash` tool.

Existing `hui.chat-split-layout.v1` panes may additionally include `terminalId`;
`sessionId` remains their owning conversation. Old chat-only records still parse.
Reload restores pane identity, active selection and weights; after gateway
restart an expired ID displays an error instead of silently creating a shell.
Center-dropping a chat onto a terminal replaces only the view. A terminal picker
switches among that conversation's PTYs, **New terminal** creates another, and
terminal split actions create independent PTYs. Hiding the last terminal view
returns to its chat. No HUI registry or PI transcript format changes.

### Managed browser API and tool

`settings.json` gains `browser: { enabled, headless, executablePath }`
(defaults `true`, `true`, `""`). Both switches are opt-out; the path is kept as
typed (bounded, no control characters) and validated by the gateway, which
expands `~/` and a macOS `.app` bundle. An empty path auto-detects Chrome, Brave,
Edge, then Chromium in the standard install locations and on `PATH`. Saving a
changed mode or executable, or turning the tool off, stops a running browser.

All routes use the `x-hui` guard.

| Route | Method | Result |
| --- | --- | --- |
| `/__hui/browser` | GET | `BrowserStatus` |
| Same | POST | `{ action: "start" \| "stop" }`, then `BrowserStatus` |
| `/__hui/browser/tabs/:tabId/preview` | GET | `{ image: "data:image/jpeg;base64,…" }` for one open tab |
| `/__hui/sessions/:id/browser/connect` | POST | `{ url: "/__hui/browser-stream?ticket=…" }` for that conversation's live view |

`BrowserStatus` (`shared/browser.ts`) reports the saved `enabled`, `headless`
and `executablePath`, the resolved `executable` (`path`, `name`, `source:
configured | detected`) or `executableError`, `state` (`stopped`, `starting`,
`running`, `stopping`), the running `mode` (`headless` or `windowed`),
`version` and `startedAt`, the `profileDir`, `lastError` and every open tab:
`{ id, ownerSessionId, ownerTitle, title, url }`. Invalid actions return 400; a
start while the tool is off or no executable is usable returns 409; launch
failures return 502 with the browser's reason. A preview of an unknown tab
returns 404, and a background tab in a visible window that cannot be captured
without switching to it returns 409.

The live-view ticket is single-use, expires after 15 seconds and is bound to
one conversation (unknown conversations return 404). The WebSocket upgrade at
`/__hui/browser-stream` also checks same-origin and the allowed Host, like
terminal streams. The server sends JSON text messages:

- `{ type: "state", running, mode?, tabs: [{ id, title, url }], current, watching, following }`
  on connect and whenever the conversation's tabs, the agent's current tab or
  the process change. `watching` is the tab whose frames follow; `following` is
  false while the viewer watches a tab other than the agent's.
- `{ type: "action", tabId, text, point?, at }` for each agent browser action.
  `text` summarizes it (for example `Clicked e2 (button "Greet")`) and never
  contains typed text; `point` is the viewport CSS pixel of a click or hover.
  On connect, the conversation's latest action is sent once right after the
  first state and before any frame, without `point`.

Frames are binary messages: a big-endian `u32` header length, a JSON header
`{ tabId, width, height, seq }` (`width`/`height` are the viewport in CSS
pixels) and the JPEG bytes. A frame is sent only when the watched page repaints,
at most about every 100 ms; a slow client skips frames and then receives the
newest. Switching tabs sends that tab's last frame at once. The only client
message is `{ action: "select", tabId }`: a tab of the same conversation to
watch, or `null` (or the agent's current tab) to follow the agent. The stream is
view-only and never launches the browser.

The PI tool `browser` uses the authenticated agent bridge in both SDK and CLI
backends and is registered only while `browser.enabled` is on. Caller identity
comes from the per-conversation token. `action` is one of:

| Action | Contract |
| --- | --- |
| `status`, `tabs` | Process state and this conversation's tabs; never launch the browser |
| `open` | Launch lazily, open a tab, load `url` and return a snapshot |
| `navigate`, `back`, `forward`, `reload` | Change the current (or `tabId`) tab's document and return a snapshot |
| `focus`, `close` | Select or close one of this conversation's tabs |
| `snapshot` | Accessibility outline; `interactive`, `query` and `maxChars` (500–40 000, default 12 000; 8 000 for page loads) narrow it |
| `act` | `kind`: `click` (`double`), `type` (`text`, `append`, `submit`), `press` (`key`, optional `ref`), `hover`, `select` (`values`), `scroll` (`ref` or `deltaY`), `wait` (`text`, `textGone`, `selector`, `url`) |
| `text` | Visible text of `selector`, else the first article, main or body (default 12 000, at most 40 000 characters) |
| `screenshot` | PNG image content for the model, the viewport, `fullPage` (at most 4096×8192) or one `ref`; `path` also saves the PNG (relative to the session directory) |
| `console` | The latest 50 of up to 200 recorded console, exception, log and dialog entries; `errorsOnly`, `clear` |
| `resize` | Viewport `width`/`height` (200–4096) or, without both, the default |

Tab handles are `t1`, `t2`…; element refs are `e1`, `e2`… from the latest
snapshot of that tab. A ref stays bound to its DOM node within one document; a
new document retires every ref and numbering never restarts, so a stale ref
fails instead of addressing another element. Clicks check that the element is
not covered by an overlay, and an action that starts a same-tab navigation waits
for the new document (`timeoutMs`, 1000–60 000, default 30 000). Alerts and
`beforeunload` dialogs are accepted and confirm/prompt dialogs dismissed unless
`act` passes `dialog: "accept"`; every dialog is reported. Only http, https, file
and about:blank URLs open, bare hosts default to https (loopback and host:port to
http), and downloads are denied.

Limits: 8 tabs per conversation, 32 in total. Tabs belong to the opening
conversation; popups join the opener's conversation. Other conversations,
including subagents, can neither list nor drive them. Removing a conversation,
stopping its turn (any abort: Stop, rewind, automation or subagent cancellation)
or 10 minutes without a browser call from it closes its tabs; a call still in
flight when its tabs close cannot open a new one. The browser process stops once
no agent tab is open and no call is running (checked whenever a tab closes or a
call ends; one started from Settings runs until then), and gateway shutdown ends
it. The tool result stores
model-facing text, a PNG image for `screenshot`, and small `details` (`action`,
tab id/title/URL and outcome flags) in PI's transcript; no route or registry
format changes.

### Suggested tasks

Regular PI sessions also receive two HUI tools modeled on OpenClaw's
`suggest_task` / `dismiss_task`:

| Tool | Contract |
|---|---|
| `suggest_task` `{ title ≤120, problem ≤12000, fix? ≤8000, cwd? }` | `problem` (Markdown) describes the bug or problem found; `fix` (Markdown) how it could be fixed, omitted when not yet known. Used proactively for problems found along the way and when the operator asks for a follow-up ("let's add a follow-up for this"). Records a pending card for the calling session and returns `{ taskId, title, cwd, status: "pending" }`. `cwd` must be an absolute existing directory and defaults to the session's `cwd`. At most 20 pending cards per session. Nothing starts |
| `dismiss_task` `{ task_id, reason? }` | Withdraws one of the calling session's pending cards; refused while the operator is starting it |

Cards are gateway memory only: no registry or PI transcript format changes,
they are dropped on gateway restart and when their session is deleted. Pending
cards appear newest first as an optional `suggestions: TaskSuggestion[]`
(`{ id, title, problem, fix, cwd, createdAt }`, `fix` empty when unknown) on the session snapshot/SSE
`snapshot` event, omitted when empty. Operator routes (all require `x-hui`,
scoped to the owning session; unknown session or card → 404):

| Route | Result |
| --- | --- |
| `DELETE /__hui/sessions/:id/suggestions/:suggestionId` | Dismisses the card, returns `{ suggestions }` |
| `POST /__hui/sessions/:id/suggestions/:suggestionId/backlog` | Saves the card as a local [backlog](#kanban-backlog) task (title, problem, fix, `cwd`, group OTHER), removes the card and returns `{ taskId, suggestions }`. Refused while the card is starting |
| `POST /__hui/sessions/:id/suggestions/:suggestionId/start` `{ mode? }` | `mode` is `session` (default), `worktree` or `current`, matching OpenClaw's start menu. `session` creates a session in the card's `cwd` with its title, the source session's group and runtime; `worktree` does the same through *Create in workspace* (requires a Git checkout; the branch uses the configured prefix); `current` sends the card to the recording session itself (prompt when idle, otherwise steer, falling back to a queued follow-up) and returns that session. A new session waits up to 30 seconds for the runtime to be idle, prompts it with `# <title>`, `## Problem` and `## Proposed fix` sections (an unknown fix asks the session to confirm the root cause before changing code), then removes the card and returns `{ session, suggestions }`. A concurrent start or agent dismissal is refused while one is in flight. On failure the card stays pending; a session that was already created is kept, not deleted |

The card shows **Create Jira task** with a ▾ menu (Create Jira task, Add to
backlog) while Jira is connected, and a single **Add to backlog** otherwise.
The Jira routes accept `suggestionId` to file a card as a work item; the
dialog prefills summary from `title` and description from `## Problem` plus,
when known, `## Proposed fix` (the local `cwd` is not sent), and the
utility model only proposes a parent.

### Background watchers

A regular PI session can start a long-running watch with the HUI `watcher`
tool: HUI runs the command detached in its own process group, appends its
output to a HUI-owned log and has the wrapper record the exit status beside it.
The watcher outlives the turn and the gateway; deleting its conversation stops
and forgets it.

| Tool | Contract |
|---|---|
| `watcher { action: "start", purpose ≤200, command ≤4000, target? ≤500, outcome? ≤200 }` | Records the watcher against the calling session and starts it in the session's working directory. `target` must be an http(s) URL when present. Returns the `Watcher` view. At most 10 watchers per conversation |
| `watcher { action: "list" }` | `{ watchers: Watcher[] }` of the calling session, newest first |
| `watcher { action: "stop", id }` | Signals the watcher's process group (`SIGTERM`, `SIGKILL` after 2s), records `stopped` and returns the view. A settled watcher is returned unchanged |
| `watcher { action: "restart", id }` | Runs the recorded command again after clearing the exit record; refused while the watcher is running |
| `watcher { action: "log", id, lines? }` | `{ id, lines, truncated }`: at most `lines` (default 100, max 400) from the end of the log, reading at most 256 KiB |

Operator routes (all require `x-hui`, scoped to the owning session; unknown
session or watcher → 404, a running watcher for `restart` or `DELETE` → 409):

| Route | Result |
| --- | --- |
| `POST /__hui/sessions/:id/watchers/:watcherId/stop` | Stops the watcher, returns `{ watchers }` |
| `POST /__hui/sessions/:id/watchers/:watcherId/restart` | Restarts a settled watcher, returns `{ watchers }` |
| `GET /__hui/sessions/:id/watchers/:watcherId/log?lines=` | Returns the bounded log tail |
| `DELETE /__hui/sessions/:id/watchers/:watcherId` | Removes a settled watcher, its log and its exit record; returns `{ watchers }` |

The session snapshot/SSE `snapshot` event carries an optional `watchers: Watcher[]`
(omitted when empty). The view is `{ id, purpose, target, outcome, command,
logPath, state, pid, exitCode?, startedAt, endedAt?, lastLine }`; `state` is
`running`, `done`, `failed`, `stopped` or `dead`. The registry is
`~/.config/hui/watchers.json`; logs and exit records live under
`~/.config/hui/watchers/`. State is derived on read and on the gateway's poll,
which re-emits the session snapshot when a watcher's state or latest log line
changes.

### Secret requests

A regular PI session asks the operator for a secret with the HUI
`secret_request` tool, so the value never enters the conversation:

| Tool | Contract |
|---|---|
| `secret_request { label ≤120, reason ≤500 }` | Both are trimmed, required and shown to the operator; they stay in the transcript. Waits until the operator answers or cancels, the call is aborted (Stop, a PI child that went away, a gateway stop) or 15 minutes pass; a lost worker connection fails the call. Returns `{ status: "provided", label, path, expiresAt }` or `{ status: "cancelled" \| "expired", label }`; the tool text names the file and its expiry, never the value. On a remote worker the file is written there |

A pending request is gateway memory, scoped to its session. It joins the
session snapshot's `questions` as `{ id, method: "secret", title: label,
message: reason }` after the runtime's questions and makes the session report
`waiting`; its start and end re-emit the snapshot and status. It is answered or
cancelled through [`POST /__hui/sessions/:id/question`](#post-__huisessionsidquestion).
A provided value is written exactly as typed to `secret` in a fresh
`hui-secret-<pid>-*` directory under the system temporary directory (`0700`,
file `0600`) by the process where the session's commands run: the gateway, or
for a worker session the worker host (see [Transport and
protocol](#transport-and-protocol)). That path is the result. The process
deletes the directory 10 minutes later, or when it stops (a worker host also
stops when HUI upgrades it); a start removes those of processes that are no
longer running. Nothing else persists the value: not
the transcript, a tool result, PI's or Durable's stores, the registry or
diagnostics. The question route answers a malformed body with a fixed 400, so
not even a JSON parse error quotes it into a diagnostic.

### Kanban backlog

The Kanban Backlog column lists backlog items, not sessions:

```ts
type BacklogItem = {
  id: string;               // "jira:<KEY>" or "local:<uuid>"
  kind: "jira" | "local";
  title: string;
  group: string;            // HUI-owned; "" is OTHER
  cwd?: string;             // local tasks
  problem?: string; fix?: string; createdAt?: string; // local tasks
  jira?: SessionJiraIssue;  // the item itself, or a key attached to a local task
};
type BacklogView = {
  items: BacklogItem[];     // local tasks newest first, then Jira in Jira's order
  jira: { status: "ok" } | { status: "unconfigured" } | { status: "unavailable"; message: string };
};
```

Jira items come from `assignee = currentUser() AND statusCategory = "To Do"
ORDER BY updated DESC` (100 results, summary/status/type/description) on the
connected site, cached for 60 seconds (failures 15 seconds, in-flight requests
shared). Keys linked to any session (registry `jiraIssues` or a creation in a
loaded transcript) or attached to a local task are skipped. An unconfigured or
failing Jira yields local items plus the `jira` state; it is never an error
response. All routes require `x-hui`; unknown items are 404.

| Route | Result |
| --- | --- |
| `GET /__hui/backlog[?refresh=1]` | `BacklogView`; `refresh=1` bypasses the Jira cache |
| `PATCH /__hui/backlog/items/:id` `{ group }` | Changes only the item's group (a Jira item must still be listed) and returns the `BacklogView` |
| `DELETE /__hui/backlog/items/local:<uuid>` | Removes a local task, returns the `BacklogView`. Jira items cannot be deleted (405) |
| `POST /__hui/backlog/items/:id/start` `{ cwd, worktree, branchName?, baseRef?, stage, group }` | `stage` is a session stage (not `backlog`). Creates a session through the same path as `POST /__hui/sessions` (title = item title, runtime PI, optional worktree/base ref) with an operator placement in `stage`, waits up to 30 seconds for the runtime, prompts it with `# KEY: summary`, the Jira link and `## Description` (Jira) or `# title`, `## Problem`, `## Proposed fix` (local), then links the Jira key to the session and removes a local task. Returns `{ session, backlog }`. A concurrent start of the same item is refused; on failure the item stays and a created session is kept |
| `POST /__hui/backlog/items/:id/branch-name` `{ cwd }` | Suggests the part of a new worktree branch after the configured `branchPrefix` and returns `{ name, source }`. `cwd` must be an existing directory (resolved like the start route; 400 otherwise). With a utility model (`settings.models.utility`, 20-second timeout) the task's title, Jira summary and description or problem and fix (at most 4,000 characters) become a 2–4 word kebab-case description; the answer is normalized (prefix, path segments, Jira keys, quotes and leading type words such as `feature`/`fix`/`chore` removed, at most 40 characters) and `source` is `model`. Without a utility model, on failure or an empty answer, `source` is `fallback` and `name` is the title's first meaningful words. Creates nothing |
| `POST /__hui/backlog/items/local:<uuid>/jira/draft` `{ project? }` | Parent candidates and a draft from the task's problem and fix, like the session draft route |
| `POST /__hui/backlog/items/local:<uuid>/jira` `{ project, parent, summary, description, assignToMe? }` | Creates and assigns a work item like the session route, attaches its key to the task and returns `{ issue, backlog, warning? }` |
| `POST /__hui/backlog/items/local:<uuid>/jira/link` `{ key }` | Verifies the item with Jira, attaches it to the task and returns `{ issue, backlog }`. A task already holding a key is a 400 |

### Task progress

HUI starts PI with a bundled `progress_card` extension. The tool accepts optional
Markdown and at most 50 ordered steps whose status is `pending`, `in_progress`
or `completed`. PI remains the durable writer: the latest tool-call arguments in
its transcript are the card state, and an empty call clears it. HUI hides the raw
control call from transcript activity and renders the validated projection above
the composer; it never derives progress from assistant prose.

### Session-list progress

Session rows use the original OpenClaw 2026.9.5 hovercard component and CSS,
with HUI data adapters. Hover or keyboard focus reveals session age, workspace,
the unfinished plan step/count and Markdown agent notepad. Idle unfinished plans
use the original paused clock; completed plans have no heads-up. Notes-only cards
have no invented percentage. Touch-only input does not open a hovercard. Runtime
status remains independent of plan completion. No OpenClaw-only actor or PR
metadata is fabricated. See the [port provenance](../src/components/openclaw/README.md).
The optional `SessionView.progress` contains `{ markdown, steps }`, projected
from the latest `progress_card` call in the live runtime transcript, never stored
in the session registry. Background sessions refresh every three seconds while
the page is visible. The shared sidebar refresh covers all panes; each pane's
composer still uses its SSE transcript immediately.
After a gateway restart, progress becomes available when that session is reopened
and its runtime restores the transcript.

The optional `SessionView.pullRequests` lists GitHub pull requests the session
created:

```ts
type SessionPullRequest = {
  repository: string;                // "owner/repo"
  number: number;
  url: string;                       // https://github.com/owner/repo/pull/N
  state?: "open" | "draft" | "merged" | "closed";
  title?: string;
  body?: string;                     // Markdown, HTML comments removed, ≤4000 chars
};
```

The reference is projected from the live runtime transcript: only a tool call
whose command runs `gh pr create` (or a tool named like `create_pull_request`)
and whose output contains a pull request URL counts; URLs merely mentioned in
prose or `gh pr view` output do not. `state`, `title` and `body` come from the
shared [GitHub link previews](#github-link-previews) (`gh api` with the Settings
→ Integrations → GitHub login), so badges and chat embeds agree. Lookups run in
the background (two at a time) and are cached in server memory: open and draft
PRs refresh after 60 seconds, merged or closed after 15 minutes, failures after
5 minutes. A listing never waits for GitHub; until a lookup succeeds the
optional fields are absent, and a failed refresh keeps the last confirmed facts.
Nothing is written to the registry. Like progress, PRs reappear after a gateway
restart once the session's runtime restores its transcript.

### Jira work items

`SessionView.jiraIssues` lists Jira Cloud work items linked to the session:

```ts
type SessionJiraIssue = {
  key: string;                                   // "CI-123"
  url: string;                                   // https://<site>/browse/CI-123
  summary?: string;
  status?: string;                               // Jira status name
  statusCategory?: "new" | "indeterminate" | "done";
  issueType?: string;
  description?: string;                          // Markdown from ADF, ≤4000 chars
};
```

References come from two sources, merged by key: `SessionRecord.jiraIssues`
(`{ key, url }[]`, written only when HUI creates a work item for the session)
and live-transcript tool calls that ran `jira issue create`,
`acli jira workitem create` or a create-issue tool and printed a
`https://<site>/browse/KEY-N` URL. Mentions in prose or failed calls do not
count. Facts are fetched from Jira REST v3 with the stored connection only for
URLs on the connected site, cached in memory (60 seconds, 15 minutes when done,
5 minutes after a failure); a listing never waits for Jira.

Connection routes (all require `x-hui`):

| Route | Result |
| --- | --- |
| `GET /__hui/jira` | `JiraConnection` `{ configured, site, email, tokenSet, defaultProject, accountName? }`; never the token |
| `PUT /__hui/jira` `{ site, email, token, defaultProject }` | Verifies with `GET /rest/api/3/myself`, then stores. An empty `token` keeps the stored one for the same site and email. 400 for invalid input, 502 when Jira rejects or is unreachable |
| `PATCH /__hui/jira` `{ defaultProject }` | Changes the default project |
| `DELETE /__hui/jira` | Removes the connection file |
| `GET /__hui/jira/projects?query=` | `{ projects: { key, name }[], total }`. Without `query`, the first 100 projects by name; with `query` (≤100 chars), Jira's own key/name search (50 results). Pickers load the first page, the saved default, and search remotely as the operator types, so sites with thousands of projects stay reachable |
| `GET /__hui/jira/issues?query=` | `{ issues: JiraIssueMatch[] }` (`{ key, url, summary, status?, statusCategory?, issueType? }`). Empty query: recently viewed (`issue in issueHistory()`). A key or `/browse/KEY-N` URL resolves that item exactly (missing → empty). Other text uses `text ~ "…*"` with the literal escaped; Jira 400s become an empty list. ≤200 chars, 20 results |
| `POST /__hui/sessions/:id/jira/link` `{ key }` | Verifies the item with Jira, appends `{ key, url }` to the record (moving an existing link to newest) and returns `{ issue, session }` |
| `POST /__hui/sessions/:id/jira/draft` `{ project?, suggestionId? }` | `{ draft: JiraDraft }`: parent candidates (open items one hierarchy level above the project's Task type), agent-chosen `parent`, `summary`, Markdown `description`, `model?`, `note?`, and `parentChoice?` (`suggested` when the model chose the parent or deliberately none, `unmatched` with `rejectedParent` when it named a key outside the candidates, `none-available` when the project has no candidates, `not-drafted` for a local draft, `omitted` when the answer had no parent field; such an answer is retried once). The transcript context is a bounded digest anchored on the session goal: the first operator request, later user messages, files changed by successful edit/write tools and the most recent conversation, with HUI's Continue, resume and subagent-event prompts removed. Utility calls use the cheapest reasoning level the model is actually sent: `off` where PI sends an explicit disabled value, otherwise the lowest level in the model's `thinkingLevelMap` (a gateway entry named `<provider>/<model>` without a map borrows that catalog model's map). Each draft makes at most two 25 s attempts: an attempt that ends without text, stalls or returns malformed JSON is retried once, while a provider-reported error is final. A failed model call returns the provider's error in `note` with a local draft built from the goal. With `suggestionId` the draft context is that pending suggestion's problem and fix instead of the transcript; 404 when it is no longer pending |
| `POST /__hui/sessions/:id/jira` `{ project, parent, summary, description, assignToMe?, suggestionId? }` | Creates the work item (Task, or the first standard type), assigns it to the connected account unless `assignToMe: false` (`PUT …/assignee` with the `accountId` from `/myself`, stored server-side), appends it to the record and returns `{ issue, session, warning? }`. An assignment refusal keeps the created item and returns `warning`. With `suggestionId`, a successful create also removes that suggestion card (already gone is not an error) |

The connection lives in `~/.config/hui/jira.json` (mode 0600) and accepts only
`https://<name>.atlassian.net` or `.jira.com` sites. Credentials are sent with
Basic auth to that origin only, with redirects refused and responses capped at
2 MiB. `HUI_JIRA_TEST_ORIGIN` admits one exact extra origin for local E2E.

Drafts use `Settings.models.utility` through a tool-free PI call over the
session's visible messages (last 12,000 characters). The model returns JSON;
an unknown parent becomes "none". Without a utility model, or when the model
fails or returns unusable output, the draft falls back to the session title and
latest user message and explains why in `note`.

### GitHub CLI login

Settings → Integrations → GitHub shows and establishes the GitHub CLI login that
PR badges and agent `gh` commands already use. HUI stores no GitHub credential:
it runs the gateway's `gh` (`HUI_GITHUB_CLI` overrides the executable for E2E)
with prompts, colour and update notices disabled.

```ts
type GitHubConnection = {
  cli: { installed: false } | { installed: true; version: string };
  status: "connected" | "disconnected" | "invalid" | "unknown";
  account?: { host: string; login: string; scopes: string[]; tokenSource?: string };
  message?: string;                 // why invalid/unknown, or "gh is required"
  login:
    | { phase: "idle" } | { phase: "starting" }
    | { phase: "pending"; userCode: string; verificationUri: string; expiresAt: number }
    | { phase: "failed"; message: string };
};
```

| Route | Behaviour |
| --- | --- |
| `GET /__hui/github` | Runs `gh --version` and `gh auth status --hostname github.com --json hosts` (the active account). While a login is pending, the last probe is reused so polling stays local |
| `POST /__hui/github/login` | 409 with the "GitHub CLI (gh) is required" message when `gh` is missing, or when `GH_TOKEN`/`GITHUB_TOKEN` in the gateway environment would shadow a login. Otherwise spawns `gh auth login --hostname github.com --web --skip-ssh-key` (plus `--git-protocol` set to the value of `gh config get git_protocol`, so an existing ssh choice survives) and returns once the one-time code is parsed (`phase: "pending"`, `verificationUri` fixed to `https://github.com/login/device`). A second POST while pending returns the same login |
| `DELETE /__hui/github/login` | Stops a pending login (SIGTERM) and returns to `idle`; also dismisses a `failed` result |

At most one login runs per gateway. When `gh` exits 0 the status is re-probed
and the login returns to `idle` with `status: "connected"`; a non-zero exit
becomes `failed` with gh's last message (never the code or prompt lines). A status `error` that is not an authentication refusal (401, bad credentials, invalid/expired token), such as a proxy or network failure, is reported as `unknown` ("GitHub could not be reached: …") rather than `invalid`. A connected account can start the same login again (*Reconnect*). No code within
20 s, or no approval within 15 minutes, also fails. Gateway shutdown kills a
pending login. The token never appears in any response: `gh auth status` is
called without `--show-token` and only `login`, `host`, `scopes` and
`tokenSource` are forwarded.

### GitHub contributions

The Contributions page (`/contributions`) charts a year of commits and pull
requests of every account `gh auth status` lists for github.com.

| Route | Behaviour |
| --- | --- |
| `GET /__hui/github/contributions[?year=YYYY][&refresh=1]` | `GitHubContributions`; 400 for a year outside 2008 to the current year at UTC+14 (the latest any browser can be in); 502 with `gh`'s message when the account list cannot be read (for example "GitHub CLI (gh) is required") |

```ts
type GitHubContributions = {
  accounts: { login: string; createdAt?: string; commits: string[]; pullRequests: string[]; error?: string }[];
};
```

Without `year`, searches cover the 372 UTC days ending today, enough for 53
local calendar weeks. With it, they cover Dec 31 of the previous year through
Jan 1 of the next (or today), so every browser time zone sees the whole local
year. `createdAt` is `gh api user`'s `created_at` (omitted when that call
fails); the page lists years back to the oldest one. `commits` are author dates from `search/commits` (`author:<login>
author-date:<from>..<to>`, default branches only), sorted by that date so later
pages continue page one. The first call per range prints `total_count` and page
one; up to 100 results need no more calls, more than 1000 (GitHub's search cap)
halve the range, otherwise `-f page=N` calls read the remaining pages in
parallel. `pullRequests` are creation times from one `gh api graphql` request
per account holding an aliased `search(type: ISSUE, first: 100)` (`author:<login>
is:pr created:<from>..<to>`) per 93-day range; a range past 100 continues by
cursor. GraphQL search does not count against REST's search limit but cannot search
commits, so commits stay on REST. A commit search
refused by GitHub's rate limit (30 searches a minute per account) waits until
the reset `gh api rate_limit` reports; the burst ("secondary") limit, or a
failed `rate_limit` call, waits 61 s (also the cap). It is retried once. The
contribution calendar API is not used:
it returns nothing for Enterprise Managed Users. The active account runs `gh`
unchanged; every other account runs with `GH_TOKEN` from `gh auth token --user
<login>`, set only in that child's environment and never logged, cached or
returned. One account's failure becomes its `error` with empty lists. Results
are cached in gateway memory per range for 15 minutes and shared by concurrent requests;
`refresh=1` bypasses the cache, and a result with a failed account or no
account is not cached. The browser buckets timestamps into local days and Sunday-first weeks.

### Session activity

The Contributions page's Calendar tab lays out when each HUI session was
worked on, as a week or a selected day. Both views use the same endpoint:
Week requests seven local activity days and Day requests one, each starting at
5 AM and ending at 5 AM after the last date. Date arithmetic uses local calendar
days, not fixed 24-hour offsets, to retain those boundaries across clock changes.

| Route | Behaviour |
| --- | --- |
| `GET /__hui/session-activity?from=<ms>&to=<ms>` | `SessionActivity` for `[from, to)`, epoch milliseconds; 400 unless both are decimal digit strings (at most 15) with `to` after `from` and at most 31 days apart |

```ts
type SessionActivity = {
  sessions: {
    id: string; title: string; group: string; project: string; archived?: boolean;
    blocks: { start: number; end: number; model?: string; firstMessage?: string }[];
  }[];
};
```

Every registry session with a `durable:<id>` reference and no `parentId`,
created before `to`, is read through its Durable conversation's history,
newest entry first. The timestamps of its user, assistant and tool-result
entries (not system, compaction or reset entries) split into blocks wherever
more than 30 minutes pass between two; `start` and `end` are a block's first
and last message. An answer is stamped when it starts, so a final long answer
adds no time, and a tool call or wait of over 30 minutes splits the work. A
session is listed with its blocks that overlap the range: they end at or after
`from` and start before `to`. The scan stops at the first such silence before
`from`, so a block that began earlier keeps its real start without reading the
whole history. `model` is the `provider/model` of the block's last answer;
`project` names the session's repository: the parent of Git's absolute common
directory (`rev-parse --git-common-dir`) for a `.git` directory, else that
directory without `.git`, so a repository's worktrees and subdirectories share
it. The home directory is always `~`, without asking Git. When Git cannot
answer, a directory under HUI's worktrees directory is checked against its
siblings or the checkout it was made from (its parent is `<checkout>-<hash>`).
Candidates are queried with Git, never recursively resolved; if none can
answer, the checkout name is used. Other directories use their own name.
Git queries use the existing command runner's 15-second timeout. Answers are
kept in gateway memory per directory. `firstMessage` is the operator's first message in the block (user entries only,
HUI's control prompts excluded, at most 400 characters). Sessions without a
block in the range, and sessions on PI's worker, are omitted. Only the
session's current conversation is read: after a rewind that is a fork holding
the history before the rewound message, so the abandoned branch's time is not
counted. Entries are read in pages (20, then 200) with a macrotask yield
between pages. Activity is neither cached nor persisted. The browser computes
the week, days, lanes and totals in local time. Project/group blocks may join
across gaps of at most 30 minutes for display, but those gaps never add to the
recorded activity totals. Per-item, daily and weekly totals count overlapping
session blocks once, and the selected period's total is independent of grouping.
Day view clips counts, peak concurrency and summary/member times to the same
one-day range; returning to Week requests the containing week's range. Date
selection is browser-only state and does not change the API response shape.

### GitHub link previews

Chat messages (user and assistant) unfurl GitHub references after the message
text, like Slack: at most **three** per message, in reading order, deduplicated
(`owner/repo#N` and its URL are one item). `github.com/<owner>/<repo>` (and deeper
repository pages), `…/pull/N`, `…/issues/N` and `owner/repo#N` shorthand count;
references inside inline or fenced code, GitHub site pages (`/settings`,
`/login`, …) and other hosts do not. A streaming message unfurls once its text has
been stable for 800 ms.

| Route | Behaviour |
| --- | --- |
| `GET /__hui/github/previews?url=…` (1–3 `url`) | `{ previews: GitHubPreviewResult[] }` in request order; 400 for more URLs or a non-GitHub URL |

```ts
type GitHubPreviewResult = { url: string; preview?: GitHubPreview; error?: "not_found" | "signed_out" | "cli_missing" | "unavailable" };
// GitHubPreview: repo { fullName, description?, stars, forks, language?, private, archived }
//              | pull { repository, number, title, state, author?, additions, deletions, changedFiles, comments, body? }
//              | issue { repository, number, title, state, stateReason?, author?, comments, labels, body? }
```

Each lookup is one read-only `gh api` call (`repos/:o/:r`, `…/pulls/:n`, or
`…/issues/:n` followed by `…/pulls/:n` when the issue is a pull request) with the
gateway's GitHub CLI login, so private repositories the account can read preview
too. `gh` output never reaches the browser; failures map to the coarse `error`.
Results are cached in gateway memory: open PRs 60 s, open issues 2 min,
repositories 10 min, settled items 15 min, `not_found` 5 min, `unavailable` 60 s,
`signed_out`/`cli_missing` 15 s; concurrent requests for one item share a call
and at most four `gh` calls run at once. A successful GitHub sign-in clears
cached failures. The browser keeps results for 60 s (failures 30 s) per page.
Every card is a link to the item on GitHub and shows the reason when no preview
is available. Hovering or keyboard-focusing a pull request card opens the same
hovercard as the session PR badges, with the full Markdown description.

`Settings.chat.githubEmbeds` (default `true`; only an explicit `false` disables
it) is the opt-out, exposed as Settings → Appearance → Chat → *GitHub link
previews*. When off, no preview is requested or rendered; PR badges keep using
the lookup.

### GPT-Live calls

A call with a bot (HUI-18) is a full-duplex WebRTC session between the browser and GPT-Live
(`gpt-live-1-codex`), over the ChatGPT login HUI keeps for the `openai-codex`
provider. Calls are with bots only: while bots are off (Settings → Labs → Bots)
every call route, `GET /__hui/calls` included, answers 409 with the bots' message,
turning them off ends the calls HUI holds, and a browser whose heartbeat gets
that answer ends its call saying so ([Bots are a preview](#bots-are-a-preview-settings--labs--bots)). This is the route ChatGPT's own voice mode uses, not a public API: it may
change. The gateway sets each call up and keeps the credential; the browser
carries the audio and the call's data channel (`oai-events`) and never sees a
token or an account id. Shared types are in `shared/calls.ts`:

```ts
type GptLiveVoice = "cove" | "arbor" | "breeze" | "ember" | "juniper" | "maple" | "sol" | "spruce" | "vale"; // cove: GPT-Live's default
type CallsStatus = {
  model: "gpt-live-1-codex";
  voices: readonly GptLiveVoice[];
  chatgpt: { signedIn: boolean; account?: { name: string; email?: string }; waitingUntil?: number }; // the account calls use now
  active: number; limit: number;   // calls held now; at most 2
};
type CallStarted = { callId: string; answer: string; model: string; voice: GptLiveVoice; account: { name: string }; instructionsBytes: number; memoryBytes: number };
type CallLine = { role: "user" | "assistant"; text: string };
// A line of a call's record: said (user, assistant), a question the helper answered (helper: request is what
// GPT-Live asked, text the answer) or a task handed to the bot's chat (handoff: text is the task). at: ms.
type CallRecordLine = { role: "user" | "assistant" | "helper" | "handoff"; text: string; at: number; request?: string };
type CallRecord = { call: string; bot?: string; startedAt: number; endedAt: number; summary?: string; summaryUnavailable?: true; lines: CallRecordLine[] };
type CallDelegationResult = { status: "answered" | "handed-off" | "failed" | "timeout" | "limit"; speak: string; task?: string };
type CallTaskResult = { status: "answered" | "failed" | "needs-input" | "timeout"; speak: string };
```

A bot's `voice.language` is one of the 100 language codes of Whisper
(`whisper/tokenizer.py`), `VOICE_LANGUAGES` in `shared/voice.ts`: ISO 639-1 codes plus
`haw` (Hawaiian), `yue` (Cantonese) and Javanese as Whisper's `jw`, accepted in any
case and stored lowercase; anything else is 400 at every boundary (the routes,
`bots.json` drops it, the CLI). The call's instructions ask GPT-Live to speak it,
and the helper and the call's summary write in it. Absent is Auto: GPT-Live
answers in the language the user speaks. Nothing is translated.

Calls follow OpenDots (CopilotKit/OpenDots, MIT): GPT-Live is the conversation
model and has one tool, which asks the bot. A **call helper** answers it on the
bot's utility model; work that needs tools goes to the bot's own chat; and the
call ends as **one record** in the chat.

| Route | Behavior |
|---|---|
| `GET /__hui/calls` | `CallsStatus`. The account is the first signed-in ChatGPT account not waiting for its quota, the order model turns use; `waitingUntil` when every one waits |
| `POST /__hui/bots/:id/calls` `{ sdp }` | 201 `CallStarted`. Refused with 409 for an archived bot. The offer is at most 64 KB, a session description with audio and no video (400 otherwise). The gateway builds the session (below), posts `{ sdp, session }` to `https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas` with `Authorization: Bearer <access>`, `chatgpt-account-id`, `OpenAI-Alpha: quicksilver=v2`, fresh `session-id`, `thread-id` and `x-session-id`, and `originator: pi` (30 s timeout, no redirects), and returns only the answer SDP and HUI's own call id. A 401, 403 or 429 hands the call to the next account; when every account refuses, or ChatGPT fails, the answer is 502 `{ error, upstreamStatus }` with a message written for the browser (401: sign in again; 403: not available on this account or plan, or the voice refused; 429: the voice limit reached). ChatGPT's own body goes only to diagnostics, redacted. No ChatGPT login, or every account waiting, is 409; a third concurrent call is 429 |
| `POST /__hui/bots/:id/calls/:callId/lines` `{ lines: [{ role, text, at? }] }` | `{ kept }`. What was said, in order: 1–40 lines of 1–4,000 characters; `at` (ms) is when it was said, the gateway's now when missing or implausible. The lines stay with the call in the gateway (its newest 400) until it ends; nothing reaches the chat per line |
| `POST /__hui/bots/:id/calls/:callId/delegations` `{ id, request }` | `CallDelegationResult`. `id` is GPT-Live's delegation item, `request` its text (≤ 4,000 characters, one line). The request goes through one seam (`CallDelegate` in `server/call-routes.ts`, implemented in `server/call-helper.ts`): the bot's **call helper**, one completion on the bot's utility model at low thinking (below), from the bot's SOUL.md (or a note that it has none yet), its OptChat view (its newest 16 KB), the call so far and the request. It never waits for or queues behind the bot's own turn. `answered`: `speak` is its answer (≤ 1,800 characters). When the request needs tools, files, current information or an action, the helper hands it off: `[call task] <task>` goes to the bot's chat as any message (a prompt, or a follow-up behind a running turn) on the bot's own model, and the result is `handed-off` with the task's id. The helper has 25 s per question (`timeout` past it: GPT-Live says it is taking long and offers to hand it off) and answers 6 questions per call; past them every request is handed off, and a call hands off at most 4 tasks (`limit`). `failed` says why no model answered. A client that leaves ends the wait |
| `POST /__hui/bots/:id/calls/:callId/tasks/:task` | `CallTaskResult` once the handed-off task's own run ends (never the reply of a turn it queued behind): its reply without markdown and at most 1,800 characters, or what to tell the user when it failed, needs an answer in the chat or is still running after 600 s. The browser gives it to GPT-Live as the delegation's speakable answer if the call is still up; either way the reply stays in the chat. 404 once the call ended |
| `POST /__hui/bots/:id/calls/:callId/heartbeat` | `{ ok: true }`. A call that sends nothing for 90 s (the browser vanished) ends and is recorded; 404 afterwards |
| `DELETE /__hui/bots/:id/calls/:callId` | `{ ended }`: the slot frees and the call is recorded. The browser writes its last lines first, then closes its connection to ChatGPT after `{ type: "session.close" }` on the data channel. A call also ends after 15 minutes |

**The record.** When a call ends (hang-up, 90 s without a heartbeat, or 15
minutes) the bot's utility model writes a summary in the bot's language, at most
120 words in short sections: what was discussed, confirmed decisions, facts the
user stated, tasks handed off (only what was said). The `CallRecord` (the summary
and every line in the order things happened, the helper's answers and the
hand-offs included) becomes one passive `hui.call` entry of the bot's
conversation: Durable places it at once when the chat is idle, at the running
turn's next boundary otherwise, and no turn runs for it. The chat shows it as one
`{ kind: "call" } & CallRecord` transcript entry, a card with the duration, the
summary and the transcript; OptChat logs the transcript as `user: [call] A voice
call with <bot> (<UTC time>, about N min). Transcript: …` and the summary as
`talk: [call] <bot>'s summary of that call: …`, so later turns and calls recall
it. When the summary fails the record keeps the transcript with
`summaryUnavailable: true`; a call where nothing was said leaves no record.

**The utility model.** A bot's quick work (memory summaries, the call helper,
the call's summary) runs on its utility model, `memoryModel` on the record
(`utilityModel` in a patch is the same field), else Settings' utility model
(`settings.models.utility`), else the bot's own model; a model that fails hands
over to the next one. The helper has no tools in this version: it answers from
the newest 16 KB of the bot's memory and the call, and hands off anything that
needs a tool or that it cannot find there (older memory, files).

From a terminal, `hui bot add|edit <bot> --call-voice <voice>` sets a bot's
`voice.live` (`""` goes back to Settings' voice) and `hui bot show` prints it as
`call voice: Ember` when the bot has one.

**The session.** `{ model: "gpt-live-1-codex", instructions, audio: { output: { voice } }, delegation: { type: "client" } }`.
`voice` is the bot's `voice.live`, else `calls.voice`, else `cove`. The instructions
carry the bot's name, handle, title and description; that this is a live voice
call and how to speak on one; the bot's language (`voice.language`; Auto: the
language the user speaks); when to delegate (anything needing tools, current
information, files, actions or memory beyond the instructions; small talk and what
the context answers directly; never invent facts); the speakable/commentary
contract; the bot's SOUL.md, labeled as its soul (at most 6 KB), or, while it has
none, a line saying so (the call works the same); and the newest end of its
OptChat view (at most 8 KB of whole lines, without ids), earlier calls' records
included. Nothing secret.

**The data channel.** The browser acts on `session.started`, `turn.created`,
`turn.delta` and `turn.done` (`{ turn: { id, role, transcript } }`: captions,
and each finished turn becomes a line), `delegation.created`
(`{ item: { id, type: "delegation", target: "client", content: [{ type: "input_text", text }], user_bidi_turn_id } }`),
`session.closed` and `error`. It sends `session.context.append`
(`{ channel: "speakable", content: [{ type: "input_text", text }] }`: the greeting
cue once connected), `delegation.context.append`
(`{ delegation_item_id, channel: "speakable" | "commentary", content }`, in
pieces of at most 500 bytes: the helper's answer on the speakable channel, spoken
in GPT-Live's own words; a hand-off on the commentary channel, silent background;
then the handed-off task's result as that delegation's speakable answer when it
arrives during the call) and `session.close`. A request waits (at most 2 s)
for the end of the user's turn that asked for it, whose line is written first, so
the record reads in order.

## Constraints

- Only one runtime per session id. Opening twice returns the same runtime.
- DELETE tombstones the id for the gateway lifetime before removing the row, so
  an overlapping stale open/events request cannot recreate its process.
- A missing registry is a fresh install. A malformed or unreadable registry is
  an error and is never replaced with an empty file by a later mutation.
- Sessions live in the server process, so **the server must not exit when a
  client disconnects**.
- `hui gateway` runs the server with no window, so those sessions outlive the UI.
- A runtime that dies must not take the server down; mark the session `error`.
- A boot failure keeps existing SSE subscribers. Retrying the open transitions
  the same stream through `starting` to `idle` (or back to `error`).

### Durable subagent completion delivery

The optional `subagent.completionDelivery` is HUI-owned outbox state. Terminal
results and `pending` are written in the same registry update; no PI transcript
format is changed. Marked completion messages include a `delivery_ids` header
with stable task IDs. The display parser ignores that transport header.

Delivery still batches active siblings and prefers steering, falling back to
follow-up or an idle prompt. A five-second retry loop serializes each parent's
attempts. Runtime queue admission leaves the record pending; the parent transcript
must contain the event before HUI stores `delivered`. A gateway restart hydrates
that transcript before retrying, so an already-written event is not ordinarily
replayed when its registry acknowledgement was lost. Pending events survive a
restart; active children become interrupted and acquire a pending result. Legacy
terminal records without this field are intentionally not replayed.

This is at-least-once recovery, not exactly-once model execution. A delivery
acknowledgement means the event was observed in the transcript, not that the
parent processed it successfully. A removed parent is not recreated, and no
background child execution is resumed by this mechanism. No new route is exposed.

### Transcript measurement metadata

Transcript entries may carry optional `metrics`: `timestamp`, `completedAt`
(Unix milliseconds), `durationMs`, `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens`, and `costUsd`. Only finite nonnegative
values are exposed. Zero is a reported value, not missing data.

The transcript is PI's whole active branch, root to leaf, not the model
context. A PI compaction therefore hides nothing: its `compaction` entry sits
where PI appended it, after the messages it summarized and the ones it kept
verbatim, with PI's summary and pre-compaction token estimate. Failed attempts
PI hid with a context edit before retrying stay hidden, as in the context.
Messages persisted by PI carry their session `entryId`; live, not yet
persisted messages have none.

PI message timestamps and usage come from `get_entries`; usage is assigned
once to the last text/reasoning block (or last tool call when no text exists) of that model message, never allocated
across individual content fragments. Timings are observed between paired PI
`message_start`/`message_end` or `tool_execution_start`/`tool_execution_end`
events. The normalized settled snapshot carries them. Completion without a
start carries only `completedAt`. No elapsed time is inferred from neighboring
messages or from PI's creation timestamp. Historical tools without recorded
measurements remain untimed. Timings live with the runtime, survive browser
reconnect/reload, and disappear when that runtime exits; no persisted format or
PI transcript is changed. Existing clients can ignore the additive metadata.

Reply is browser-owned: it appends a Markdown blockquote to the existing draft
and focuses the editor. The ordinary prompt/queue route sends that text only
when the user submits; there is no new reply transport or thread identity.
