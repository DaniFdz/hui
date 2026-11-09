import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { secretOrigin, SiteSecrets, SiteSecretError } from "./secrets.ts";

test("an origin is scheme, host and port only", () => {
  assert.equal(secretOrigin("https://app.example.com"), "https://app.example.com");
  assert.equal(secretOrigin(" https://app.example.com:8443/login?next=1 "), "https://app.example.com:8443");
  assert.equal(secretOrigin("http://127.0.0.1:5199/"), "http://127.0.0.1:5199");
  for (const bad of ["app.example.com", "ftp://example.com", "https://user:pass@example.com", ""]) {
    assert.equal(secretOrigin(bad), undefined, bad);
  }
});

test("secrets are stored privately and only views leave the store", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-secrets-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "browser-secrets.json");
  const secrets = new SiteSecrets({ file });

  assert.deepEqual(await secrets.list(), []);
  const saved = await secrets.save({ name: " GitHub ", origin: "https://github.com/login", value: "hunter2" });
  assert.deepEqual(saved.map(({ name, origin }) => ({ name, origin })), [{ name: "github", origin: "https://github.com" }]);
  assert.equal(JSON.stringify(saved).includes("hunter2"), false, "a view never carries the value");
  assert.equal(JSON.parse(await readFile(file, "utf8")).secrets[0].value, "hunter2");
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const again = await new SiteSecrets({ file }).find("github");
  assert.equal(again?.value, "hunter2");
  assert.equal((await secrets.find("GitHub"))?.origin, "https://github.com", "names are matched lowercase");

  // Replacing a name keeps one entry; removing it leaves none.
  await secrets.save({ name: "github", origin: "https://github.com", value: "hunter3" });
  assert.equal((await secrets.find("github"))?.value, "hunter3");
  assert.equal((await secrets.list()).length, 1);
  assert.deepEqual(await secrets.remove("github"), []);
  assert.deepEqual(await secrets.list(), []);
});

test("junk names, origins and values are refused", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-secrets-junk-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const secrets = new SiteSecrets({ file: join(dir, "browser-secrets.json") });
  for (const input of [
    { name: "", origin: "https://example.com", value: "x" },
    { name: "a b", origin: "https://example.com", value: "x" },
    { name: "a".repeat(61), origin: "https://example.com", value: "x" },
    { name: "ok", origin: "example.com", value: "x" },
    { name: "ok", origin: "https://example.com", value: "   " },
    { name: "ok", origin: "https://example.com", value: "x".repeat(8_001) },
  ]) {
    await assert.rejects(secrets.save(input), SiteSecretError, JSON.stringify(input).slice(0, 60));
  }
  assert.deepEqual(await secrets.list(), []);
});

test("a corrupt or partial file is read as far as it is sound", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-secrets-corrupt-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "browser-secrets.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, "not json");
  assert.deepEqual(await new SiteSecrets({ file }).list(), []);
  await writeFile(file, JSON.stringify({ secrets: [
    { name: "good", origin: "https://example.com", value: "v", createdAt: "2026-11-08T00:00:00.000Z" },
    { name: "bad origin", origin: "https://example.com", value: "v" },
    { name: "noname", origin: "javascript:alert(1)", value: "v" },
    null,
  ] }));
  assert.deepEqual(await new SiteSecrets({ file }).list(), [{ name: "good", origin: "https://example.com", createdAt: "2026-11-08T00:00:00.000Z" }]);
});
