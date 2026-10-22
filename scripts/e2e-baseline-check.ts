/**
 * The catalogue job's check of a pull request against its base: the baseline grows only for a use case the base
 * already had the surfaces, journeys and SPEC text for (one the first inventory missed); a use case the pull request
 * changes, in its catalogue entry or a shared test tagged with it, leaves the web and iOS backlogs; and a static
 * accessible name new in `src/` appears in a shared test that runs on both targets. A use case whose test alone changed,
 * and a new name, may instead be listed on the description's `Unchanged behaviour:` line, which it reads from the pull
 * request event. It prints what moved to the job summary. Run it as `node scripts/e2e-baseline-check.ts <base-commit>`.
 */
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list } from "e2e/runner";
import { githubAnchors } from "../e2e/catalogue/anchors.ts";
import type { UseCase } from "../e2e/catalogue/types.ts";

type Tree = { cases: Map<string, UseCase>; backlog: { web: string[]; ios: string[] }; surfaces: Set<string>; anchors: Set<string>; journeys: Set<string>; labels: Set<string> };

const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/e2e-baseline-check.ts <base-commit>");
const root = process.cwd();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

async function load(dir: string): Promise<Tree> {
  const { AREAS } = await import(join(dir, "e2e/catalogue/types.ts"));
  const cases = new Map<string, UseCase>();
  for (const area of AREAS as string[]) {
    for (const entry of (await import(join(dir, `e2e/catalogue/${area.toLowerCase()}.ts`))).default as UseCase[]) cases.set(entry.id, entry);
  }
  const { browserSurfaces } = await import(join(dir, "e2e/catalogue/surfaces-src.ts"));
  const { gatewaySurfaces } = await import(join(dir, "e2e/catalogue/surfaces-server.ts"));
  const appSources = await Promise.all((await readdir(join(dir, "src"), { recursive: true }))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => readFile(join(dir, "src", name), "utf8")));
  const headings = async (document: string) => [...githubAnchors(await readFile(join(dir, document), "utf8"))].map((anchor) => `${document}#${anchor}`);
  return {
    cases,
    backlog: JSON.parse(await readFile(join(dir, "e2e/catalogue/baseline.json"), "utf8")).backlog,
    surfaces: new Set([...await browserSurfaces(), ...await gatewaySurfaces()]),
    anchors: new Set([...await headings("SPEC.md"), ...await headings("docs/api.md")]),
    journeys: new Set((await readdir(join(dir, "e2e"))).filter((name) => name.endsWith(".browser.md")).map((name) => name.slice(0, -".browser.md".length))),
    labels: new Set(appSources.flatMap((source) => [...source.matchAll(/aria-label="([^"$]+)"/gu)].map(([, label]) => label!))),
  };
}

const baseDir = await mkdtemp(join(tmpdir(), "hui-baseline-"));
git("worktree", "add", "--detach", baseDir, base);
let before: Tree;
try {
  await symlink(join(root, "node_modules"), join(baseDir, "node_modules"));
  before = await load(baseDir);
} finally {
  git("worktree", "remove", "--force", baseDir);
  await rm(baseDir, { recursive: true, force: true });
}
const after = await load(root);

const documentedOnBase = (entry: UseCase) =>
  entry.surfaces.every((surface) => before.surfaces.has(surface))
  && entry.spec.every((reference) => before.anchors.has(reference))
  && (entry.journeys ?? []).every((journey) => before.journeys.has(journey));
const sameEntry = (a: UseCase, b: UseCase) =>
  a.behaviour === b.behaviour && JSON.stringify(a.surfaces) === JSON.stringify(b.surfaces) && JSON.stringify(a.spec) === JSON.stringify(b.spec);

const { pairs } = await list({ cwd: root });
const tests = new Map<string, { file: string; line: number; tags: readonly string[]; targets: Set<string> }>();
for (const pair of pairs) {
  if (!pair.source) continue;
  const key = `${pair.file}:${pair.source.line}`;
  const entry = tests.get(key) ?? tests.set(key, { file: pair.file, line: pair.source.line, tags: pair.tags, targets: new Set() }).get(key)!;
  if (pair.disposition === "run") entry.targets.add(pair.target);
}
const changedLines = new Map<string, number[]>();
let diffFile = "";
for (const line of git("diff", "-U0", base, "--", "e2e/tests").split("\n")) {
  if (line.startsWith("+++ ")) diffFile = line.slice("+++ b/".length);
  const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(line);
  if (hunk) changedLines.set(diffFile, [...changedLines.get(diffFile) ?? [], ...Array.from({ length: Math.max(1, Number(hunk[2] ?? 1)) }, (_, offset) => Number(hunk[1]) + offset)]);
}
const testBodies = await Promise.all([...tests.values()].map(async (test) => {
  const end = Math.min(...[...tests.values()].filter((other) => other.file === test.file && other.line > test.line).map((other) => other.line - 1));
  const body = (await readFile(join(root, test.file), "utf8")).split("\n").slice(test.line - 1, Number.isFinite(end) ? end : undefined).join("\n");
  return { ...test, body, changed: (changedLines.get(test.file) ?? []).some((line) => line >= test.line && line <= end) };
}));
const testedChanges = new Set(testBodies.filter((test) => test.changed).flatMap((test) => test.tags));
const event = process.env["GITHUB_EVENT_PATH"] ? JSON.parse(await readFile(process.env["GITHUB_EVENT_PATH"], "utf8")) : {};
const unchanged = new Set([...String(event.pull_request?.body ?? "").matchAll(/^Unchanged behaviour:(.*)$/gmu)]
  .flatMap(([, items]) => items!.split(",").map((item) => item.trim().replace(/^["'`]|["'`]$/gu, ""))));
const listedUnchanged: string[] = [];

const problems: string[] = [];
const foundLater: string[] = [];
const unexcluded: string[] = [];
for (const platform of ["web", "ios"] as const) {
  for (const id of after.backlog[platform].filter((id) => !before.backlog[platform].includes(id))) {
    const entry = after.cases.get(id)!;
    const previous = before.cases.get(id);
    if (previous && previous[platform] === "required") problems.push(`${id} went back to ${platform} backlog after it was required.`);
    else if (previous) unexcluded.push(`${id} (${platform})`);
    else if (!previous && documentedOnBase(entry)) foundLater.push(`${id} (${platform})`);
    else if (!previous) problems.push(`${id} is new, so it can't be ${platform} backlog: the base has no surfaces, journeys or SPEC text for it. Make it required with a shared test.`);
  }
}
const edited = (entry: UseCase) => {
  const previous = before.cases.get(entry.id);
  return previous !== undefined && !sameEntry(previous, entry);
};
const graduated = (entry: UseCase) => (["web", "ios"] as const).some((platform) => before.cases.get(entry.id)?.[platform] === "backlog" && entry[platform] === "required");
const changed = [...after.cases.values()].filter((entry) => edited(entry) || (testedChanges.has(entry.id) && before.cases.has(entry.id) && !graduated(entry)));
for (const entry of changed) {
  const backlog = (["web", "ios"] as const).filter((platform) => entry[platform] === "backlog");
  if (!backlog.length) continue;
  if (!edited(entry) && unchanged.has(entry.id)) listedUnchanged.push(entry.id);
  else problems.push(`${entry.id} changed but is still ${backlog.join(" and ")} backlog. Make it required there with its shared test in this pull request${edited(entry) ? "" : ", or list it on the description's Unchanged behaviour: line if only its test changed"}.`);
}

const onBothTargets = testBodies.filter((test) => test.targets.has("web") && test.targets.has("ios")).map((test) => test.body);
const newNames = [...after.labels].filter((label) => !before.labels.has(label));
for (const name of newNames.filter((label) => !onBothTargets.some((body) => body.includes(`"${label}"`) || body.includes(`'${label}'`)))) {
  if (unchanged.has(name)) listedUnchanged.push(`"${name}"`);
  else problems.push(`"${name}" is a new accessible name, so a shared test that runs on the web and on iOS must use it. If it names an existing control, list it on the description's Unchanged behaviour: line.`);
}
const excluded = [...after.cases.values()].flatMap((entry) => (["web", "ios"] as const)
  .filter((platform) => typeof entry[platform] === "object" && typeof before.cases.get(entry.id)?.[platform] !== "object")
  .map((platform) => `${entry.id} (${platform})`));

const summary = [
  "## Use-case catalogue",
  "",
  `Web backlog: ${before.backlog.web.length} → ${after.backlog.web.length}. iOS backlog: ${before.backlog.ios.length} → ${after.backlog.ios.length}.`,
  "",
  `Found later, added to the baseline: ${foundLater.join(", ") || "none"}.`,
  `Newly excluded: ${excluded.join(", ") || "none"}.`,
  `Moved from excluded to backlog: ${unexcluded.join(", ") || "none"}.`,
  `Changed: ${changed.map((entry) => entry.id).join(", ") || "none"}.`,
  `New accessible names: ${newNames.map((name) => `"${name}"`).join(", ") || "none"}.`,
  `Listed as unchanged behaviour: ${listedUnchanged.join(", ") || "none"}.`,
  ...(problems.length ? ["", "### Problems", "", ...problems.map((problem) => `- ${problem}`)] : []),
  "",
].join("\n");
if (process.env["GITHUB_STEP_SUMMARY"]) await appendFile(process.env["GITHUB_STEP_SUMMARY"], summary);
process.stdout.write(summary);
process.exitCode = problems.length ? 1 : 0;
