# Structured questions (`ask_user_question`) browser verification

The shared tests in `e2e/tests/agent/` (`questions.e2e.ts`, `question-keyboard.e2e.ts`,
`waiting-cards.e2e.ts`) cover the card itself: one card above the composer, several
questions, multi-select, previews, the keyboard, Cancel, Stop, a reload, parallel calls,
invalid calls and untrusted text. This journey keeps the checks no shared test makes
yet: the question timeout (AGENT-013, SET-056), HUI's tool winning over a PI extension
of the same name (AGENT-014) and a gateway restart dropping a pending card (AGENT-021).

Only the model provider is mocked (`e2e/fixtures/pi-provider-fixture.mjs`): a prompt
holding `E2E_ASK_USER:<name>` makes it call `ask_user_question` with the
workspace's `ask-<name>.json` (an array of inputs means parallel calls), and its
next answer quotes every tool result as `tool answered: …`. HUI, the gateway,
Pi Durable or PI's SDK worker, the tool and the browser are real.

## Reproduce

1. From a clean checkout: `node e2e/visual-verification.mjs launch --branch
   <branch>` (Durable), or with `--pi-sessions` (PI's SDK worker); `doctor` on
   the receipt.
2. Question timeout: in Settings → Tools → Questions set *Question timeout*
   to *5 minutes*, then send `E2E_ASK_USER:decide` with an `ask-decide.json`
   of two questions whose first options end in *(Recommended)*. Leave the card
   unanswered for five minutes; check 1440×900 and 390×844.
3. To prove HUI's tool wins over the extension, add the installed package's
   directory to `packages` in the fixture's `agent/settings.json` and send a
   question: `GET /__hui/sessions/:id/tools` lists one `ask_user_question` with
   source `HUI`, the provider log carries only HUI's description, and the card
   is HUI's.
4. Gateway restart: with a card pending, stop and start the gateway, then open
   the session again.

## Expected

- With the question timeout Off (the default) a card waits. Set to five
  minutes, an unanswered card closes after them and the session goes idle;
  the transcript shows *Expired* with *No answer within 5 minutes. The agent
  continued without your answer; reply in the chat to decide.* and each
  question with its options, and the model receives `No answer within 5
  minutes; the operator may be away. …`. Both survive a reload, and the
  composer is free for a reply.
- With the PI extension installed the session still has one
  `ask_user_question`, and its questions open HUI's card, not a series of
  plain select dialogs.
- After a gateway restart the pending card is gone and the call has ended.

## Observed

Date: 2026-10-09, branch `dani.fernandez/custom-ask-questions-tool`.

- With the rpiv package configured, HUI's tool and card won on Durable and on
  PI's SDK worker.

Date: 2026-10-17, branch `dani.fernandez/question-timeout`.

- Question timeout on Durable, Browser tool: Settings → Tools → Questions saved
  *5 minutes* (`questions.timeoutMinutes: 5` in the isolated settings file) and
  kept it after a reload; `E2E_ASK_USER:decide` showed its card, which closed
  five minutes later; the transcript showed the expired summary with both
  questions and their options, the fixture quoted the timeout text back, and
  both survived a reload. 1440×900 and 390×844: see the pull request's
  screenshots.

## Limits and gaps

- The shortest question timeout is five minutes and the gateway's timer runs
  in real time, so no shared test reaches it. The timer itself and Off waiting
  past a timeout are covered by `server/agent-tools/questionnaires.test.ts`.
- A remote worker session was not exercised; its only change is the bridge
  timeout for this tool (24 hours instead of 170 seconds).
- `hui bot chat` only cancels a questionnaire; its output is covered by
  `cli/bots.test.ts`.
