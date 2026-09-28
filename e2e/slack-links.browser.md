# Slack link cards browser journey

## Journey

1. Start the isolated SDK backend and open HUI through the real browser UI.
2. Create a session in the fixture workspace with the isolated Slack message
   permalink as the first prompt.
3. Verify the user turn renders a **Slack message** card and the fixture reply
   renders a **Slack channel** card.
4. Verify both actions remain HTTPS links to the original Slack destinations,
   neither card contains private message content, and loading the cards creates
   no request to Slack.
5. Reload the session, verify both cards persist from the original transcript,
   then inspect desktop and mobile layouts for overflow and console/page errors.

## Evidence

Follow the [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md)
for fresh desktop/mobile evidence in the PR description, outside Git history.
