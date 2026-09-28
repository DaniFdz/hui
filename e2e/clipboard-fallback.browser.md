# Clipboard fallback browser journey

## Journey

1. Start the isolated SDK fixture and create a session through HUI.
2. Remove `navigator.clipboard` from the page to reproduce an HTTP/Tailscale
   origin where the modern Clipboard API is unavailable.
3. Activate **Copy response** with a real pointer event and verify the fallback
   receives the exact assistant text, the button reports **Copied**, and the
   temporary textarea is removed.
4. Verify the latest assistant copy action is directly interactive on touch and
   narrow layouts, with no desktop or mobile overflow.

## Evidence

Follow the [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md)
for fresh desktop/mobile evidence in the PR description, outside Git history.
