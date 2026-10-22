/**
 * Guards the use-case catalogue in e2e/catalogue/ and the shared e2e tests in e2e/tests/: every entry is well formed
 * and cites real SPEC text, journeys and surfaces; every surface the code defines is claimed by a use case or set
 * aside with a reason; every journey has a class; every Part 2 section of SPEC.md is cited or exempted; `backlog`
 * appears only where the baseline says so; a required use case has a shared test that runs on its platform; and the
 * shared tests stay deterministic and portable to iOS.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { list } from "e2e/runner";
import { AREAS, type Status, type UseCase } from "../e2e/catalogue/types.ts";
import { githubAnchors } from "../e2e/catalogue/anchors.ts";
import { JOURNEYS } from "../e2e/catalogue/journeys.ts";
import { NOT_UI, SPEC_EXEMPT } from "../e2e/catalogue/not-ui.ts";
import { browserSurfaces } from "../e2e/catalogue/surfaces-src.ts";
import { gatewaySurfaces } from "../e2e/catalogue/surfaces-server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFile(join(root, path), "utf8");

const useCases: (UseCase & { area: string })[] = (await Promise.all(AREAS.map(async (area) => {
  const cases = (await import(`../e2e/catalogue/${area.toLowerCase()}.ts`)).default as UseCase[];
  return cases.map((entry) => ({ ...entry, area }));
}))).flat();
const surfaces = new Set([...await browserSurfaces(), ...await gatewaySurfaces()]);
const baseline = JSON.parse(await read("e2e/catalogue/baseline.json")) as { backlog: { web: string[]; ios: string[] }; unexercisedLabels: string[] };
const documents = { "SPEC.md": githubAnchors(await read("SPEC.md")), "docs/api.md": githubAnchors(await read("docs/api.md")) };
const journeyFiles = (await readdir(join(root, "e2e"))).filter((name) => name.endsWith(".browser.md")).map((name) => name.slice(0, -".browser.md".length));
const byId = new Map(useCases.map((entry) => [entry.id, entry]));
const ID_TAG = /^[A-Z]+-\d{3}$/u;
const { pairs } = await list({ cwd: root });
const sourcesIn = async (directory: string, keep: (name: string) => boolean) => new Map(await Promise.all(
  (await readdir(join(root, directory), { recursive: true })).filter(keep).map(async (name) => [`${directory}/${name}`, await read(`${directory}/${name}`)] as const),
));
const testSources = await sourcesIn("e2e/tests", (name) => name.endsWith(".ts"));
const fixtureSource = await read("e2e/fixtures/hui.ts");
const appSources = [...(await sourcesIn("src", (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))).values()].join("\n");
const iosSources = [...(await sourcesIn("ios/HUI", (name) => name.endsWith(".swift"))).values()].join("\n");
const withoutCommentsAndStrings = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(["'`])(?:\\.|(?!\1)[^\\])*\1|\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/gu, (match) => (match.startsWith("/") ? "" : '""'));

const cites = (reference: string) => {
  const [document, anchor] = reference.split("#") as [keyof typeof documents, string | undefined];
  return anchor !== undefined && documents[document]?.has(anchor) === true;
};
const statusProblems = (entry: UseCase, platform: "web" | "ios"): string[] => {
  const status: Status = entry[platform];
  if (status === "backlog") return baseline.backlog[platform].includes(entry.id) ? [] : [`${entry.id}: ${platform} is backlog but not in baseline.json`];
  if (status === "required") return [];
  return status.excluded.trim() && status.decision.startsWith("SPEC.md#") && cites(status.decision) ? [] : [`${entry.id}: ${platform} exclusion needs a reason and an existing SPEC.md anchor`];
};

test("every use case is well formed and cites real SPEC text, journeys and surfaces", () => {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of useCases) {
    if (!new RegExp(`^${entry.area}-\\d{3}$`, "u").test(entry.id)) problems.push(`${entry.id}: the ID must be ${entry.area}-NNN`);
    if (ids.has(entry.id)) problems.push(`${entry.id}: the ID is used twice`);
    ids.add(entry.id);
    if (!entry.title.trim() || !entry.behaviour.trim()) problems.push(`${entry.id}: title and behaviour are required`);
    if (entry.spec.length === 0) problems.push(`${entry.id}: cite the SPEC.md or docs/api.md section that defines it`);
    for (const reference of entry.spec) if (!cites(reference)) problems.push(`${entry.id}: ${reference} is not a heading of SPEC.md or docs/api.md`);
    for (const surface of entry.surfaces) if (!surfaces.has(surface)) problems.push(`${entry.id}: ${surface} is not a collected surface`);
    for (const journey of entry.journeys ?? []) if (!journeyFiles.includes(journey)) problems.push(`${entry.id}: e2e/${journey}.browser.md does not exist`);
    problems.push(...statusProblems(entry, "web"), ...statusProblems(entry, "ios"));
  }
  for (const platform of ["web", "ios"] as const) {
    for (const id of baseline.backlog[platform]) {
      if (!useCases.some((entry) => entry.id === id && entry[platform] === "backlog")) problems.push(`baseline.json lists ${id} as ${platform} backlog, but the catalogue doesn't`);
    }
  }
  assert.deepEqual(problems, []);
});

test("a use case, or not-ui.ts with a reason, claims every surface the code defines", () => {
  const claimed = new Set(useCases.flatMap((entry) => entry.surfaces));
  const unclaimed = [...surfaces].filter((surface) => !claimed.has(surface) && !NOT_UI[surface]?.trim());
  const stale = Object.keys(NOT_UI).filter((surface) => !surfaces.has(surface) || claimed.has(surface));
  assert.deepEqual({ unclaimed, stale }, { unclaimed: [], stale: [] });
});

test("every journey has a class, and every journey to automate is cited by a use case", () => {
  const unclassified = journeyFiles.filter((journey) => !JOURNEYS[journey]);
  const stale = Object.keys(JOURNEYS).filter((journey) => !journeyFiles.includes(journey));
  const cited = new Set(useCases.flatMap((entry) => entry.journeys ?? []));
  const uncited = Object.entries(JOURNEYS)
    .filter(([journey, { kind }]) => (kind === "automate" || kind.startsWith("world:")) && !cited.has(journey))
    .map(([journey]) => journey);
  assert.deepEqual({ unclassified, stale, uncited }, { unclassified: [], stale: [], uncited: [] });
});

test("a use case cites every Part 2 section and the Behaviour heading of SPEC.md, or not-ui.ts exempts it", async () => {
  const spec = await read("SPEC.md");
  const part2 = spec.indexOf("\n# Part 2");
  assert.ok(part2 >= 0, "SPEC.md has no Part 2 heading");
  const sections = ["behaviour", ...[...spec.slice(part2).matchAll(/^## (.+)$/gmu)].map(([, heading]) => [...githubAnchors(`## ${heading}`)][0]!)];
  const cited = new Set(useCases.flatMap((entry) => entry.spec).filter((reference) => reference.startsWith("SPEC.md#")).map((reference) => reference.slice("SPEC.md#".length)));
  const uncovered = sections.filter((section) => !cited.has(section) && !SPEC_EXEMPT[section]?.trim());
  const stale = Object.keys(SPEC_EXEMPT).filter((section) => !sections.includes(section) || cited.has(section));
  assert.deepEqual({ uncovered, stale }, { uncovered: [], stale: [] });
});

test("a use case required on a platform has a shared test that runs there", () => {
  const unproved = useCases.flatMap((entry) => (["web", "ios"] as const)
    .filter((platform) => entry[platform] === "required")
    .filter((platform) => !pairs.some((pair) => pair.target === platform && pair.disposition === "run" && pair.tags.includes(entry.id)))
    .map((platform) => `${entry.id} on ${platform}`));
  assert.deepEqual(unproved, []);
});

test("every shared test names known use cases, and a skipped one covers only use cases that are not required there", () => {
  const problems = pairs.flatMap((pair) => {
    const ids = pair.tags.filter((tag) => ID_TAG.test(tag));
    return [
      ...(ids.length === 0 ? [`${pair.file} "${pair.title}" has no use-case ID tag`] : []),
      ...ids.filter((id) => !byId.has(id)).map((id) => `${pair.file} tags ${id}, which is not in the catalogue`),
      ...(pair.disposition === "skip" ? ids.filter((id) => byId.get(id)?.[pair.target as "web" | "ios"] === "required").map((id) => `${pair.file} skips ${id} on ${pair.target}, where it is required`) : []),
    ];
  });
  assert.deepEqual(problems, []);
});

test("shared tests use no agent steps, retries, skips, platform reads or sleeps, and the fixture doesn't sleep", () => {
  const sleep: [RegExp, string] = [/\b(?:setTimeout|setInterval|waitForTimeout|sleep|delay)\s*\(/u, "a sleep"];
  const forbidden: [RegExp, string][] = [
    [/\bagent\b/u, "an agent step"],
    [/\bretries\b/u, "retries"],
    [/\.skip\(/u, "test.skip("],
    [/\b(?:platform|device|browser)\b/u, "a platform, device or browser read, which only e2e/fixtures/hui.ts may do"],
    sleep,
  ];
  const problems = [...testSources, ["e2e/fixtures/hui.ts", fixtureSource] as const].flatMap(([file, source]) =>
    (file === "e2e/fixtures/hui.ts" ? [sleep] : forbidden).filter(([pattern]) => pattern.test(withoutCommentsAndStrings(source))).map(([, what]) => `${file} uses ${what}`));
  assert.deepEqual(problems, []);
});

test("shared tests find controls by roles iOS has too, and by test ids the web app sets and, when they run on iOS, the app too", () => {
  const portable = new Set(["button", "textbox", "switch", "tab", "listitem"]);
  const webOnly = (file: string) => pairs.filter((pair) => pair.file === file).flatMap((pair) => pair.tags.filter((tag) => ID_TAG.test(tag)))
    .every((id) => typeof byId.get(id)?.ios === "object");
  const problems = [...testSources].flatMap(([file, source]) => {
    const testIds = [...source.matchAll(/getByTestId\(\s*["'`]([^"'`]+)["'`]/gu)].map(([, id]) => id!);
    const onIos = pairs.some((pair) => pair.file === file && pair.target === "ios" && pair.disposition === "run");
    return [
      ...[...source.matchAll(/getByRole\(\s*["'`]([a-z]+)["'`]/gu)].map(([, role]) => role!)
        .filter((role) => !portable.has(role) && !webOnly(file)).map((role) => `${file} finds a ${role}, which iOS doesn't expose`),
      ...testIds.filter((id) => !appSources.includes(`data-testid="${id}"`)).map((id) => `${file} finds test id ${id}, which no data-testid in src/ sets`),
      ...testIds.filter((id) => onIos && !iosSources.includes(`.accessibilityIdentifier("${id}")`))
        .map((id) => `${file} runs on iOS and finds test id ${id}, which no .accessibilityIdentifier under ios/HUI sets`),
    ];
  });
  assert.deepEqual(problems, []);
});

test("every static accessible name in src/ appears in a shared test or in the baseline's unexercised labels", () => {
  const tests = [...testSources.values()].join("\n");
  const labels = new Set([...appSources.matchAll(/aria-label="([^"$]+)"/gu)].map(([, label]) => label!));
  const unexercised = [...labels].filter((label) => !tests.includes(`"${label}"`) && !tests.includes(`'${label}'`));
  const missing = unexercised.filter((label) => !baseline.unexercisedLabels.includes(label));
  const stale = baseline.unexercisedLabels.filter((label) => !unexercised.includes(label));
  assert.deepEqual({ missing, stale }, { missing: [], stale: [] });
});
