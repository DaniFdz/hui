import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionStatus, ExtensionsResponse } from "../server/api/extensions.ts";
import { extensionsCommand, formatExtension, formatExtensions } from "./extensions.ts";
import type { request } from "./gateway-client.ts";

const HELLO: ExtensionStatus = {
  id: "hello", name: "Hello", description: "Fixture.", enabled: true, state: "loaded",
  routes: [{ method: "GET", path: "hello", description: "Greets." }],
};
const GHOST: ExtensionStatus = {
  id: "ghost", name: "Ghost", description: "", enabled: false, state: "missing", error: "no extension directory", routes: [],
};

test("the list prints each extension's id, state, name and routes", () => {
  const response: ExtensionsResponse = { extensions: [GHOST, HELLO] };
  assert.equal(formatExtensions(response), [
    "ghost  missing   Ghost · no routes · off",
    "hello  loaded    Hello · 1 route · GET",
  ].join("\n"));
  assert.equal(formatExtensions({ extensions: [] }), "No gateway extensions installed.");
  assert.match(formatExtensions({ extensions: [HELLO], storeError: "not valid JSON" }), /The enable list could not be read: not valid JSON/u);
  assert.equal(formatExtension(HELLO), "hello: loaded");
  assert.equal(formatExtension(GHOST), "ghost: missing (off) — no extension directory");
});

test("the command lists, enables and disables through the gateway", async () => {
  const seen: { path: string; options?: unknown }[] = [];
  const send = (async (_base: string, path: string, options?: unknown) => {
    seen.push({ path, ...(options === undefined ? {} : { options }) });
    return path === "/__hui/ext" ? { extensions: [HELLO] } : HELLO;
  }) as typeof request;

  assert.deepEqual(await extensionsCommand("http://gateway", "list", undefined, { send }), { extensions: [HELLO] });
  await extensionsCommand("http://gateway", "enable", "hello", { send });
  await extensionsCommand("http://gateway", "disable", "hello", { send });
  assert.deepEqual(seen, [
    { path: "/__hui/ext" },
    { path: "/__hui/ext/hello", options: { method: "PUT", body: { enabled: true } } },
    { path: "/__hui/ext/hello", options: { method: "PUT", body: { enabled: false } } },
  ]);
  await assert.rejects(extensionsCommand("http://gateway", "enable", undefined, { send }), /needs an extension id/u);
  await assert.rejects(extensionsCommand("http://gateway", "disable", "Bad_ID", { send }), /needs an extension id/u);
});
