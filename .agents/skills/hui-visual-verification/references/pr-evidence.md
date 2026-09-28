# Evidence handoff

## Local run record

Keep a Markdown/JSON record **outside Git** next to the captures containing:

- PR HEAD SHA and branch, working-tree status and doctor result;
- fixture kind (seeded / real PI + local provider / external), run URL and scenario;
- actions performed through visible controls and observed assertions;
- viewport, theme/device emulation, capture time and image filenames;
- new page/console errors, checks run, limitations and cleanup outcome.

Do not upload the full runner receipt, provider logs, profiles, local paths or
transcripts to GitHub. Its local identity/cleanup token belongs to the run.
The PR needs the commit, proof scope, assertions and screenshots, not host metadata.

## GitHub images

1. Prefer native `gh pr create/edit --attach` (GitHub CLI 2.99.0+). Check
   `gh pr edit --help` for the flag before assuming browser login is needed.
   It uses the existing CLI authentication and requires push access to the repo.
   Upload inspected images with repeated `--attach` flags and use `--body-file`
   to preserve Markdown. GitHub's authenticated attachment UI remains a fallback.
2. Place each image beneath a meaningful scenario/viewport heading. Label a
   deterministic fixture as such. A before/after comparison must name both SHAs;
   final-state images alone must not pretend to be before/after evidence.
3. Save and inspect the rendered description. Check that images render, correspond
   to the claimed HEAD and contain only synthetic/appropriate data. Preserve
   unrelated PR description sections when updating via CLI.
4. Share the same files in the chat. Conversation attachments are separate from
   GitHub attachments and do not satisfy the PR requirement by themselves.

For example, from the temporary evidence directory **outside the repository**,
put `![Desktop — scenario, 1440×900](./desktop.png)` and
`![Mobile — scenario, 390×844](./mobile.png)` under their headings in `body.md`.
Preserve the existing description's other sections when preparing that file, then:

```sh
gh pr edit <pr-number> --repo <owner/repo> --body-file body.md \
  --attach ./desktop.png --attach ./mobile.png
```

Matching local image references are replaced in place with GitHub attachment URLs;
unreferenced attachments are appended. `--body-file` alone does not upload files.
Check the saved body after the command: a nonzero exit can mean partial success,
so retry only missing attachments rather than blindly duplicating successful ones.
See [GitHub's attachment guide](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli).

A published `/tmp/…` path, OpenClaw media URL, base64 payload, Git commit
of a PNG or inaccessible artifact URL is not a substitute. Do not create a release,
public gist or third-party image-host upload just to work around unavailable PR
attachments. If authenticated upload is unavailable, state the gap in the PR,
keep it draft, and deliver the files in chat for attachment once access is available.

## PR body outline

```markdown
## Summary
- What changed and why.

## Verification
- Commit: <full SHA>; clean checkout.
- Fixture: real PI SDK + deterministic local provider (not a live model).
- Browser journey: <actions and observed results>.
- Checks: <exact commands/results>.

## Visual evidence
### Desktop — <scenario>, 1440×900
<GitHub attachment Markdown>

### Mobile — <scenario>, 390×844
<GitHub attachment Markdown>

## Limits
- <What this does not prove; any blocked checks or attachment gap>.
```
