# HUI-only skill disable — Browser E2E

Verified 2026-09-24 against the real HUI gateway and PI RPC runtime.

## Isolated environment

- HUI: `http://localhost:5174`
- `XDG_CONFIG_HOME=/tmp/hui-skill-e2e/xdg`
- `PI_CODING_AGENT_DIR=/tmp/hui-skill-e2e/pi`
- Fixture skills: `review` and `testing`
- Desktop: 1440×900
- Mobile: 390×844

The fixture and its HUI settings were disposable. The operator's PI settings,
skills and HUI registry were not modified.

## Journey

1. Opened Settings → Skills and observed both switches enabled.
2. Disabled `review` through the rendered switch.
3. Confirmed the switch changed while `testing` remained enabled.
4. Navigated away and reloaded Settings → Skills; the disabled state persisted.
5. Started a real PI session through **Start session & browse commands**.
6. Opened the live slash-command menu: `/skill:testing` was present and
   `/skill:review` was absent.
7. Entered `/skill:review` manually. PI did not expand or execute the skill and
   HUI rendered `Skill “review” is disabled for HUI sessions.`
8. Browser error log contained zero errors.

The no-model fixture could not perform an LLM request. System-prompt removal is
covered at the runtime-extension boundary by `skill-policy-extension.test.mjs`;
the real Browser journey proves persistence, runtime startup, command filtering
and direct-invocation blocking.
