# HUI model routing and `/btw`

Verified on 2026-09-24 with the OpenClaw Browser tool against HUI and real PI
0.73.1. Generation used the deterministic local Anthropic-protocol fixture;
no paid account or operator configuration was used.

## Scope and results

Settings → Models' primary, fallback and utility pickers (SET-045) and the utility model's session titles and
`/btw` side rail (SET-047) are proven by `e2e/tests/set/models.e2e.ts`. What this journey still covers:

- The normal session turn stayed on `anthropic/primary-fixture`.
- The `/btw` side rail was inspected at 1440x900 and 390x844. The mobile layout had
  zero horizontal document/body overflow. No browser runtime errors were found.

Primary failure before useful output, a single cross-provider retry from OpenAI
to Anthropic, and refusal to retry that turn twice are covered by the focused
`LiveSessions` unit test.

## Reproduction

Create an isolated root containing `workspace`, `pi-agent`, `pi-sessions`,
`xdg/hui`, and `browser`. Configure three models in `pi-agent/models.json` under
a local Anthropic-protocol provider: `primary-fixture`, `fallback-fixture`, and
`utility-fixture`. Point them at `e2e/fixtures/pi-provider-fixture.mjs`, and seed HUI's
settings with those three canonical model IDs.

Start the fixture provider and Vite with `XDG_CONFIG_HOME`,
`PI_CODING_AGENT_DIR`, and `PI_CODING_AGENT_SESSION_DIR` pointing exclusively
inside that root. Start an owned headless browser with its profile under the
same root. In HUI:

1. Start a session from the disposable workspace with
   `Implement model routing E2E` and verify its turn runs on `anthropic/primary-fixture`.
2. Send `/btw which model named this session?` and inspect the side rail at desktop
   and mobile widths, querying browser errors and overflow.

## Checks

- `npm test`: 464 passed, no skips.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Browser errors: 0.
- Mobile document/body horizontal overflow: 0 px.
