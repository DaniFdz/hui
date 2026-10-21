import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { Type } from "typebox";
import { apiAreas, buildApiSchema } from "../server/api/index.ts";
import { emittedSchema, generateBrowserTypes, generateSwiftTypes, schemaType } from "./api-schema.ts";

const root = new URL("../", import.meta.url);
const regenerate = "run `npm run api:schema`";

test("the published schema and the browser and Swift payload types are current", async () => {
  const committed = await readFile(new URL("docs/api.schema.json", root), "utf8");
  assert.equal(await emittedSchema(), committed, regenerate);
  const generated = generateBrowserTypes(JSON.parse(committed));
  const directory = new URL("src/api/schema/", root);
  assert.deepEqual((await readdir(directory)).sort(), Object.keys(generated).map((area) => `${area}.ts`).sort(), regenerate);
  for (const [area, expected] of Object.entries(generated)) assert.equal(await readFile(new URL(`${area}.ts`, directory), "utf8"), expected, regenerate);
  const swift = generateSwiftTypes(JSON.parse(committed));
  const swiftDirectory = new URL("ios/HUI/Gateway/Schema/", root);
  assert.deepEqual((await readdir(swiftDirectory)).sort(), Object.keys(swift).sort(), regenerate);
  for (const [file, expected] of Object.entries(swift)) assert.equal(await readFile(new URL(file, swiftDirectory), "utf8"), expected, regenerate);
  const modules = (await readdir(new URL("server/api/", root))).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "index.ts");
  assert.deepEqual(modules.sort(), Object.keys(apiAreas).map((area) => `${area}.ts`).sort(), "register each API area in server/api/index.ts");
});

