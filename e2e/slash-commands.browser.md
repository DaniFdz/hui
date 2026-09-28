# Browser journey: runtime slash commands

Verified on 2026-09-24 with the installed PI 0.73.1 RPC process, HUI's real
gateway and the deterministic local provider. No operator PI credentials,
sessions, skills or HUI registry were changed. No dependencies or persisted
formats were added.

## Reproduction setup

Use the isolated provider/model setup from
[chat-composer.browser.md](chat-composer.browser.md), with a fresh temporary
root, port 43127 for the provider and `http://localhost:5173` for HUI. Set
`XDG_CONFIG_HOME`, both `PI_AGENT_DIR` and `PI_CODING_AGENT_DIR`,
`PI_CODING_AGENT_SESSION_DIR`, and `PI_OFFLINE=1` to the disposable fixtures.
Start HUI with `npm run dev`. Never point this journey at the operator's config.

Copy `question-extension.ts` and `slash-commands-extension.ts` into the fixture
agent directory's `extensions/`. Add these resources:

| Fixture path | Frontmatter | Body |
| --- | --- | --- |
| `pi-agent/skills/browser-check/SKILL.md` | `name: browser-check`, `description: Verify the browser command menu` | `HUI_SKILL_EXPANSION_PROOF: follow the test instruction provided.` |
| `workspace/.pi/skills/project-check/SKILL.md` | `name: project-check`, `description: Check the selected project` | `HUI_PROJECT_SKILL_PROOF: follow the project test instruction.` |
| `pi-agent/prompts/plan-check.md` | `description: Draft a verification plan` | `HUI_TEMPLATE_EXPANSION_PROOF: $@` |

Each frontmatter block uses ordinary `---` Markdown delimiters. The skills are
intentionally split between global fixture and project scope. The five expected
commands are `check-status`, `hui-e2e-question`, `skill:browser-check`,
`skill:project-check`, and `plan-check`.

## Visible-control journey and observed results

1. On New Session, enter the disposable project directory and `/`. Activate
   **Start session & browse commands**. The session becomes Idle, keeps `/`,
   focuses Message and opens the five-option catalog. Provider requests: **0**.
2. Press Enter on `/check-status`. The menu closes and inserts the command plus
   a trailing space without submitting. Add `browser-proof`, then Send. The
   visible notice is `Extension executed: browser-proof`; the session returns
   to Idle, and no synthetic transcript message or model request remains.
3. Type `/browser`. Only `/skill:browser-check` matches. Tab completes it and
   keeps Message focused. Enter sends it; PI expands the skill and the provider
   returns `Fixture response.`. The provider log contains the skill marker and
   PI's `<skill ...>` wrapper, not just the literal slash invocation.
4. Search `/question`, click the extension option and send it. Answer through
   the visible **Answer** control and Submit. The notice confirms the answer;
   the question closes, focus returns to Message, and the session is Idle.
5. With `/` open, ArrowUp wraps to the final template option. Its visible
   highlight and `aria-activedescendant` agree. Enter completes it; send
   `/plan-check template-argument`. The provider sees the expanded template
   marker and argument and returns a normal response.
6. Search for a nonexistent command. The explicit no-match state appears.
   Escape closes the menu without altering the draft. Reload preserves the
   draft and rediscovery uses the resumed real PI runtime.
7. Inject one failed `/commands` fetch response in the disposable Browser tab.
   Typing `/` exposes the error and **Retry commands**. Clicking Retry performs
   the real catalog request and restores all five options without losing `/`.
   A separate manually released fetch barrier proves the loading state and
   that Enter cannot accidentally submit `/` while the catalog is pending.
   These injections cover transport UI states only; command execution is never
   mocked or driven by direct HTTP calls.
8. At 390×844 (and the emulated 390×664 keyboard-height viewport), tap the
   project-local skill and Send. The provider confirms the project skill body
   was expanded. Menu touch targets are 44px; the menu stays within the viewport
   and its content scrolls when needed. At 844×390, scroll to the last option
   and select it. The menu, textarea and footer do not overlap or overflow.
9. Direct boundary checks additionally confirm `/commands` rejects missing
   `x-hui` with 403 and projects only `name`, `description`, and `source`.

The provider received exactly three model requests: the user skill, template,
and project skill. Neither extension command was sent to the model. The summary
is in [provider proof](evidence/2026-09-24-slash-commands.json).

## Validation and limits

- Focused command/runtime/session tests; full `npm test`: **378 passed**.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- Browser snapshots and keyboard/mouse/touch controls covered desktop and mobile.
- The development trace contains expected connection resets during Vite server
  restarts. The fresh final Browser tab reports **0 page errors and 0 console
  errors**. The final landscape pass also confirms that the first option is
  hit-testable, the last option can be scrolled to and clicked, and Retry returns
  focus to Message. The native form's overflow is released only while this
  landscape command sheet is open, avoiding clipped pointer targets.
- Terminal-only PI built-ins are intentionally absent. Catalog discovery does
  not implement arbitrary TUI-only extension widgets; the existing supported
  RPC question requests remain the interaction boundary. The fixture provider
  proves expansion/transport, not a particular remote model's compliance.

Stop only the disposable gateway, provider and browser processes and close the
fixture tabs. Retain the temporary root for inspection; do not delete operator
PI/HUI data during cleanup.
