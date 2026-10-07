# OptChat memory

[OptChat](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449)
is Victor Taelin's design for an endless chat whose history is its memory: every
message is kept, word for word, in an append-only log; a cheap model compresses
the log into a binary tree of one-line summaries; and every turn starts fresh
from a fixed-size **view** of the whole chat (recent messages one line each,
older ones many per line) followed by the new message. The agent opens a line
with `zoom(id, n)`, down to the original message, and asks `date(id)` for its
time.

HUI implements it in two parts:

- **The engine**, `server/optchat/`: the log, the tree, the view, the compactor,
  the prompts and the browse page. It imports nothing from HUI or Pi Durable; the
  model call is injected, so the same code runs in the gateway, a worker or a
  test.
- **The Pi Durable integration**, `server/runtimes/durable-optchat.ts`: one memory
  per Durable conversation that enables it, kept current from the conversation's
  entries, and a fresh-turn request for each of its generations.

Nothing else uses it yet: bots, their routes, UI and `hui bot` CLI come later
(roadmap HUI-18). Every conversation without OptChat behaves exactly as before.

## Enabling

A conversation has OptChat when its `hui.optchat` document is enabled:

```ts
type OptChatState = { enabled: boolean; name: string; model?: string; thinking?: string };
```

| field | meaning |
|---|---|
| `enabled` | absent document or `false`: plain Durable |
| `name` | the agent's display name in OptChat's prompts (required when enabled) |
| `model` | the compactor's model as `provider/id`; default: the conversation's own model |
| `thinking` | the compactor's thinking level; default `medium` (the reference's choice) |

The document is `latest` and `fork: "initial"`: a fork, such as a rewind, starts
without OptChat. Change it only with the helpers, which also select OptChat's
tools for the conversation in the same commit:

```ts
// In the commit that creates the conversation (what creating a bot will do):
await harness.createConversation({
  ownership: { kind: "ownerless" },
  agent: { model, cwd },
  init: (tx, id) => enableOptChat(tx, id, { name: "Grok" }),
}, context);
// Later, in a commit of its own: rename, choose the compactor model, or turn it off.
await configureOptChat(conversation, { name: "Grok 2", model: "anthropic/claude-sonnet-4-5", thinking: "medium" });
await configureOptChat(conversation, { enabled: false });
```

`configureOptChat(tx, conversationId, change)` joins a transaction;
`configureOptChat(conversation, change, context?)` commits on its own; a given field
replaces the stored one, `null` clears `model` or `thinking`. `enableOptChat` is the
same with `enabled: true`. They reject an enabled document without a name, a model
that is not `provider/id` and an unknown thinking level. A running turn picks a
change up at its next request.

## How a turn runs

**The log follows Durable.** Durable's entries are the authority; OptChat's log is
a projection of them, one line per item, each tagged with its source
`{ entry, part }`:

| Durable entry | OptChat log |
|---|---|
| `pi.user` | `user`: its text blocks, images as `[image]` (custom inputs as plain text) |
| `pi.assistant` that stopped (`stop`, `length`, `toolUse`) | `talk` for its text, if any; one `tool` per call: `name {json}` |
| `pi.tool-result` | `echo`: its text, `error: ` first when it failed, capped at 30,000 characters (head and tail) |
| anything else | nothing: system, reset, compaction and extension entries; failed, aborted and deferred answers |

Thoughts are never logged (spec section 2). The gateway catches the log up when a
memory opens, whenever the store commits an entry of an open memory, and before
each request; a pass appends only what follows the last projected line, so a crash
or a restart never logs an entry twice and never skips one. When the gateway
starts, it reopens the memories of enabled conversations, so summaries are built
between turns.

**Each request starts fresh** (spec section 7). OptChat's `beforeRequest` hook
rebuilds Durable's request:

1. every system message before the run's first input, in order: they carry the
   prompt sections and the tool declarations;
2. the run's first input, with the view as its first text block;
3. every later message of the run verbatim: assistant steps with their thinking
   signatures, tool results, steering input, system deltas.

The input is found by the timestamp of its `pi.user` entry. Should it not be, the
first user message after the last answer or tool result stands in, and a
`optchat_request_split` diagnostic says so.

**A run's view is frozen.** A run is keyed by its first input submission, which
stays the same across the generations of one run. At its first request the hook
waits until every line of the view before the run's input is a summary (the
memory's status says `waiting` meanwhile; Stop ends the wait and the turn), then
freezes the view's parts before that input and writes them to `runs.jsonl` before
the request is sent (fsync, first record of a run wins). Every later request of
the run, a retry and a request Durable resends after a crash or restart carry the
same view, even when the memory has merged lines meanwhile or folds differently
after a restart. Node texts never change once built, so the frozen parts always
render the same bytes.

**Prompt and tools.** The `optchat` prompt section is the spec's MASTER and
VIEW_DOC for the document's name: no date and no state, so it is byte-identical
across calls. It renders after HUI's own sections. `zoom(id, n)` and `date(id)`
use the spec's descriptions, answer in its formats (`id+0|kind: text` for a whole
message, two `id+n|text` lines otherwise, `No line id+n.`) and are replay-safe.

**Durable compaction is declined.** The memory is the history: OptChat's
`beforeCompact` answers `{ decline: true }` for enabled conversations, ahead of
every session's PI extensions (Durable takes the first decision), so a manual
compaction completes without a summary entry. Durable's threshold estimate starts
from the provider-reported usage of the last answer, which reflects OptChat's
small request, so thresholds rarely trigger; when one does, the declined
compaction places nothing and the request is still sent. A context overflow inside
one long run cannot be compacted either: that run fails (Durable section 8.3).

