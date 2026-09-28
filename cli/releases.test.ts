import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkRelease, downloadRelease, githubReadWith, newerVersion, parseRelease, type GithubRead } from "./releases.ts";

const bytes = Buffer.from("synthetic archive");
const checksum = Buffer.from(`${createHash("sha256").update(bytes).digest("hex")}  hui-0.2.0.tgz\n`);
const metadata = () => ({ tag_name: "v0.2.0", draft: false, prerelease: false,
  assets: [{ id: 1, name: "hui-0.2.0.tgz", size: bytes.length }, { id: 2, name: "hui-0.2.0.tgz.sha256", size: checksum.length }] });

test("only a stable tag with unique bounded archive/checksum asset IDs is installable", () => {
  assert.equal(parseRelease(metadata()).url, "https://github.com/DaniFdz/hui/releases/tag/v0.2.0");
  for (const invalid of [null, {}, { ...metadata(), tag_name: "v0.2.0-rc.1" }, { ...metadata(), draft: true },
    { ...metadata(), prerelease: true }, { ...metadata(), assets: [] }, { ...metadata(), assets: [...metadata().assets, metadata().assets[0]] },
    { ...metadata(), assets: [{ id: -1, name: "hui-0.2.0.tgz", size: bytes.length }, metadata().assets[1]] },
    { ...metadata(), assets: [{ id: 1, name: "hui-0.2.0.tgz", size: 101 * 1024 * 1024 }, metadata().assets[1]] }]) {
    assert.throws(() => parseRelease(invalid));
  }
});

test("version ordering is numeric and never downgrades a newer installation", () => {
  assert(newerVersion("0.10.0", "0.9.0"));
  assert(newerVersion("1.0.0", "1.0.0-rc.1"));
  assert(!newerVersion("0.9.0", "0.10.0"));
  assert(!newerVersion("1.0.0", "1.0.0"));
});

test("public release reads need no gh login and enforce response bounds", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const read = (response: Response) => githubReadWith(async (input, init) => {
    calls.push({ url: String(input), init });
    return response;
  }, "repos/DaniFdz/hui/releases/latest", 32);
  assert.deepEqual(await read(new Response("release")), Buffer.from("release"));
  assert.equal(calls[0]?.url, "https://api.github.com/repos/DaniFdz/hui/releases/latest");
  assert.equal(new Headers(calls[0]?.init?.headers).get("user-agent"), "HUI updater");
  await assert.rejects(read(new Response("missing", { status: 404 })), /No stable HUI release is published/u);
  await assert.rejects(read(new Response("limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } })), /rate limit/u);
  await assert.rejects(read(new Response("x".repeat(33))), /allowed size/u);
});

test("download verifies asset identity, exact length and digest before writing an archive", async () => {
  const requested: string[] = [];
  const read: GithubRead = async (path) => { requested.push(path); return path.endsWith("/2") ? checksum : bytes; };
  const download = await downloadRelease(parseRelease(metadata()), read);
  try { assert.deepEqual(await readFile(download.path), bytes); }
  finally { await download.dispose(); }
  assert.deepEqual(requested, ["repos/DaniFdz/hui/releases/assets/2", "repos/DaniFdz/hui/releases/assets/1"]);
  await assert.rejects(downloadRelease(parseRelease(metadata()), async (path) => path.endsWith("/2") ? checksum : Buffer.from("corrupted archive")), /SHA-256 or size/u);
  await assert.rejects(downloadRelease(parseRelease(metadata()), async () => Buffer.from(checksum.toString().replace("hui-0.2.0.tgz", "hui-0.3.0.tgz"))), /checksum file/u);
});

test("checks distinguish availability, unpublished releases and source-managed installations without writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hui-release-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installed = join(root, "node_modules/hui");
  for (const [file, value] of Object.entries({ "package.json": JSON.stringify({ name: "hui", version: "0.1.0" }), "build/release.json": JSON.stringify({ format: 1, version: "0.1.0" }),
    "dist/index.html": "", "build/cli/main.js": "", "build/cli/gateway-run.js": "", "build/server/runtimes/pi-sdk-worker.js": "" })) {
    const path = join(installed, file);
    await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, value);
  }
  const read: GithubRead = async () => Buffer.from(JSON.stringify(metadata()));
  const result = await checkRelease({ installationRoot: installed, packageRoot: installed }, read);
  assert.equal(result.status, "available"); assert.equal(result.canInstall, true);
  const source = await checkRelease({ installationRoot: root, packageRoot: installed }, read);
  assert.equal(source.canInstall, false); assert.match(source.message, /source checkout/u);
  const unpublished = await checkRelease({ installationRoot: installed, packageRoot: installed }, async () => { throw new Error("No stable HUI release is published yet."); });
  assert.equal(unpublished.status, "unpublished"); assert.equal(unpublished.canInstall, false);
});
