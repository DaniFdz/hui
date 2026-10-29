# Remote access over a slow link

Date: 2026-10-07. Linux, Node 24, headless Brave (Chrome 153), HUI 0.1.3 at the
branch's HEAD, production build served by the built gateway (not Vite).

Proves what a phone on mobile data through Tailscale sees: how soon something
paints, how soon the app and a long conversation are usable, and that a
conversation that fails to load says so and offers a retry.

## Reproduce

1. `npm ci && npm run build`.
2. Seed one long Durable session (160 turns, a 1.96 MB transcript) into fresh
   state, then start the built gateway on that state:

   ```sh
   D=$(mktemp -d); export XDG_CONFIG_HOME=$D/config XDG_DATA_HOME=$D/data XDG_CACHE_HOME=$D/cache \
     PI_CODING_AGENT_DIR=$D/agent PI_OFFLINE=1 HUI_PI_BACKEND=sdk HUI_E2E_WORKSPACE=$D/workspace
   mkdir -p $D/agent && node e2e/fixtures/long-session-fixture.ts
   node bin/hui.mjs gateway run --host 127.0.0.1 --port 43331
   ```
3. In another shell, put a slow link in front of it (300 ms round trip,
   1.6 Mbit/s down, 800 kbit/s up; `--rtt-ms 600 --down-kbps 300` for a bad one):

   ```sh
   node e2e/fixtures/slow-link-proxy.mjs --target 127.0.0.1:43331 --port 43432
   ```
4. With the Browser tool, open `http://localhost:43432/sessions/e2e-long-session`
   in a new labeled tab (a port not visited before, so nothing is cached). Read
   `performance` paint and resource entries and wait for *Step 160* in the
   transcript. Capture the boot screen early, the conversation loading state and
   the loaded conversation, at 1440×900 and 390×844.
5. Boot screen colours: on a fresh origin it paints HUI's light (`#faf9f7`)
   or dark (`#0e1015`) background for the system preference, never bare white.
   Switch the theme (for example Catppuccin with a custom accent), load the app
   once, then reload over a slow link: the boot screen paints in that theme's
   background, text and accent (remembered per device in `localStorage`).
6. Failure path: with the app loaded on Home, stop the gateway, select *Long
   remote session*: the transcript area shows *Could not load this
   conversation* with the reason and *Try again*, never an empty chat. Start the
   gateway again on the same state and press *Try again*: the conversation loads.

## Observed

| 300 ms / 1.6 Mbit/s | main | this branch |
| --- | --- | --- |
| First paint | 6.7 s, blank page | 1.8 s, boot screen |
| App painted, sessions requested | 23.0 s | 5.8 s |
| Long conversation | open aborted after 5 s: *The user aborted a request.* toast over an empty *Start a conversation* | painted at 7.0 s |
| Bytes for the open answer | 1,957,957 | 39,343 |

At 600 ms / 300 kbit/s the branch shows the boot screen, then *Still loading —
the connection is slow* after 6 s, and the conversation arrives intact.

## WebSocket compression measurement (2026-10-28)

Native `ws` per-message deflate now uses zlib level 4. The 1,024-byte threshold,
both no-context-takeover flags and concurrency limit 4 are unchanged. No payload
codec or browser decoder is added.

Measured on Node 24.14.1 / ws 8.21.3 / macOS arm64 with isolated localhost server
and client processes, a discarded warmup and three interleaved repeats. The
synthetic corpus included token/status frames, tool output, mid/large snapshots
and a four-view burst. Every decoded payload matched. Sub-threshold token/status
frames used identical bytes. These are aggregate wire bytes and median **server
process CPU per burst**, not per-snapshot CPU:

| Burst | Default level 6 | Level 4 | Server CPU, level 6 → 4 |
| --- | ---: | ---: | ---: |
| 10 × 75,779-byte snapshots | 180,920 B | 188,350 B (+4.1%) | 27.9 → 13.2 ms |
| 3 × 647,009-byte snapshots | 429,906 B | 455,541 B (+6.0%) | 62.9 → 34.1 ms |
| Four views, 10 mid snapshots each | 723,680 B | 753,400 B (+4.1%) | 102.6 → 62.0 ms |

CPU absolutes varied with host load; compare configurations within a paired
run. Level 1 added 10.2–13.6% bytes for larger CPU savings. Level 4 is the
smaller wire-cost compromise: one mid snapshot adds 743 B (about 6 ms at
1 Mbit/s), and one large snapshot adds 8,545 B (about 68 ms). Loop-lag
measurements did not demonstrate an event-loop responsiveness improvement;
compression already runs off-loop. Uncompressed clients still work.

## Long sessions, subagents and a watcher on a phone (2026-10-21)

macOS, Node 24, headless Chrome 155 with a 430×932 phone viewport, 2× CPU
throttling and DevTools network throttling (4G: 70 ms, 12 Mbit/s; slow:
300 ms, 1.6 Mbit/s), production builds of `origin/main` and the branch, each on
its own copy of one seeded state. Two loads of each; ranges show both.

1. Seed a 900-turn session (a 5.9 MB transcript of bash calls) with 450
   subagent sessions and a watcher that logs every two seconds:

   ```sh
   HUI_E2E_TURNS=900 HUI_E2E_SUBAGENTS=450 HUI_E2E_WATCHER=1 node e2e/fixtures/long-session-fixture.ts
   ```
