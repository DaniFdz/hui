# Browser journey: dollar references and mixed slash discovery

Verified 2026-09-25 using the real installed PI 0.73.1 RPC process, the running
HUI app and `pi-provider-fixture.mjs`. Follow the isolated setup in
[slash-commands.browser.md](slash-commands.browser.md): a fresh temporary root,
fixture-only PI agent/session/config directories, `PI_OFFLINE=1`, the
`browser-check` skill, `plan-check` template and `check-status` extension.
This run used provider port 43231 and gateway `http://localhost:5178`.
No operator credentials, skills, transcripts or registry were changed.

## Observed Browser-tool journey

1. Set Project directory to the temporary workspace, type `/`, and click
   **Start session & browse commands**. The idle session preserves `/` and
   exposes one menu containing Plugin actions, Skills, Prompt templates and
   Files and folders. Starting/browsing does not call the provider.
2. Type `/browser`; Tab inserts `$browser-check ` without sending. Click Send.
   PI expands the actual skill and returns `Fixture response.`; the provider
   log contains `HUI_SKILL_EXPANSION_PROOF`. This produced one model request.
3. Type `$check`, press Enter to complete `$check-status`, then Enter to send.
   The UI reports `Extension executed:` and returns Idle. The provider still
   has exactly one request: the extension executed without a model turn.
4. Type `/`, then ArrowDown three times. Selection crosses the three command
   groups into `/bin/`; `aria-activedescendant` identifies option 3. Enter
   completes `/bin/` and opens its dedicated path menu with `/bin/sh`.
5. Type `@fi`; the temporary workspace's `fixture.txt` appears and Tab completes
   it. Existing file mentions remain workspace-relative.
6. At 390×664 (iPhone emulation), `/` displays all four group labels in one
   scrollable menu. Its bounds are x=9, width=372, y=257, height=279, with no
   horizontal page overflow. Tapping the skill inserts `$browser-check` and
   closes the menu without sending.
7. Type `$`: only the extension and skill appear, without templates or paths.
   Escape closes the menu, sets `aria-expanded=false`, and preserves `$`.
8. Inspect rendered desktop (1440×1000) and mobile screenshots. The final
   Browser error and console-error inventories are empty.

Screenshots were delivered directly in chat from transient outbound storage,
not saved in this repository. Existing PI-expanded skill transcript rendering
is unchanged. Dollar references are leading invocations, not inline prose
expansion. Runtime tests cover collisions, disabled skills, unknown tokens,
steering/follow-up translation and rejection of steering plugin actions.

## Checks

- Focused command-reference, slash/path parsing and PI runtime tests: 34 passed.
- Full `npm test`: 466 passed, zero failures.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.

Cleanup stops only this run's disposable gateway/provider processes and closes
its labeled Browser tab. Temporary fixture files can remain for inspection.

## Integrated main / SDK revalidation

The shared source checkout diverged from remote main. The change was reapplied
in an isolated worktree on `04e65dc`, preserving HUI's `/update`, `/clear`, `/btw`
and `/side` commands, and pane-qualified menu/option IDs. Dollar discovery
excludes HUI operations but can find runtime actions even when their name is
reserved by a HUI slash command. Fully qualified skill aliases are accepted too.

The integrated build was exercised through Browser with `npm run e2e:sdk`,
`HUI_E2E_PORT=43232`, PI SDK 0.87.1, and fresh disposable fixtures:

- New Session → browse `/` → `$sdk` → Tab → Send expanded the real SDK fixture
  skill and returned `Fixture response.`. Provider log: one request containing
  the skill body.
- Sending `$check-status integrated` displayed `Extension executed: integrated`
  and Idle, with no additional model request.
- `/` kept HUI commands, plugin actions, skills and root paths in separate
  groups. Keyboard navigation selected the plugin group with a pane-qualified
  active-descendant ID. `/bi` → Enter opened `/bin/` with `/bin/sh` available.
- Fresh 1440×1000 desktop and 390×664 mobile screenshots were inspected and
  shared directly. Mobile skill selection inserted `$sdk-fixture` without sending.
  Browser page-error and console-error inventories were empty.
- Integrated focused tests: 43 passed. Full suite: 655 passed. Typecheck and
  production build passed (the existing large-chunk bundle advisory remains).
