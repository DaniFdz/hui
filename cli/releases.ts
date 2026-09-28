import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertUpdatable, packageVersion, type Installation } from "./installation.ts";
import type { ReleaseInfo, UpdateCheck } from "../src/lib/update-types.ts";

export const RELEASE_REPOSITORY = "DaniFdz/hui";
const repositoryPath = `repos/${RELEASE_REPOSITORY}`;
const MAX_ARCHIVE = 100 * 1024 * 1024;
type Asset = { id: number; name: string; size: number };
export type Release = ReleaseInfo & { archive: Asset; checksum: Asset };
export type GithubRead = (path: string, maxBytes: number, binary?: boolean) => Promise<Buffer>;

async function boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("GitHub release response exceeded the allowed size.");
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("GitHub release response exceeded the allowed size.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** Public GitHub releases need no local gh login. Paths and asset IDs are
 * generated here, never followed from release-provided URLs. */
export async function githubReadWith(fetchImpl: typeof fetch, path: string, maxBytes: number, binary = false): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), binary ? 120_000 : 20_000);
  try {
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      headers: {
        Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
        "User-Agent": "HUI updater",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error("No stable HUI release is published yet.");
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub's public API rate limit is exhausted. Retry after the rate-limit reset.");
    }
    if (!response.ok) throw new Error(`GitHub release access failed with HTTP ${response.status}.`);
    return await boundedBody(response, maxBytes);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("No stable HUI release")
      || error.message.startsWith("GitHub release") || error.message.startsWith("GitHub's public API"))) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("GitHub release access timed out.");
    throw new Error("GitHub release access failed. Check the gateway host's internet connection and retry.");
  } finally {
    clearTimeout(timeout);
  }
}

export const githubRead: GithubRead = (path, maxBytes, binary = false) => githubReadWith(fetch, path, maxBytes, binary);

export function parseRelease(value: unknown): Release {
  const raw = value as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown } | null;
  const version = typeof raw?.tag_name === "string" ? /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(raw.tag_name)?.[1] : undefined;
  if (!version || raw?.draft !== false || raw.prerelease !== false || !Array.isArray(raw.assets)) throw new Error("GitHub did not return a stable HUI release.");
  const assets = raw.assets;
  const asset = (name: string, limit: number): Asset => {
    const matches = assets.filter((entry: Asset | null) => entry?.name === name);
    const entry = matches[0] as Asset | undefined;
    if (matches.length !== 1 || !entry || !Number.isSafeInteger(entry.id) || entry.id <= 0 || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > limit) {
      throw new Error(`Release is missing a valid ${name} asset.`);
    }
    return { id: entry.id, name, size: entry.size };
  };
  const tag = `v${version}`;
  return { version, tag, url: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${tag}`,
    archive: asset(`hui-${version}.tgz`, MAX_ARCHIVE), checksum: asset(`hui-${version}.tgz.sha256`, 512) };
}

export function newerVersion(latest: string, current: string): boolean {
  const left = latest.split(".").map(BigInt);
  const right = current.split("-")[0]!.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]!;
  return current.includes("-");
}

export async function latestRelease(read: GithubRead = githubRead): Promise<Release> {
  return parseRelease(JSON.parse((await read(`${repositoryPath}/releases/latest`, 1024 * 1024)).toString()));
}

export async function checkRelease(installation: Installation, read: GithubRead = githubRead): Promise<UpdateCheck> {
  const currentVersion = await packageVersion(installation.packageRoot);
  let restriction = "";
  try { await assertUpdatable(installation.installationRoot); }
  catch (error) { restriction = (error as Error).message; }
  try {
    const release = await latestRelease(read);
    const available = newerVersion(release.version, currentVersion);
    return { currentVersion, latest: { version: release.version, tag: release.tag, url: release.url },
      status: available ? "available" : "current", canInstall: available && !restriction,
      message: restriction || (available ? "A new HUI release is ready to install." : "You are running the latest stable HUI release or a newer version.") };
  } catch (error) {
    const message = (error as Error).message;
    return { currentVersion, latest: null, status: message.startsWith("No stable HUI release is published") ? "unpublished" : "unavailable",
      canInstall: false, message: [restriction, message].filter(Boolean).join(" ") };
  }
}

/** Download both pinned assets, verify exact lengths and digest before npm ever
 * sees the archive. The checksum detects corruption; it is not a signature. */
export async function downloadRelease(release: Release, read: GithubRead = githubRead): Promise<{ path: string; sha256: string; dispose(): Promise<void> }> {
  const checksum = await read(`${repositoryPath}/releases/assets/${release.checksum.id}`, 512, true);
  const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^\s]+)\s*$/u.exec(checksum.toString());
  if (checksum.length !== release.checksum.size || !match || match[2] !== release.archive.name) throw new Error("Release checksum file is invalid.");
  const archive = await read(`${repositoryPath}/releases/assets/${release.archive.id}`, MAX_ARCHIVE, true);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (archive.length !== release.archive.size || sha256 !== match[1]!.toLowerCase()) throw new Error("Release SHA-256 or size does not match. Nothing was installed.");
  const directory = await mkdtemp(join(tmpdir(), "hui-download-"));
  const path = join(directory, release.archive.name);
  try { await writeFile(path, archive, { mode: 0o600, flag: "wx" }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { path, sha256, dispose: () => rm(directory, { recursive: true, force: true }) };
}
