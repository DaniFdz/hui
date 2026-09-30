import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GITHUB_CLI_REQUIRED } from "../shared/github.ts";
import { GitHubContributionsReader } from "./github-contributions.ts";

const FIXTURE = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));
const NOW = Date.parse("2026-09-30T12:00:00Z");
const dates = (count: number) => Array.from({ length: count }, (_, index) => new Date(NOW - (index % 360) * 86_400_000 - index * 1000).toISOString());

test("reads every gh account with its own login and fits searches under GitHub's 1000-result cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-gh-contributions-"));
  await chmod(FIXTURE, 0o755);
  await writeFile(join(dir, "accounts"), "work\npersonal\nbroken\n");
  const work = { commits: dates(1200), pullRequests: dates(150) };
  await writeFile(join(dir, "contributions.json"), JSON.stringify({
    work,
    personal: { commits: dates(5), pullRequests: [], createdAt: "2019-03-04T05:06:07Z" },
    broken: "HTTP 403: API rate limit exceeded",
  }));
  const reader = new GitHubContributionsReader(FIXTURE, { ...process.env, HUI_FAKE_GH_DIR: dir }, () => NOW);

  const result = await reader.read();
  assert.deepEqual(result.accounts.map((account) => account.login), ["work", "personal", "broken"]);
  const [workResult, personal, broken] = result.accounts;
  assert.deepEqual(workResult?.commits.toSorted(), work.commits.toSorted());
  assert.deepEqual(workResult?.pullRequests.toSorted(), work.pullRequests.toSorted());
  assert.equal(personal?.commits.length, 5);
  assert.equal(personal?.createdAt, "2019-03-04T05:06:07Z");
  assert.deepEqual(broken, { login: "broken", commits: [], pullRequests: [], error: "gh: HTTP 403: API rate limit exceeded" });

  const log = (await readFile(join(dir, "search-log"), "utf8")).trim().split("\n");
  // The active account uses gh's own login; others get only their own token.
  assert.ok(log.filter((line) => line.includes(" work ")).every((line) => line.endsWith("token=")));
  assert.ok(log.filter((line) => line.includes(" personal ")).every((line) => line.endsWith("token=fake-token-personal")));
  assert.ok(log.some((line) => line.startsWith("search/issues work 2025-09-24..2026-09-30 page=2 ")), "150 pull requests read page two");
  assert.ok(log.some((line) => line.startsWith("search/commits work 2025-09-24..2026-03-28 ")), "1200 commits split the window");

  await reader.read();
  assert.equal((await readFile(join(dir, "search-log"), "utf8")).trim().split("\n").length, log.length, "cached");
  await reader.read(undefined, true);
  assert.ok((await readFile(join(dir, "search-log"), "utf8")).trim().split("\n").length > log.length, "refresh searches again");

  // Calendar years gain a day each side for time zones; the current one ends today.
  await reader.read(2025);
  await reader.read(2026);
  const years = await readFile(join(dir, "search-log"), "utf8");
  assert.match(years, /^search\/issues personal 2024-12-31\.\.2026-01-01 /mu);
  assert.match(years, /^search\/issues personal 2025-12-31\.\.2026-09-30 /mu);

  await assert.rejects(new GitHubContributionsReader(join(dir, "no-such-gh")).read(), { message: GITHUB_CLI_REQUIRED });
});

test("an empty sign-in is not cached, so a new gh login shows up at once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-gh-contributions-"));
  await chmod(FIXTURE, 0o755);
  const reader = new GitHubContributionsReader(FIXTURE, { ...process.env, HUI_FAKE_GH_DIR: dir }, () => NOW);
  assert.deepEqual((await reader.read()).accounts, []);
  await writeFile(join(dir, "account"), "octocat\n");
  assert.deepEqual((await reader.read()).accounts.map((account) => account.login), ["octocat"]);
});
