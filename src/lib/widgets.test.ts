import assert from "node:assert/strict";
import test from "node:test";
import { WIDGET_CODE_MAX_BYTES, WIDGET_SANDBOX_METHOD_PREFIX } from "../../shared/widgets.ts";
import { clampWidgetHeight, openableWidgetUrl, parseWidgetFrameMessage, widgetErrorText, widgetHostContext, widgetView } from "./widgets.ts";

const call = (patch: Record<string, unknown>) => ({ name: "show_widget", args: { title: "Bot face", widget_code: "<p>hi</p>" }, ...patch });
const accepted = { widget: { version: 1, title: "Bot face", mode: "html", bytes: 9 } };

test("a widget renders only once the gateway accepted its own call", () => {
  assert.equal(widgetView({ name: "present_media", status: "succeeded" }), undefined);
  assert.deepEqual(widgetView(call({ status: "running" })), { state: "pending", title: "Bot face" });
  assert.deepEqual(widgetView(call({ status: "succeeded", details: accepted })), { state: "ready", title: "Bot face", code: "<p>hi</p>" });
  assert.deepEqual(widgetView(call({ status: "failed", output: "widget_code has a JavaScript syntax error" })), { state: "failed", title: "Bot face", error: "widget_code has a JavaScript syntax error" });
  // Accepted elsewhere, but nothing renderable here: no details, no code, or code the gateway would refuse.
  for (const patch of [
    { details: undefined },
    { details: accepted, args: { title: "Bot face" } },
    { details: accepted, args: { title: "Bot face", widget_code: "<!doctype html><p>x</p>" } },
    { details: accepted, args: { title: "Bot face", widget_code: `<p>${"x".repeat(WIDGET_CODE_MAX_BYTES)}</p>` } },
  ]) assert.equal(widgetView(call({ status: "succeeded", ...patch }))?.state, "unavailable");
});

test("the card title prefers the accepted title and stays bounded", () => {
  assert.equal(widgetView(call({ status: "running", args: {} }))?.title, "Widget");
  assert.equal(widgetView(call({ status: "succeeded", details: { widget: { title: "  Trimmed  " } } }))?.title, "Trimmed");
  assert.equal(widgetView(call({ status: "running", args: { title: "x".repeat(300) } }))?.title.length, 120);
});

test("only well-formed sandbox and widget messages are understood", () => {
  const rpc = (method: string, params?: unknown, id?: unknown) => ({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) });
  assert.deepEqual(parseWidgetFrameMessage(rpc(`${WIDGET_SANDBOX_METHOD_PREFIX}proxy-ready`, {})), { kind: "proxy-ready" });
  assert.deepEqual(parseWidgetFrameMessage(rpc(`${WIDGET_SANDBOX_METHOD_PREFIX}resource-loaded`, { renderId: "r1" })), { kind: "loaded", renderId: "r1" });
  assert.deepEqual(parseWidgetFrameMessage(rpc(`${WIDGET_SANDBOX_METHOD_PREFIX}resource-navigated`, { renderId: "r1" })), { kind: "navigated", renderId: "r1" });
  assert.deepEqual(parseWidgetFrameMessage(rpc("ui/notifications/size-changed", { height: 312.5, width: 700 })), { kind: "size", height: 312.5 });
  assert.deepEqual(parseWidgetFrameMessage(rpc("notifications/message", { level: "error", data: { message: " boom\n now ", source: "widget", line: 70, column: 3 } })), { kind: "error", message: "boom now", source: "widget", line: 70, column: 3 });
  assert.deepEqual(parseWidgetFrameMessage(rpc("ui/open-link", { url: "https://example.com/" }, "widget-1")), { kind: "open-link", id: "widget-1", url: "https://example.com/" });
  assert.deepEqual(parseWidgetFrameMessage(rpc("ui/request-display-mode", { mode: "inline" }, 2)), { kind: "display-mode", id: 2, mode: "inline" });
  for (const message of [
    null, "ui/open-link", { method: "ui/open-link", params: { url: "https://x" } }, rpc("ui/open-link", { url: 1 }),
    rpc("ui/notifications/size-changed", { height: Number.NaN }), rpc("ui/notifications/size-changed", { height: -1 }),
    rpc("notifications/message", { level: "info", data: { message: "x" } }), rpc("notifications/message", { level: "error", data: {} }),
    rpc(`${WIDGET_SANDBOX_METHOD_PREFIX}resource-loaded`, {}), rpc("ui/request-display-mode", { mode: "pip" }), rpc("tools/call", { name: "x" }),
  ]) assert.equal(parseWidgetFrameMessage(message), undefined, JSON.stringify(message));
  assert.equal(parseWidgetFrameMessage(rpc("ui/open-link", { url: "https://x" }, "x".repeat(101)))?.kind, "open-link");
  assert.equal("id" in (parseWidgetFrameMessage(rpc("ui/open-link", { url: "https://x" }, "x".repeat(101))) ?? {}), false);
});

test("the frame height is clamped to 48–8000 px", () => {
  assert.equal(clampWidgetHeight(1), 48);
  assert.equal(clampWidgetHeight(312.2), 313);
  assert.equal(clampWidgetHeight(1e9), 8000);
});

test("a widget may only open plain http(s) links", () => {
  assert.equal(openableWidgetUrl("https://example.com/a?b#c"), "https://example.com/a?b#c");
  assert.equal(openableWidgetUrl("http://localhost:8080/"), "http://localhost:8080/");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "blob:https://x/1", "file:///etc/passwd", "https://user:pass@example.com/", "/relative", "https://" + "x".repeat(2050)]) {
    assert.equal(openableWidgetUrl(url), undefined, url.slice(0, 40));
  }
});

test("inline-script errors are reported against the agent's own fragment", () => {
  assert.equal(widgetErrorText({ message: "x is not defined", source: "widget", line: 64, column: 7 }, 62), "x is not defined (line 3, column 7)");
  assert.equal(widgetErrorText({ message: "d3 failed", source: "d3.min.js", line: 2 }, 62), "d3 failed (d3.min.js, line 2)");
  assert.equal(widgetErrorText({ message: "Blocked by the widget policy (img-src): https://x/y.png" }, 62), "Blocked by the widget policy (img-src): https://x/y.png");
});

test("the host context carries the theme as widget variables", () => {
  assert.deepEqual(widgetHostContext({ mode: "light", tokens: { surface: "#fff", "font-mono": "monospace" } }, "fullscreen"), {
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "light", displayMode: "fullscreen", styles: { variables: { "--surface": "#fff", "--font-mono": "monospace" } } },
  });
});
