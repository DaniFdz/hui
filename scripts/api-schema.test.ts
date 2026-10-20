import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "vitest";
import { Type } from "typebox";
import { apiAreas, buildApiSchema } from "../server/api/index.ts";
import { emittedSchema, generateBrowserTypes, schemaType } from "./api-schema.ts";

const root = new URL("../", import.meta.url);
const regenerate = "run `npm run api:schema`";

test("the published schema and browser payload types are current", async () => {
  const committed = await readFile(new URL("docs/api.schema.json", root), "utf8");
  assert.equal(await emittedSchema(), committed, regenerate);
  const generated = generateBrowserTypes(JSON.parse(committed));
  const directory = new URL("src/api/schema/", root);
  assert.deepEqual((await readdir(directory)).sort(), Object.keys(generated).map((area) => `${area}.ts`).sort(), regenerate);
  for (const [area, expected] of Object.entries(generated)) assert.equal(await readFile(new URL(`${area}.ts`, directory), "utf8"), expected, regenerate);
  const modules = (await readdir(new URL("server/api/", root))).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "index.ts");
  assert.deepEqual(modules.sort(), Object.keys(apiAreas).map((area) => `${area}.ts`).sort(), "register each API area in server/api/index.ts");
});

test("the converter handles every supported schema keyword and cross-area references", () => {
  const fixture = {
    $id: "Fixture",
    description: "Not emitted into TypeScript",
    type: "object",
    properties: {
      label: { type: "string" },
      size: { type: "number" },
      count: { type: "integer" },
      enabled: { type: "boolean" },
      tag: { const: "fixed", type: "string" },
      mode: { enum: ["a", "b", null] },
      values: { type: "array", items: { anyOf: [{ type: "null" }, { $ref: "#/$defs/Other" }] } },
      labels: Type.Record(Type.String(), Type.Boolean()),
      numbers: Type.Record(Type.Number(), Type.String()),
      integers: Type.Record(Type.Integer(), Type.String()),
      open: { type: "object", additionalProperties: true },
      extra: { type: "object", additionalProperties: { type: "boolean" } },
    },
    required: ["label", "values"],
    additionalProperties: false,
  };
  const generated = generateBrowserTypes({
    $defs: { Fixture: fixture, Other: { type: "boolean" } },
    "x-hui-areas": { fixture: ["Fixture"], other: ["Other"] },
  });
  assert.equal(generated["fixture"], '/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */\nimport type { Other } from "./other.ts";\n\nexport type Fixture = { "label": string; "size"?: number; "count"?: number; "enabled"?: boolean; "tag"?: "fixed"; "mode"?: "a" | "b" | null; "values": Array<(null) | (Other)>; "labels"?: Record<string, boolean>; "numbers"?: Record<number, string>; "integers"?: Record<number, string>; "open"?: Record<string, unknown>; "extra"?: Record<string, boolean>; };\n');
  assert.equal(generated["other"], "/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */\n\nexport type Other = boolean;\n");
  assert.throws(() => schemaType({ type: "object", properties: { name: { type: "string", minLength: 1 } } }), /Unsupported keyword #\/properties\/name\/minLength/u);
  assert.throws(() => schemaType({ type: "object", patternProperties: { "^prefix": { type: "string" } } }), /Unsupported pattern at #\/patternProperties/u);
  assert.throws(() => generateBrowserTypes({ $defs: { Missing: { $ref: "#/$defs/Absent" } }, "x-hui-areas": { test: ["Missing"] } }), /Unknown API schema reference: Absent/u);
});

test("schema coverage only has the areas explicitly left for the remaining migration", async () => {
  const gaps = [];
  for (const name of await readdir(new URL("server/routes/", root))) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = await readFile(new URL(`server/routes/${name}`, root), "utf8");
    if (!/export\s+(?:const\s+routeSchemas|\{[^}]*\brouteSchemas\b)/u.test(source)) gaps.push(`module: ${name.slice(0, -3)}`);
  }
  const documentation = await readFile(new URL("docs/api.md", root), "utf8");
  const documented = new Set([...documentation.matchAll(/^### `(\w+ \/__hui\/[^`]+)`/gmu)].map((match) => match[1]!.split("?")[0]!));
  const published = new Set(buildApiSchema("test")["x-hui-routes"].map((route) => `${route.method} ${route.path}`));
  for (const route of documented) if (!published.has(route)) gaps.push(`missing: ${route}`);
  for (const route of published) if (!documented.has(route)) gaps.push(`undocumented: ${route}`);
  assert.deepEqual(gaps.sort(), ALLOWED, "add routeSchemas and document each route; remove fixed entries from ALLOWED");
});

const ALLOWED = [
  "missing: GET /__hui/diagnostics/export",
  "missing: GET /__hui/directories",
  "missing: GET /__hui/git-checkout",
  "missing: GET /__hui/health",
  "missing: GET /__hui/local-paths",
  "missing: GET /__hui/observability",
  "missing: GET /__hui/sessions/:id/commands",
  "missing: GET /__hui/sessions/:id/models",
  "missing: GET /__hui/sessions/events",
  "missing: POST /__hui/diagnostics/ui-errors",
  "missing: POST /__hui/sessions/:id/btw",
  "missing: POST /__hui/sessions/:id/model",
  "module: attachments",
  "module: diagnostics",
  "module: local-paths",
  "module: themes",
  "undocumented: GET /__hui/power",
  "undocumented: PUT /__hui/power",
];
