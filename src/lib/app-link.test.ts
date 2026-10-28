import assert from "node:assert/strict";
import { test } from "vitest";
import { appHandoffUrl } from "./app-link.ts";

const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const session = "/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f";

test("a marked chat link hands off to the desktop app on macOS", () => {
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=app", userAgent: mac }),
    "hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
  assert.equal(appHandoffUrl({ pathname: "/bots/scout", search: "?open=app", userAgent: mac }), "hui://bots/scout");
  assert.equal(appHandoffUrl({ pathname: `${session}/`, search: "?x=1&open=app", userAgent: mac }),
    "hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
});

test("without the marker, nothing hands off", () => {
  assert.equal(appHandoffUrl({ pathname: session, search: "", userAgent: mac }), undefined);
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=browser", userAgent: mac }), undefined);
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=APP", userAgent: mac }), undefined);
});

test("the desktop window and phones keep the page they have", () => {
  const electron = `${mac} HUI/0.1.0 Chrome/141.0 Electron/44.4.5 Safari/537.36`;
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=app", userAgent: electron }), undefined);
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=app", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" }), undefined);
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=app", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148" }), undefined);
  assert.equal(appHandoffUrl({ pathname: session, search: "?open=app", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0" }), undefined);
});

test("only a chat route hands off", () => {
  for (const pathname of ["/", "/kanban", "/sessions", "/settings/appearance", "/not-a-route"]) {
    assert.equal(appHandoffUrl({ pathname, search: "?open=app", userAgent: mac }), undefined, pathname);
  }
});
