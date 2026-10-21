# Miami theme: the accent in focus rings

Choosing Miami, its colours in each mode, reloading, an accent over it, Theme default and System following the
device are proven by the shared tests `e2e/tests/set/theme.e2e.ts`, `accent.e2e.ts` and `color-mode.e2e.ts`
(SET-005, SET-006, SET-007). What is left here is SET-076: a focus ring only shows for a control reached from the
keyboard, which no shared test does yet.

## Fixture and reproduction

Launch the default fixture with `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`
and open its `browserUrl` at `/settings/appearance` in the Browser tool. No model request is needed.

## Browser journey

1. Choose **Miami**, then **Blue** under Accent.
2. Press Tab until a theme card has focus. Its focus ring is drawn in the Blue accent (`#5b9cf6`).
3. Choose **Theme default**, then focus the card again with Tab: the ring is Miami's own pink (`#f472b6`).
4. Browser console errors and runtime errors: none.

## Source and checks

- `public/themes/miami.css` is byte-identical to OpenClaw 2026.9.5's standalone
  theme, SHA-256 `46c7e1855d75867affcc1dd45ed427952f6d469302815d7cdb247f47378df4be`.
- The existing native-palette guard includes this hash; selector tests cover
  both variants and a user theme with the same id keeps its custom mapping.