2. Copy the state for each build, start each built gateway on its copy and
   load `/` (until *Recent chats* lists a row) and
   `/sessions/e2e-long-session` (until the first message paints) in a fresh
   browser profile.
3. With the conversation open, count what its WebSocket receives for a minute
   while the watcher logs, and how busy the main thread is once it has loaded.
4. In the conversation, *Show earlier messages* sits above the latest 50 rows
   and the position rail still has a marker for every message
   ([position-rail.browser.md](position-rail.browser.md)).

| | `origin/main` | branch |
| --- | --- | --- |
| Session list (raw JSON) | 2,206,739 B | 261,654 B |
| Home on 4G, *Recent chats* shown | 2.2–2.3 s, 3,340 KB transferred | 1.3–1.7 s, 795 KB transferred |
| Home elements | 19,242 | 2,829–3,587 |
| Long conversation on 4G / slow, first message shown | 8.7–9.6 s / 41.6–42.1 s | 2.8–3.0 s / 16.7–16.8 s |
| Long tasks while it loads (longest) | 4.3–5.2 s (1.7–2.2 s) | 0.26–0.45 s (0.10–0.16 s) |
| Its elements, JS heap | 141,435, 85 MB | 10,887, 18 MB |
| `POST …/open` answer (raw JSON) | 11,562,882 B (the transcript twice) | 5,694,699 B |
| WebSocket in the first minute | 7 snapshots with the whole transcript, 41 MB of JSON, 16.3 MB on the wire | 7 snapshots without it, 194 KB of JSON, 75 KB on the wire |
| Main thread busy while idle | 5.8 % on average, 25 % at most | 0.2 %, 3 % |

The latest rows look the same in both builds, the watcher's last line keeps
updating, and after a gateway restart the page reconnects with the whole
transcript.

## Limits

The proxy models latency and one shared bandwidth budget over HTTP/1.1 to
loopback; Tailscale serve speaks HTTP/2 to the phone and adds its own TLS
handshakes and DERP relays. A real phone on mobile data was not part of this run,
and CPU throttling of a Mac core stands in for a phone's.

## Session switching and stalled responses

Use the isolated launcher from `.agents/skills/hui-visual-verification/SKILL.md`.
The `session-load-proxy.mjs` fixture models a busy or interrupted gateway
response, not whole-machine CPU saturation. It affects only the first open of
one named session; every other request and WebSocket passes through.

1. Launch the intended branch and run doctor. From the receipt, set
   `HUI_E2E_URL` to its `url` and `HUI_E2E_WORKSPACE` to its `workspace`. Create
   four disposable sessions as setup:

   ```sh
   node --input-type=module <<'JS'
   const sessions = [];
   for (const name of ["A", "B", "C", "D"]) {
     const response = await fetch(`${process.env.HUI_E2E_URL}/__hui/sessions`, {
       method: "POST", headers: { "x-hui": "1", "content-type": "application/json" },
       body: JSON.stringify({ cwd: process.env.HUI_E2E_WORKSPACE, title: `Load probe ${name}`, group: "Load probe" }),
       signal: AbortSignal.timeout(20_000),
     });
     if (!response.ok) throw new Error(`Session setup failed: ${response.status}`);
     sessions.push((await response.json()).session);
   }
   console.log(JSON.stringify(sessions.map(({ id, title }) => ({ id, title }))));
   JS
   ```

2. Through the real UI, open A and B and send each a message. Observe the
   fixture replies so both have history. Record A's id as `SESSION_A`.
3. Start the controlled proxy in its own foreground process:

   ```sh
   node e2e/fixtures/session-load-proxy.mjs "$HUI_E2E_URL" "$SESSION_A" stall
   ```

   Open its printed URL with the Browser tool. Select A and observe
   *Loading the conversation…*. Switch to B and confirm its transcript and
   composer work. Return to retained A. After 40 seconds without body bytes,
   A must show *Could not load this conversation*, the no-progress reason and
   **Try again**, not an empty chat. Press **Try again** and observe A's history
   and a successful follow-up reply.
4. With a fresh `stall` proxy, open A, then B, C and D. The three-view cache
   evicts A. Read `GET /__load-probe/stats` on the proxy: `abandoned` must be 1
   after eviction, before the 40-second body deadline. `abandonedAfterMs`
   records the actual connection-close time. Confirm D remains usable. Closing
   the browser view must not stop any agent turn.
5. With a fresh proxy in `progress` mode, open A. The fixture sends its JSON in
   six parts ten seconds apart. Switch only between A and B so A stays in the
   three-view cache while it downloads. A must load intact after fifty seconds, without a timeout or
   empty-chat state. This proves the guard measures silence, not total time.
6. Repeat the load failure, Retry and session switching at 390×844. Exercise
   the navigation drawer at 844×390. Inspect the screens and console, record
   expected errors from the deliberately interrupted connection separately,
   and capture final-HEAD desktop/mobile evidence outside Git. Stop every owned
   proxy and clean up the launcher.

The native HTTP/WebSocket checks in `src/api/sessions.test.ts` additionally
hold the ticket response or socket handshake, verify retry after twenty
seconds, and permit a slow first snapshot on an established connection. The
browser's WebSocket API does not expose partial-message progress, so the
handshake guard must not become a total first-snapshot deadline.
