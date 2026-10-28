/**
 * The catalogue job's check of a pull request against its base: the baseline grows only for a use case the base
 * already had the surfaces, journeys and SPEC text for (one the first inventory missed), and a use case the pull
 * request changes, in its catalogue entry or a shared test tagged with it, leaves the web backlog. It prints what
 * moved to the job summary. Run it as `node scripts/e2e-baseline-check.ts <base-commit>`.
 */
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list } from "e2e/runner";
import { githubAnchors } from "../e2e/catalogue/anchors.ts";
import type { UseCase } from "../e2e/catalogue/types.ts";

type Tree = { cases: Map<string, UseCase>; backlog: { web: string[]; ios: string[] }; surfaces: Set<string>; anchors: Set<string>; journeys: Set<string> };

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
  const headings = async (document: string) => [...githubAnchors(await readFile(join(dir, document), "utf8"))].map((anchor) => `${document}#${anchor}`);
  return {
    cases,
    backlog: JSON.parse(await readFile(join(dir, "e2e/catalogue/baseline.json"), "utf8")).backlog,
    surfaces: new Set([...await browserSurfaces(), ...await gatewaySurfaces()]),
    anchors: new Set([...await headings("SPEC.md"), ...await headings("docs/api.md")]),
    journeys: new Set((await readdir(join(dir, "e2e"))).filter((name) => name.endsWith(".browser.md")).map((name) => name.slice(0, -".browser.md".length))),
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

const changedTests = new Set(git("diff", "--name-only", base, "--", "e2e/tests").split("\n").filter(Boolean));
const { pairs } = await list({ cwd: root });
const testedChanges = new Set(pairs.filter((pair) => changedTests.has(pair.file)).flatMap((pair) => pair.tags));

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
    else if (!previous && platform === "ios" && !pairs.some((pair) => pair.target === "ios")) continue;
    else if (!previous) problems.push(`${id} is new, so it can't be ${platform} backlog: the base has no surfaces, journeys or SPEC text for it. Make it required with a shared test.`);
  }
}
const changed = [...after.cases.values()].filter((entry) => {
  const previous = before.cases.get(entry.id);
  return (previous !== undefined && !sameEntry(previous, entry)) || testedChanges.has(entry.id);
});
for (const entry of changed) if (entry.web === "backlog") problems.push(`${entry.id} changed but is still web backlog. Make it required on the web with its shared test in this pull request.`);
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
  ...(problems.length ? ["", "### Problems", "", ...problems.map((problem) => `- ${problem}`)] : []),
  "",
].join("\n");
if (process.env["GITHUB_STEP_SUMMARY"]) await appendFile(process.env["GITHUB_STEP_SUMMARY"], summary);
process.stdout.write(summary);
process.exitCode = problems.length ? 1 : 0;