test.for([undefined, "src/api/schema/obsolete.ts", "ios/HUI/Gateway/Schema/ObsoletePayloads.swift"])("the schema CLI publishes every output or leaves them untouched when stale types exist (stale: %s)", async (stale, t) => {
  const temporary = await mkdtemp(join(tmpdir(), "hui-api-schema-"));
  t.onTestFinished(() => rm(temporary, { recursive: true, force: true }));
  for (const directory of ["scripts", "server/api", "docs", "src/api/schema", "ios/HUI/Gateway/Schema"]) await mkdir(join(temporary, directory), { recursive: true });
  await cp(new URL("api-schema.ts", import.meta.url), join(temporary, "scripts/api-schema.ts"));
  const schema = { $defs: { Fixture: { type: "string" } }, "x-hui-areas": { fixture: ["Fixture"] } };
  await writeFile(join(temporary, "package.json"), JSON.stringify({ type: "module", version: "test" }));
  await writeFile(join(temporary, "server/api/schema.json"), JSON.stringify(schema));
  await writeFile(join(temporary, "server/api/index.ts"), 'import schema from "./schema.json" with { type: "json" };\nexport const buildApiSchema = () => schema;\n');
  const document = join(temporary, "docs/api.schema.json");
  const types = join(temporary, "src/api/schema/fixture.ts");
  const swift = join(temporary, "ios/HUI/Gateway/Schema/FixturePayloads.swift");
  await writeFile(document, "previous schema\n");
  await writeFile(types, "previous types\n");
  await writeFile(swift, "previous Swift\n");
  if (stale) await writeFile(join(temporary, stale), "obsolete types\n");
  const run = () => promisify(execFile)(process.execPath, [join(temporary, "scripts/api-schema.ts")], { cwd: temporary });
  if (stale) {
    await assert.rejects(run, new RegExp(`Remove obsolete generated API types: ${basename(stale)}`, "u"));
    assert.equal(await readFile(document, "utf8"), "previous schema\n");
    assert.equal(await readFile(types, "utf8"), "previous types\n");
    assert.equal(await readFile(swift, "utf8"), "previous Swift\n");
    assert.equal(await readFile(join(temporary, stale), "utf8"), "obsolete types\n");
  } else {
    await run();
    assert.equal(await readFile(document, "utf8"), `${JSON.stringify(schema, null, 2)}\n`);
    assert.equal(await readFile(types, "utf8"), "/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */\n\nexport type Fixture = string;\n");
    assert.equal(await readFile(swift, "utf8"), "// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.\n\nextension API {\n    typealias Fixture = String\n}\n");
  }
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

test("the Swift emitter maps objects, literal unions and tagged unions, keeps unknown values and falls back to JSONValue", () => {
  const generated = generateSwiftTypes({
    $defs: {
      Fixture: {
        type: "object",
        required: ["label", "kind", "where", "x-y", "stop", "items", "data"],
        properties: {
          label: { type: "string" },
          count: { type: "integer" },
          size: { type: "number" },
          kind: { type: "string", const: "fixed" },
          flag: { type: "boolean", const: true },
          where: { type: "boolean" },
          "x-y": { type: "string" },
          mode: { anyOf: [{ const: "a" }, { const: "in-progress" }] },
          stop: { type: "object", required: ["other"], properties: { other: { anyOf: [{ $ref: "#/$defs/Other" }, { type: "null" }] } } },
          items: { type: "array", items: { type: "object", properties: { open: { type: "object" }, any: {} } } },
          others: { type: "object", patternProperties: { "^.*$": { $ref: "#/$defs/Other" } } },
          data: { type: "object", required: ["args"], properties: { args: {} } },
        },
      },
      Other: { enum: ["default", "", "none"] },
      Scale: { anyOf: [{ const: 90 }, { const: 100 }] },
      Event: {
        anyOf: [
          { type: "object", required: ["type"], properties: { type: { const: "start" }, at: { type: "number" } } },
          { $ref: "#/$defs/Stop" },
          { type: "object", required: ["type"], properties: { type: { enum: ["a", "b"] } } },
        ],
      },
      Stop: { type: "object", required: ["type"], properties: { type: { const: "stop" } } },
      Ready: {
        anyOf: [
          { type: "object", required: ["ready"], properties: { ready: { const: true } } },
          { type: "object", required: ["ready", "reason"], properties: { ready: { const: false }, reason: { type: "string" } } },
        ],
      },
      Either: { anyOf: [{ type: "string" }, { $ref: "#/$defs/Stop" }] },
    },
    "x-hui-areas": { fixture: ["Fixture", "Other", "Scale", "Event", "Stop", "Ready", "Either"] },
  });
  assert.deepEqual(Object.keys(generated), ["FixturePayloads.swift"]);
  assert.equal(generated["FixturePayloads.swift"], `// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct Fixture: Codable, Hashable, Sendable {
        var label: String
        var count: Int?
        var size: Double?
        var kind: String = "fixed"
        var flag: Bool?
        var \`where\`: Bool
        var xY: String
        var mode: Mode?
        var stop: StopValue
        var items: [ItemsItem]
        var others: [String: Other]?
        var data: DataValue

        enum CodingKeys: String, CodingKey {
            case label
            case count
            case size
            case kind
            case flag
            case \`where\`
            case xY = "x-y"
            case mode
            case stop
            case items
            case others
            case data
        }

        enum Mode: RawRepresentable, Codable, Hashable, Sendable {
            case a
            case inProgress
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "a": self = .a
                case "in-progress": self = .inProgress
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .a: "a"
                case .inProgress: "in-progress"
                case .unrecognized(let value): value
                }
            }
        }

        struct StopValue: Codable, Hashable, Sendable {
            var other: Other?

            enum CodingKeys: String, CodingKey {
                case other
            }

            func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(other, forKey: .other)
            }
        }

        struct ItemsItem: Codable, Hashable, Sendable {
            var \`open\`: [String: JSONValue]?
            var any: JSONValue?
        }

        struct DataValue: Codable, Hashable, Sendable {
            var args: JSONValue?

            enum CodingKeys: String, CodingKey {
                case args
            }

            func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(args, forKey: .args)
            }
        }
    }

    enum Other: RawRepresentable, Codable, Hashable, Sendable {
        case \`default\`
        case empty
        case noneValue
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "default": self = .\`default\`
            case "": self = .empty
            case "none": self = .noneValue
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .\`default\`: "default"
            case .empty: ""
            case .noneValue: "none"
            case .unrecognized(let value): value
            }
        }
    }

    enum Scale: RawRepresentable, Codable, Hashable, Sendable {
        case _90
        case _100
        case unrecognized(Double)

        init(rawValue: Double) {
            switch rawValue {
            case 90: self = ._90
            case 100: self = ._100
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: Double {
            switch self {
            case ._90: 90
            case ._100: 100
            case .unrecognized(let value): value
            }
        }
    }

    enum Event: Codable, Hashable, Sendable {
        case start(Start)
        case stop(Stop)
        case aOrB(AOrB)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case type
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .type) {
            case "start": self = try .start(Start(from: decoder))
            case "stop": self = try .stop(Stop(from: decoder))
            case "a", "b": self = try .aOrB(AOrB(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .start(let value): try value.encode(to: encoder)
            case .stop(let value): try value.encode(to: encoder)
            case .aOrB(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Start: Codable, Hashable, Sendable {
            var type: String = "start"
            var at: Double?
        }

        struct AOrB: Codable, Hashable, Sendable {
            var type: TypeValue

            enum TypeValue: RawRepresentable, Codable, Hashable, Sendable {
                case a
                case b
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "a": self = .a
                    case "b": self = .b
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .a: "a"
                    case .b: "b"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    struct Stop: Codable, Hashable, Sendable {
        var type: String = "stop"
    }

    enum Ready: Codable, Hashable, Sendable {
        case ready(ReadyValue)
        case notReady(NotReady)

        private enum Discriminator: String, CodingKey {
            case ready
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(Bool.self, forKey: .ready) {
            case true: self = try .ready(ReadyValue(from: decoder))
            case false: self = try .notReady(NotReady(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .ready(let value): try value.encode(to: encoder)
            case .notReady(let value): try value.encode(to: encoder)
            }
        }

        struct ReadyValue: Codable, Hashable, Sendable {
            var ready: Bool = true
        }

        struct NotReady: Codable, Hashable, Sendable {
            var ready: Bool = false
            var reason: String
        }
    }

    typealias Either = JSONValue
}
`);
  const swift = (schema: unknown) => generateSwiftTypes({ $defs: { Test: schema }, "x-hui-areas": { test: ["Test"] } });
  assert.throws(() => swift({ type: "string", minLength: 1 }), /Unsupported keyword #\/\$defs\/Test\/minLength/u);
  assert.throws(() => swift({ type: "object", patternProperties: { "^prefix": { type: "string" } } }), /Unsupported pattern at #\/\$defs\/Test\/patternProperties/u);
  assert.throws(() => swift({ type: "object", properties: { id: { type: "string" } }, patternProperties: { "^.*$": { type: "string" } } }), /Unsupported open keys beside properties at #\/\$defs\/Test/u);
  assert.throws(() => swift({ $ref: "#/$defs/Absent" }), /Unknown API schema reference: Absent/u);
});

test("every JSON route module and documented route has a published schema", async () => {
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
  assert.deepEqual(gaps.sort(), [], "add routeSchemas and a docs/api.md heading for every JSON route");
});
