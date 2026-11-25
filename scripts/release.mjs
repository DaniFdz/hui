/** Release planning for CI. It decides whether a commit is a release, checks that package.json, package-lock.json and
 * any tag agree on a rising stable version, and writes the changelog since the previous stable tag. It only reads
 * git; tagging and publishing belong to the workflow. */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const readJson = (cwd, ref, path) => JSON.parse(git(cwd, "show", `${ref}:${path}`));
const commitExists = (cwd, ref) => {
  if (!ref || /^0+$/u.test(ref)) return false;
  try { git(cwd, "cat-file", "-e", `${ref}^{commit}`); return true; }
  catch { return false; }
};
const compare = (a, b) => {
  const left = a.split(".").map(BigInt);
  const right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
};
const escape = (text) => text.replace(/[\\`*_{}\[\]<>]/gu, "\\$&");

/** GitHub refuses a release body over 125,000 characters, which a long-running project's changelog passes: keep the
 * entries that fit and say how many the full diff holds, so publication never fails on the note itself. */
const RELEASE_BODY_LIMIT = 120_000;
export function fitChangelog(lines, budget) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    if (kept.length && used + line.length + 1 > budget - 80) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = lines.length - kept.length;
  return `${[...kept, ...(omitted ? [`- …and ${omitted} more commits, each in the full diff below.`] : [])].join("\n")}\n`;
}

export function planRelease({ cwd = process.cwd(), base, tag, repository }) {
  const version = readJson(cwd, "HEAD", "package.json").version;
  const hasBase = commitExists(cwd, base);
  if (!tag && hasBase && version === readJson(cwd, base, "package.json").version) return { changed: false };
  if (!stable.test(version)) throw new Error("Release version must be stable SemVer (X.Y.Z)");
  if (tag && tag !== `v${version}`) throw new Error("Release tag must match package.json");
  const lock = readJson(cwd, "HEAD", "package-lock.json");
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error("package-lock.json versions must match package.json");
  }
  if (!tag && hasBase) {
    const previousVersion = readJson(cwd, base, "package.json").version;
    if (!stable.test(previousVersion) || compare(version, previousVersion) <= 0) {
      throw new Error("Release version must increase relative to the base");
    }
  }
  const releaseTag = `v${version}`;
  const tags = git(cwd, "tag", "--merged", "HEAD").split("\n").filter((value) => stable.test(value.slice(1)) && value.startsWith("v"));
  // Exclude the current release on manual-tag runs and retries.
  const previousTag = tags.filter((value) => value !== releaseTag)
    .sort((a, b) => compare(b.slice(1), a.slice(1)))[0];
  if (previousTag && compare(version, previousTag.slice(1)) <= 0) throw new Error("Release version must exceed the last stable tag");
  const allTags = git(cwd, "tag", "--list", releaseTag);
  if (allTags && git(cwd, "rev-parse", `${releaseTag}^{commit}`) !== git(cwd, "rev-parse", "HEAD")) {
    throw new Error("Release tag already exists on another commit");
  }
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const commits = git(cwd, "log", "--reverse", "--no-merges", "--format=%H%x09%s", range);
  const url = `https://github.com/${repository}`;
  const lines = commits ? commits.split("\n").map((line) => {
    const [sha, ...subject] = line.split("\t");
    return `- ${escape(subject.join("\t"))} ([${sha.slice(0, 7)}](${url}/commit/${sha}))`;
  }) : ["- No non-merge commits since the previous release."];
  const comparison = previousTag ? `\n[Full diff since ${previousTag}](${url}/compare/${previousTag}...${git(cwd, "rev-parse", "HEAD")})\n` : "\nInitial release: all commits are included.\n";
  const heading = `# ${releaseTag}\n\n`;
  return { changed: true, tag: releaseTag, changelog: `${heading}${fitChangelog(lines, RELEASE_BODY_LIMIT - heading.length - comparison.length)}${comparison}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const result = planRelease({
    base: event.pull_request?.base.sha ?? event.before,
    tag: process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined,
    repository: process.env.GITHUB_REPOSITORY,
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
  if (result.changed) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\n`);
    writeFileSync("release-changelog.md", result.changelog);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.changelog);
  }
}