**The compactor** (spec section 4) runs in the gateway: one model conversation per
node, at most 8 per memory and 8 across the gateway, through the gateway's models
with the document's model or the conversation's own, at medium thinking unless
the document says otherwise. A failed node is retried every 10 seconds; only its
first failure is reported (`optchat_memory` diagnostic) and shown in the memory's
status. Its usage (tokens, cache, cost) is counted in the status since the memory
opened.

## Prompt caching

Anthropic (`anthropic-messages`): the view block of a turn is cut at the last line
end before 50,000, 80,000 and 100,000 characters, and each piece gets the
`cache_control` pi-ai uses for that request, so the next turn reads the longest
unchanged prefix of the view from the cache. Anthropic allows four breakpoints:
pi-ai's breakpoint at the request end stays, and those pi-ai puts on the tools and
the system prompt give way first (a breakpoint after them caches them too). The
marks are added only when pi-ai caches (its retention is not `none`), with its own
TTL. The compactor's context block, the same prefix for every call, gets a
breakpoint too. Other providers cache prefixes implicitly: the view's start is
stable and Durable forwards a stable session id, so nothing is added there.

## Storage

Each memory lives in `<HUI_DURABLE_DIR>/optchat/<conversation id>/` (by default
`~/.config/hui/durable/optchat/`), next to `harness.sqlite`:

| path | content |
|---|---|
| `main/YYYY-MM-DD.jsonl` | the log, one message per line: `{i, kind, text, size, date, src}` |
| `tree/YYYY-MM-DD.jsonl` | the summaries, one node per line: `{l, i, text, size}` |
| `runs.jsonl` | the frozen view of each run: `{run, entry, t0, parts}` |

A line goes to the file of the local day it is written on; ids are global. Each
line is one write and an fsync before the append resolves. A torn line is reported
and skipped at load, and a file without a final newline gets one before its next
line. Nothing edits or deletes a line of the log or the tree; `runs.jsonl` starts
over after 64 runs, since only the current run can need its own record. Directories
are `0700` and files `0600`, like the Durable store. The single writer is the
gateway that holds the Durable store lock (`harness.lock`).

## Inspecting a memory

`DurableHost.optchat` answers for a conversation with OptChat, and `undefined`
otherwise (or while this process does not own the store):

```ts
const status = await host.optchat.status(id); // messages, built, pending, viewBytes, viewLines, waiting, failing, usage
const view = await host.optchat.view(id); // the current view, rendered
await host.optchat.zoom(id, 0, 8); await host.optchat.date(id, 0);
const page = await host.optchat.html(id); // view, every message and each tree level, escaped
const stop = host.optchat.subscribe(id, (status) => render(status)); // e.g. "Summarizing memory…" while waiting
```

The files are plain JSONL, readable with `jq` while the gateway runs (they only
grow), for example `jq -r '"\(.i) \(.kind): \(.text)"' main/*.jsonl`.

## Deviations from the spec, and why

- **OptChat's tools are an extension of their own.** `hui-optchat-tools` (zoom,
  date) is selected only by enabled conversations, in their stored agent, and
  `DurableSession.applyTools()` keeps it selected; the global `hui-optchat`
  extension (section and hooks) is in every conversation's default selection. A
  tools filter removing them from every other conversation would hide a PI
  extension's own `zoom` or `date` tool everywhere, would rewrite every existing
  conversation's stored agent, and would still offer them to a conversation whose
  run resumes before its session reopens.
- **The view is frozen per run and stored.** The spec renders the view once per
  turn in its own process. Durable reruns a request after a retry, a crash or a
  restart, so the view is stored before the request is sent.
- **Input boundaries are Durable's.** Several inputs placed together stay separate
  user messages (the spec joins them into one block), and steering input reaches
  the run between tool calls, logged as `user`, as in the spec.
- **The system prompt is HUI's, then OptChat's.** The spec's prompt is MASTER,
  VIEW_DOC, then the user's AGENTS.md; HUI renders its own sections (preamble,
  context files, skills, HUI's sections) first and OptChat's section after them.
  MASTER is kept verbatim, so it still speaks of instructions "at the end of this
  prompt"; the bots' own base prompt is for a later change.
- **The lock is the store's.** The spec holds a Unix socket per chat directory;
  here the gateway's Durable store lock covers every memory.
- **Usage is per process.** The compactor's spend is in the status since the
  memory opened; it is not persisted, nor added to Durable's `pi.usage`.
- **Subagents and computer use (spec section 9) are not implemented.** MASTER
  keeps its paragraph about them, verbatim.
- **Refolding.** As in the spec, the view is not saved and is folded again at
  open; it repeats the live view when the compactor kept up and no new line was
  shorter than the placeholder it replaced (an unbuilt part counts its placeholder,
  spec section 5.2). Otherwise the first turn after a restart may start from a
  slightly coarser or finer view; a run in flight keeps its frozen one.

## Limits

- No bots, routes, UI or CLI yet.
- PI extension messages written outside a run (`before_agent_start` context,
  `sendMessage`) and a reset's handoff message are neither logged nor sent in
  an OptChat turn.
- Compactor requests carry the gateway's own provider identity, not the
  conversation's HUI session, and do not run PI extensions' provider handlers.
- Enabling a conversation that has history logs all of it; its first turn waits
  until that history is summarized.
- A memory that cannot be opened (a log with a missing message is refused) fails
  the hook: Durable reports it and sends its own request for that turn.
- HUI's prompt inspection and context meter show Durable's view of the
  conversation, not OptChat's request.
