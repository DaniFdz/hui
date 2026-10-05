# Browser journey: PI extensions in Durable

Use `.agents/skills/hui-visual-verification/SKILL.md` to launch, identify and
clean up the exact checkout. The default launcher creates Durable sessions
with real PI extensions and a deterministic local provider. It does not use
operator credentials or sessions. `--pi-sessions` is the comparison path for
PI's SDK worker, not a prerequisite for loading extensions.

## Tools, commands and questions

1. Create a session in the receipt's workspace with `E2E_EXTENSION_TOOL please`.
   The header should identify `durable`. Expand the tool row: `fixture_echo`
   should return `Extension tool executed: from the model`; the final answer
   is `Tool complete`. This is a real tool loaded from the disposable PI
   extension directory, not a seeded transcript.
2. Type `$` in the composer. **Plugin actions** should include `check-status`,
   `hui-e2e-question` and `fixture-compact`.
3. Send `$check-status hello`. Expect the notice `Extension executed: hello`,
   no model turn and an idle composer.
4. Send `$hui-e2e-question select`. Inspect the question at 1440×900 and
   390×844. Select **Second option**, then **Submit**. The answer notice should
   appear, the question and command bubble should disappear, and the session
   should return to Idle. Repeat the interaction at the other viewport size.
5. Send `E2E_RICH read the fixture`. Expect a real read tool, `Tool complete`
   and an idle composer. Reload the page and check that both tool turns remain.

## Extension-driven compaction

Use a separate session without tool-triggering prompt markers. The fixture
provider currently treats markers inside PI's summarization input as ordinary
prompts before checking its summarizer branch. That fixture limitation can
produce `Summarization attempted to call a tool`; it is not a runtime result.

1. Create a Durable session with `COMPACT_ONE first turn`, then send
   `COMPACT_TWO second turn` and `COMPACT_THREE` followed by about 2,000
   characters. Each gets `Fixture response.`
2. Send `$fixture-compact keep the fixture checks`. This invokes the extension
   command, which calls `ctx.compact`, not HUI's built-in `/compact` command.
3. Expect **Context compacted**, all three earlier turns still visible, and
   an Idle session. Open **Show summary** and check `FIXTURE_SUMMARY`.
4. Send `AFTER_COMPACTION`. It should be answered and settle normally.

## Evidence and limits

Run launcher doctor before interaction and final capture. Keep screenshots,
receipt, commit identity and observed outcomes outside Git; publish desktop
and mobile question screenshots with the local review. Check the browser
console and inspect the rendered screens rather than treating successful
HTTP requests as UI proof.

Automated boundary tests in `server/runtimes/durable.test.ts` own extension
isolation, disabled packages, hooks, stored custom state, Stop, rewind, reload,
recovery readiness and compaction result routing. This browser journey does
not prove an external MCP server, the operator's full package set, or transport
to an actual remote worker.
