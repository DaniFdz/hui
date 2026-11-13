# Browser journey: local model servers

The shared test `e2e/tests/set/local-model-server.e2e.ts` proves SET-098 in the
default web world. It adds a custom PI provider whose base URL points at a test
HTTP server that answers 503 until released, and drives Settings → Models → Model providers → the folded Local
model servers group: the provider starts Offline, a start command that waits for a
release file is saved in its dialog, Start shows Starting…, a chat on that model shows
**Waiting for Local fixture to start…**, and once the file exists the health check
answers and the turn completes with **Fixture response.**. It then checks Online
in Settings and the `GET /__hui/local-providers` snapshot, and exercises the
Remove command confirmation.

## What it does not cover

- The operator's real wake-on-LAN or SSH command, and a machine that actually
  boots; the test's command is a portable shell wait and its health server lives
  in the test process.
- A failed start's Settings message and the model request's failure reason;
  those paths are unit-tested in `server/pi/local-providers.test.ts`.
- Remote workers: their provider mirror does not carry the gateway's start
  command, and only the gateway machine can run it.

## Manual reproduction

Seed a disposable PI agent `models.json` with a custom provider whose `baseUrl`
is a local HTTP server that is off, add its start command and health URL in the provider's dialog under
Settings → Models → Model providers → Local model servers, press Start, and open a chat on one of its models while the
start runs. Keep the command non-interactive (SSH keys, not a password prompt).
