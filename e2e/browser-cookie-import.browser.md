# Imported browser cookies journey

Verified on 2026-11-19 by the shared test
`e2e/tests/set/browser-cookie-import.e2e.ts` (SET-101) on the `web` target, and
by `server/browser/manager.test.ts` and `server/routes/browser.test.ts` for the
parts no Browser check drives. Only the model provider is mocked
(`e2e/fixtures/pi-provider-fixture.mjs`); HUI, the gateway, Pi Durable, the
cookie file and HUI's own managed headless Chromium are real. The cookie's value
is a `randomUUID()` written at run time, so no operator login, cookie, browser
profile or credential was used. Keep fresh screenshots outside Git and include
them in the PR description and the conversation.

The procedure below is the same journey by hand. It is kept for the settings
row's looks at both widths and for the report a stopped browser gives, which the
shared test does not drive; `manager.test.ts` proves the parking itself.

## Reproduction

1. Run `npm ci` and, without an ambient HTTP proxy for loopback
   (`env -u HTTP_PROXY -u HTTPS_PROXY -u NODE_USE_ENV_PROXY` where one is set),
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`.
   Open the receipt's `browserUrl` in a labeled Browser-tool tab at 1440×900 and
   repeat at 390×844.
2. Write the login another browser would export, as the receipt's `workspace`
   file `cookie-import.json`: a Playwright `storageState` document holding one
   session cookie for the fixture's host and no origins —

   `{"cookies":[{"name":"hui_import","value":"<a fresh uuid>","domain":"127.0.0.1","path":"/","expires":-1,"sameSite":"Lax"}],"origins":[]}`

3. Create a session in that workspace and send
   `E2E_CALL:<base64url of {"name":"browser","input":{"action":"open","url":"<providerUrl>/browser-cookie-fixture"}}>`,
   which the fixture turns into one real `browser` call. Its page is titled
   `HUI cookie fixture` and says **signed out** or **signed in**: the fixture's
   own server reads the incoming `Cookie` header, so the page never holds a
   cookie's value and cannot echo one.
4. Settings → Tools → Browser: the **Import cookies** row sits after **Mirror
   browser state**. Fill **Cookies file** with the file's absolute path and press
   **Import cookies**.
5. Back in the chat, send `E2E_CALL:<base64url of {"name":"browser","input":{"action":"reload"}}>`
   to reload the tab the open left.

## Observed

- Before the import the open's own snapshot read `- paragraph: signed out` on
  `http://127.0.0.1:<provider port>/browser-cookie-fixture`, in tab `t1`.
- The import reported, in the row's own report, the two lines
  `imported 1 cookie for 1 domain (0 expired dropped)` and
  `domains: 127.0.0.1`; the line
  `They apply when the managed browser next starts.` was absent, because the
  browser the open started was still running and took the cookies itself. The
  gateway logged `POST /__hui/browser/cookies HTTP 200 in 2 ms`.
- The reload of the same tab `t1` on the same URL read `- paragraph: signed in`:
  one real page answers both ways, and the login another browser exported now
  signs HUI's browser in.
- The value never reached the screen or the chat: the settings page and the
  transcript held no copy of it, and neither does the report, which is counts and
  domains only.
- The next-start path is proven without waiting: `server/browser/manager.test.ts`
  parks an import in `browser/pending-import.json` (mode 0600) while the browser
  is stopped, pushes it once at the next launch and deletes the file, never sends
  one that expired while it waited, and reports `now` only for cookies a running
  browser actually took.
- The refusals — a relative path, `-`, a missing file, a directory, a file over
  4 MiB and a malformed export — and the "nothing written" that follows them are
  proven by `server/routes/browser.test.ts` and
  `server/browser/cookie-import.test.ts`, not by a Browser check.

## Limits

- The shared test drives the row at the `web` target's own viewport. No by-hand
  pass at 390×844 is recorded here yet, so the row's stacking on a phone and its
  screenshots are still to be taken; they belong in the PR description, never in
  this directory.
- The report of an import that waits for the next start (the extra
  "They apply when the managed browser next starts." line) is shown by the gateway
  and proven by `server/routes/browser.test.ts`; the shared test proves the live
  path, with a running browser, because stopping the browser and waiting for a
  start in a shared test would prove the browser's own lifecycle instead.
- The model is the deterministic fixture, so this covers HUI, the gateway, Pi
  Durable, the tool bridge and a real Chromium, not a live model deciding to
  browse.
