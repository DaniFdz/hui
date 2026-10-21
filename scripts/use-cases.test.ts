/**
 * Guards the use-case catalogue in e2e/catalogue/: every entry is well formed and cites real SPEC text, journeys and
 * surfaces; every surface the code defines is claimed by a use case or set aside with a reason; every journey has a
 * class; every Part 2 section of SPEC.md is cited or exempted; and `backlog` appears only where the baseline says so.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { AREAS, type Status, type UseCase } from "../e2e/catalogue/types.ts";
import { JOURNEYS } from "../e2e/catalogue/journeys.ts";
import { NOT_UI, SPEC_EXEMPT } from "../e2e/catalogue/not-ui.ts";
import { browserSurfaces } from "../e2e/catalogue/surfaces-src.ts";
import { gatewaySurfaces } from "../e2e/catalogue/surfaces-server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFile(join(root, path), "utf8");

function githubAnchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const found = new Set<string>();
  for (const [, heading] of markdown.matchAll(/^#{1,6} (.+)$/gmu)) {
    const slug = heading!.trim().replaceAll("`", "").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    found.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return found;
}

const useCases: (UseCase & { area: string })[] = (await Promise.all(AREAS.map(async (area) => {
  const cases = (await import(`../e2e/catalogue/${area.toLowerCase()}.ts`)).default as UseCase[];
  return cases.map((entry) => ({ ...entry, area }));
}))).flat();
const surfaces = new Set([...await browserSurfaces(), ...await gatewaySurfaces()]);
const baseline = JSON.parse(await read("e2e/catalogue/baseline.json")) as { backlog: { web: string[]; ios: string[] } };
const documents = { "SPEC.md": githubAnchors(await read("SPEC.md")), "docs/api.md": githubAnchors(await read("docs/api.md")) };
const journeyFiles = (await readdir(join(root, "e2e"))).filter((name) => name.endsWith(".browser.md")).map((name) => name.slice(0, -".browser.md".length));

const cites = (reference: string) => {
  const [document, anchor] = reference.split("#") as [keyof typeof documents, string | undefined];
  return anchor !== undefined && documents[document]?.has(anchor) === true;
};
const statusProblems = (entry: UseCase, platform: "web" | "ios"): string[] => {
  const status: Status = entry[platform];
  if (status === "backlog") return baseline.backlog[platform].includes(entry.id) ? [] : [`${entry.id}: ${platform} is backlog but not in baseline.json`];
  if (status === "required") return [`${entry.id}: ${platform} is required, but no shared test can prove it before the e2e suite exists`];
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
