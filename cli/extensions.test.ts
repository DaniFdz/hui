import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionStatus, ExtensionsResponse } from "../server/api/extensions.ts";
import { extensionsCommand, formatExtension, formatExtensions } from "./extensions.ts";
import type { request } from "./gateway-client.ts";

const HELLO: ExtensionStatus = {
  id: "hello", name: "Hello", description: "Fixture.", enabled: true, state: "loaded", mode: "in-process", restarts: 0,
  routes: [{ method: "GET", path: "hello", description: "Greets." }],
};
const GHOST: ExtensionStatus = {
  id: "ghost", name: "Ghost", description: "", enabled: false, state: "missing", mode: "in-process", restarts: 0, error: "no extension directory", routes: [],
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

test("install copies or links a validated extension and refuses a duplicate", async () => {
  const { mkdtemp, mkdir, writeFile, stat, lstat, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { installExtension, removeExtension } = await import("./extensions.ts");
  const root = await mkdtemp(join(tmpdir(), "hui-cli-extension-"));
  try {
    const source = join(root, "source", "hello");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "extension.json"), JSON.stringify({ apiVersion: 1, name: "Hello", description: "", main: "index.mjs" }));
    await writeFile(join(source, "index.mjs"), "export const routes = [];\n");

    const installed = await installExtension(join(root, "copied"), source);
    assert.equal(installed.id, "hello");
    assert.equal((await stat(join(root, "copied", "hello", "index.mjs"))).isFile(), true);
    await assert.rejects(installExtension(join(root, "copied"), source), /already installed/u);

    const linked = await installExtension(join(root, "linked"), source, { link: true });
    assert.equal(linked.linked, true);
    assert.equal((await lstat(join(root, "linked", "hello"))).isSymbolicLink(), true);

    await writeFile(join(source, "extension.json"), "{}");
    await assert.rejects(installExtension(join(root, "broken"), source), /apiVersion/u);

    const left = await removeExtension(join(root, "copied"), "hello");
    assert.deepEqual(left, { path: join(root, "copied", "hello"), deleted: false });
    assert.equal((await stat(left.path)).isDirectory(), true);
    const removed = await removeExtension(join(root, "copied"), "hello", { delete: true });
    assert.equal(removed.deleted, true);
    await assert.rejects(stat(removed.path));

    const unlinked = await removeExtension(join(root, "linked"), "hello", { delete: true });
    assert.equal(unlinked.deleted, true);
    await assert.rejects(stat(unlinked.path), "the symlink is gone");
    assert.equal((await stat(source)).isDirectory(), true, "the linked source stays");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reload asks the gateway to re-import the extension", async () => {
  const seen: { path: string; options?: unknown }[] = [];
  const send = (async (_base: string, path: string, options?: unknown) => {
    seen.push({ path, ...(options === undefined ? {} : { options }) });
    return { id: "hello", name: "Hello", description: "", enabled: true, state: "loaded", routes: [], mode: "in-process", restarts: 0 };
  }) as typeof request;
  await extensionsCommand("http://gateway", "reload", "hello", { send });
  assert.deepEqual(seen, [{ path: "/__hui/ext/hello/reload", options: { method: "POST" } }]);
});

test("eject copies a packaged extension into the config directory and refuses an existing copy", async () => {
  const { mkdtemp, mkdir, writeFile, stat, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ejectExtension } = await import("./extensions.ts");
  const root = await mkdtemp(join(tmpdir(), "hui-cli-eject-"));
  try {
    const bundled = join(root, "bundled", "hello");
    await mkdir(bundled, { recursive: true });
    await writeFile(join(bundled, "extension.json"), JSON.stringify({ apiVersion: 1, name: "Hello", description: "", main: "index.mjs" }));
    await writeFile(join(bundled, "index.mjs"), "export const routes = [];\n");

    const ejected = await ejectExtension(join(root, "bundled"), join(root, "config"), "hello");
    assert.deepEqual(ejected, { id: "hello", path: join(root, "config", "hello") });
    assert.equal((await stat(join(ejected.path, "extension.json"))).isFile(), true);
    await assert.rejects(ejectExtension(join(root, "bundled"), join(root, "config"), "hello"), /already exists/u);
    await assert.rejects(ejectExtension(join(root, "bundled"), join(root, "config"), "missing"), /no packaged extension/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
