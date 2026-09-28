# Evidence delivery

Keep screenshots and other transient proof outside the repository, separate from
data removed by cleanup. Record branch/commit, dirty state or build identity,
surface, fixture type, actions, assertions, viewport, time and cleanup result.
Do not upload credentials, raw auth/identity receipts, private transcripts or
browser profiles. Label proof gaps and fixtures honestly.

For UI work, inspect real rendered captures and share them directly in the
conversation. When the project uses PRs, include fresh relevant screenshots in
the PR description, desktop/mobile where relevant. A chat attachment or local
path is not a PR attachment. Do not commit screenshots or base64 payloads as a
delivery workaround. Follow the project's draft/ready policy if upload fails.

## GitHub

Check `gh pr edit --help` for `--attach` before requesting browser login. GitHub
CLI 2.99.0+ supports repeated attachments with existing CLI authentication:

```sh
# Run from the evidence directory, outside the repository.
gh pr edit <number> --repo <owner/repo> --body-file body.md \
  --attach ./desktop.png --attach ./mobile.png
```

This is a syntax example: use the actual PR, image files and relevant viewports.
Prepare `body.md` with the existing description preserved and image references
such as `![Desktop — scenario](./desktop.png)`. Matching references are replaced
with GitHub attachment URLs; otherwise attachments are appended. `--body-file`
alone does not upload anything. `gh pr create --attach` is also available.

Inspect the saved/rendered description and uploaded images. On an error, check
for partial success before retrying. Use an authenticated browser upload only
if the native CLI path is unavailable. Do not invent URLs or use a release,
public gist or third-party host to work around missing upload access.

For other forges/hosts, inspect the available authenticated attachment API/UI and
verify the reviewer can access the result. Follow existing publication authority;
creating a verification skill does not authorize unrelated external actions.
