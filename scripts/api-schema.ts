/**
 * Publishes the server's API schema and generates its clients' payload types from the published JSON: TypeScript for
 * the browser (`src/api/schema/`) and Swift for the iOS app (`ios/HUI/Gateway/Schema/`, inside the `API` namespace that
 * `ios/HUI/Gateway/API.swift` declares). Both accept the same keyword subset and throw on anything else. Swift maps an
 * object to a struct, a union of literals to an enum, a union of objects told apart by one literal property to an enum
 * with a case per member, a union with null to an optional, and any other union or open value to `JSONValue`. Its
 * enums decode a value they don't know as `.unrecognized`, so an app keeps working against a newer gateway.
 */
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildApiSchema } from "../server/api/index.ts";

const root = new URL("../", import.meta.url);
const keywords = new Set(["type", "properties", "required", "additionalProperties", "patternProperties", "items", "anyOf", "const", "enum", "$ref", "$id", "description"]);
const header = "/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */\n";

type Literal = string | number | boolean | null;

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected an object at ${path}`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array at ${path}`);
  return value;
}

function literalValue(value: unknown, path: string): Literal {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error(`Unsupported literal at ${path}`);
}

function literal(value: unknown, path: string): string {
  return JSON.stringify(literalValue(value, path));
}

function node(value: unknown, path: string): Record<string, unknown> {
  const schema = object(value, path);
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(`Unsupported keyword ${path}/${key}`);
  return schema;
}

function unconstrained(schema: Record<string, unknown>): boolean {
  return Object.keys(schema).every((key) => key === "$id" || key === "description");
}

function referenceName(schema: Record<string, unknown>, path: string): string | undefined {
  if (typeof schema["$ref"] !== "string") return undefined;
  const match = /^#\/\$defs\/([A-Za-z_$][\w$]*)$/u.exec(schema["$ref"]);
  if (!match?.[1]) throw new Error(`Unsupported reference at ${path}/$ref`);
  return match[1];
}

export function schemaType(value: unknown, path = "#", reference: (name: string) => string = (name) => name): string {
  const schema = node(value, path);
  const name = referenceName(schema, path);
  if (name !== undefined) return reference(name);
  if ("const" in schema) return literal(schema["const"], `${path}/const`);
  if ("enum" in schema) return list(schema["enum"], `${path}/enum`).map((item) => literal(item, `${path}/enum`)).join(" | ") || "never";
  if ("anyOf" in schema) return list(schema["anyOf"], `${path}/anyOf`).map((item, index) => `(${schemaType(item, `${path}/anyOf/${index}`, reference)})`).join(" | ") || "never";
  switch (schema["type"]) {
    case "string": return "string";
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": return `Array<${schemaType(schema["items"], `${path}/items`, reference)}>`;
    case "object": {
      const properties = object(schema["properties"] ?? {}, `${path}/properties`);
      const required = list(schema["required"] ?? [], `${path}/required`);
      const fields = Object.entries(properties).map(([name, child]) => `${JSON.stringify(name)}${required.includes(name) ? "" : "?"}: ${schemaType(child, `${path}/properties/${name}`, reference)};`);
      const parts = fields.length > 0 ? [`{ ${fields.join(" ")} }`] : [];
      for (const [pattern, child] of Object.entries(object(schema["patternProperties"] ?? {}, `${path}/patternProperties`))) {
        const key = pattern === "^.*$" ? "string" : ["^-?(?:0|[1-9][0-9]*)$", "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$"].includes(pattern) ? "number" : undefined;
        if (!key) throw new Error(`Unsupported pattern at ${path}/patternProperties/${pattern}`);
        parts.push(`Record<${key}, ${schemaType(child, `${path}/patternProperties/${pattern}`, reference)}>`);
      }
      const additional = schema["additionalProperties"];
      if (additional === true) parts.push("Record<string, unknown>");
      else if (additional !== undefined && additional !== false) parts.push(`Record<string, ${schemaType(additional, `${path}/additionalProperties`, reference)}>`);
      return parts.join(" & ") || "Record<string, unknown>";
    }
    case undefined:
      if (unconstrained(schema)) return "unknown";
      throw new Error(`Missing schema type at ${path}`);
    default: throw new Error(`Unsupported type at ${path}/type`);
  }
}

function ownership(document: unknown): { definitions: Record<string, unknown>; areas: string[]; owners: Map<string, string> } {
  const schema = object(document, "#");
  const definitions = object(schema["$defs"], "#/$defs");
  const areas = object(schema["x-hui-areas"], "#/x-hui-areas");
  const owners = new Map<string, string>();
  for (const [area, names] of Object.entries(areas)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(area)) throw new Error(`Invalid API area: ${area}`);
    for (const name of list(names, `#/x-hui-areas/${area}`)) {
      if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/u.test(name) || !Object.hasOwn(definitions, name)) throw new Error(`Invalid API schema name in ${area}: ${String(name)}`);
      if (owners.has(name)) throw new Error(`Duplicate API schema owner: ${name}`);
      owners.set(name, area);
    }
  }
  if (Object.keys(definitions).some((name) => !owners.has(name))) throw new Error("Every API schema must have an area");
  return { definitions, areas: Object.keys(areas).sort(), owners };
}

export function generateBrowserTypes(document: unknown): Record<string, string> {
  const { definitions, areas, owners } = ownership(document);
  return Object.fromEntries(areas.map((area) => {
    const imports = new Map<string, Set<string>>();
    const reference = (name: string) => {
      const owner = owners.get(name);
      if (!owner) throw new Error(`Unknown API schema reference: ${name}`);
      if (owner !== area) {
        if (!imports.has(owner)) imports.set(owner, new Set());
        imports.get(owner)!.add(name);
      }
      return name;
    };
    const types = [...owners].filter(([, owner]) => owner === area).map(([name]) => `export type ${name} = ${schemaType(definitions[name], `#/$defs/${name}`, reference)};\n`);
    const dependencies = [...imports].sort(([a], [b]) => a.localeCompare(b)).map(([owner, names]) => `import type { ${[...names].sort().join(", ")} } from "./${owner}.ts";\n`).join("");
    return [area, `${header}${dependencies}\n${types.join("\n")}`];
  }));
}

const SWIFT_KEYWORDS = new Set(["Any", "Protocol", "Self", "Type", "as", "associatedtype", "await", "break", "case", "catch", "class", "continue", "default", "defer", "deinit", "do", "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func", "guard", "if", "import", "in", "init", "inout", "internal", "is", "let", "nil", "open", "operator", "precedencegroup", "private", "protocol", "public", "repeat", "rethrows", "return", "self", "Self", "static", "struct", "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while"]);
const SWIFT_TAKEN_NAMES = ["Any", "Bool", "Codable", "CodingKey", "CodingKeys", "Data", "Date", "Decoder", "Discriminator", "Double", "Encoder", "Error", "Hashable", "Int", "JSONValue", "Protocol", "Result", "Self", "Sendable", "String", "Task", "Type", "URL", "UUID"];
const SWIFT_AWKWARD_CASES = new Set(["Protocol", "Self", "Type", "init", "none", "self", "unrecognized"]);

function camel(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const name = words.map((word, index) => index > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word === word.toUpperCase() ? word.toLowerCase() : word.charAt(0).toLowerCase() + word.slice(1)).join("") || "empty";
  return /^[0-9]/u.test(name) ? `_${name}` : name;
}

function pascal(text: string): string {
  const name = camel(text);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function escaped(name: string): string {
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function swiftCase(name: string): string {
  return escaped(SWIFT_AWKWARD_CASES.has(name) ? `${name}Value` : name);
}

function swiftLiteral(value: Literal): string {
  if (typeof value !== "string") return String(value);
  return `"${[...value].map((character) => character === "\\" || character === '"' ? `\\${character}` : character < " " ? `\\u{${character.charCodeAt(0).toString(16)}}` : character).join("")}"`;
}

function concat<T>(lists: (T[] | undefined)[]): T[] | undefined {
  return lists.every((items): items is T[] => items !== undefined) ? lists.flat() : undefined;
}

function indent(lines: string[]): string[] {
  return lines.map((line) => (line === "" ? line : `    ${line}`));
}

type SwiftKind =
  | { kind: "enum"; values: Literal[]; raw: "String" | "Double" }
  | { kind: "union"; key: string; cases: { member: unknown; values: Literal[] }[] }
  | { kind: "struct" };

export function generateSwiftTypes(document: unknown): Record<string, string> {
  const { definitions, areas, owners } = ownership(document);
  const reserved = new Set([...owners.keys(), ...SWIFT_TAKEN_NAMES]);
  const defined = (name: string) => {
    if (!owners.has(name)) throw new Error(`Unknown API schema reference: ${name}`);
    return name;
  };
  const resolve = (value: unknown, path: string): [Record<string, unknown>, string] => {
    const schema = node(value, path);
    const name = referenceName(schema, path);
    return name === undefined ? [schema, path] : resolve(definitions[defined(name)], `#/$defs/${name}`);
  };
  const literals = (value: unknown, path: string): Literal[] | undefined => {
    const [schema, at] = resolve(value, path);
    if ("const" in schema) return [literalValue(schema["const"], `${at}/const`)];
    if ("enum" in schema) return list(schema["enum"], `${at}/enum`).map((item) => literalValue(item, `${at}/enum`));
    if (!("anyOf" in schema)) return undefined;
    return concat(list(schema["anyOf"], `${at}/anyOf`).map((member, index) => literals(member, `${at}/anyOf/${index}`)));
  };
  const tags = (value: unknown, key: string, path: string): Literal[] | undefined => {
    const [schema, at] = resolve(value, path);
    if ("anyOf" in schema) return concat(list(schema["anyOf"], `${at}/anyOf`).map((member, index) => tags(member, key, `${at}/anyOf/${index}`)));
    const properties = object(schema["properties"] ?? {}, `${at}/properties`);
    const required = list(schema["required"] ?? [], `${at}/required`).includes(key);
    return schema["type"] === "object" && required && Object.hasOwn(properties, key) ? literals(properties[key], `${at}/properties/${key}`) : undefined;
  };
  const discriminator = (members: unknown[], path: string): { key: string; cases: { member: unknown; values: Literal[] }[] } | undefined => {
    if (members.length === 0) return undefined;
    let [first, at] = resolve(members[0], `${path}/anyOf/0`);
    while ("anyOf" in first) [first, at] = resolve(list(first["anyOf"], `${at}/anyOf`)[0], `${at}/anyOf/0`);
    for (const key of list(first["required"] ?? [], `${at}/required`)) {
      if (typeof key !== "string") continue;
      const found = members.map((member, index) => tags(member, key, `${path}/anyOf/${index}`));
      if (!found.every((values): values is Literal[] => values !== undefined)) continue;
      const all = found.flat();
      const kinds = new Set(all.map((tag) => typeof tag));
      if (kinds.size === 1 && (kinds.has("string") || kinds.has("boolean")) && new Set(all).size === all.length) return { key, cases: found.map((values, index) => ({ member: members[index], values })) };
    }
    return undefined;
  };
  const classify = (value: unknown, path: string): SwiftKind | undefined => {
    const schema = node(value, path);
    if ("$ref" in schema || "const" in schema) return undefined;
    if ("enum" in schema || "anyOf" in schema) {
      const values = [...new Set(literals(schema, path) ?? [])];
      if (values.length > 0 && values.every((item) => typeof item === "string")) return { kind: "enum", values, raw: "String" };
      if (values.length > 0 && values.every((item) => typeof item === "number")) return { kind: "enum", values, raw: "Double" };
    }
    if ("anyOf" in schema) {
      const members = list(schema["anyOf"], `${path}/anyOf`);
      if (members.some((member, index) => node(member, `${path}/anyOf/${index}`)["type"] === "null")) return undefined;
      const found = discriminator(members, path);
      return found && { kind: "union", ...found };
    }
    if (schema["type"] !== "object" || Object.keys(object(schema["properties"] ?? {}, `${path}/properties`)).length === 0) return undefined;
    if (schema["patternProperties"] !== undefined || (schema["additionalProperties"] ?? false) !== false) throw new Error(`Unsupported open keys beside properties at ${path}`);
    return { kind: "struct" };
  };

  class Scope {
    readonly declarations: string[][] = [];
    private readonly names: Set<string>;

    constructor(names = new Set<string>()) {
      this.names = names;
    }

    declare(base: string, kind: SwiftKind, value: unknown, path: string): string {
      const name = reserved.has(base) || this.names.has(base) ? `${base}Value` : base;
      if (reserved.has(name) || this.names.has(name)) throw new Error(`No free Swift name for ${base} at ${path}`);
      this.names.add(name);
      this.declarations.push(build(name, kind, value, path));
      return name;
    }

    lines(): string[] {
      return this.declarations.flatMap((lines) => ["", ...indent(lines)]);
    }
  }

  const swiftType = (value: unknown, path: string, name: string, scope: Scope): string => {
    const schema = node(value, path);
    const reference = referenceName(schema, path);
    if (reference !== undefined) return defined(reference);
    if ("const" in schema) {
      const constant = literalValue(schema["const"], `${path}/const`);
      if (constant === null) throw new Error(`Unsupported null literal at ${path}/const`);
      return typeof constant === "string" ? "String" : typeof constant === "number" ? "Double" : "Bool";
    }
    const kind = classify(schema, path);
    if (kind) return scope.declare(name, kind, schema, path);
    if ("anyOf" in schema) {
      const members = list(schema["anyOf"], `${path}/anyOf`);
      const present = members.filter((member, index) => node(member, `${path}/anyOf/${index}`)["type"] !== "null");
      if (present.length === members.length) return "JSONValue";
      const inner = swiftType(present.length === 1 ? present[0] : { anyOf: present }, path, name, scope);
      return inner.endsWith("?") ? inner : `${inner}?`;
    }
    if ("enum" in schema) return "JSONValue";
    switch (schema["type"]) {
      case "string": return "String";
      case "integer": return "Int";
      case "number": return "Double";
      case "boolean": return "Bool";
      case "array": return `[${swiftType(schema["items"], `${path}/items`, `${name}Item`, scope)}]`;
      case "object": {
        const patterns = Object.entries(object(schema["patternProperties"] ?? {}, `${path}/patternProperties`));
        const additional = schema["additionalProperties"] ?? false;
        if (patterns.length + (additional === false ? 0 : 1) > 1) throw new Error(`Unsupported mix of open keys at ${path}`);
        const [pattern, child] = patterns[0] ?? [];
        if (pattern !== undefined && pattern !== "^.*$") throw new Error(`Unsupported pattern at ${path}/patternProperties/${pattern}`);
        if (pattern !== undefined) return `[String: ${swiftType(child, `${path}/patternProperties/${pattern}`, `${name}Value`, scope)}]`;
        if (typeof additional === "object") return `[String: ${swiftType(additional, `${path}/additionalProperties`, `${name}Value`, scope)}]`;
        return "[String: JSONValue]";
      }
      case undefined:
        if (unconstrained(schema)) return "JSONValue";
        throw new Error(`Missing schema type at ${path}`);
      default: throw new Error(`Unsupported type at ${path}/type`);
    }
  };

  const struct = (name: string, schema: Record<string, unknown>, path: string): string[] => {
    const scope = new Scope();
    const required = list(schema["required"] ?? [], `${path}/required`);
    const keys = new Map<string, string>();
    const writes: string[] = [];
    let writesNull = false;
    const fields = Object.entries(object(schema["properties"], `${path}/properties`)).map(([key, child]) => {
      const at = `${path}/properties/${key}`;
      const field = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? key : camel(key);
      if (keys.has(field)) throw new Error(`Two properties become ${field} in Swift at ${at}`);
      keys.set(field, key);
      const type = swiftType(child, at, pascal(key), scope);
      const property = node(child, at);
      const optional = !required.includes(key) || unconstrained(property) || type.endsWith("?");
      writesNull ||= optional && required.includes(key);
      writes.push(`    try container.${optional && !required.includes(key) ? "encodeIfPresent" : "encode"}(${escaped(field)}, forKey: .${escaped(field)})`);
      if (optional) return `var ${escaped(field)}: ${type.endsWith("?") ? type : `${type}?`}`;
      return "const" in property ? `var ${escaped(field)}: ${type} = ${swiftLiteral(literalValue(property["const"], `${at}/const`))}` : `var ${escaped(field)}: ${type}`;
    });
    const codingKeys = writesNull || [...keys].some(([field, key]) => field !== key)
      ? ["", "enum CodingKeys: String, CodingKey {", ...[...keys].map(([field, key]) => `    case ${escaped(field)}${field === key ? "" : ` = ${swiftLiteral(key)}`}`), "}"]
      : [];
    const encode = writesNull
      ? ["", "func encode(to encoder: any Encoder) throws {", "    var container = encoder.container(keyedBy: CodingKeys.self)", ...writes, "}"]
      : [];
    return [`struct ${name}: Codable, Hashable, Sendable {`, ...indent([...fields, ...codingKeys, ...encode]), ...scope.lines(), "}"];
  };

  const literalEnum = (name: string, values: Literal[], raw: string): string[] => {
    const cases = values.map((value) => ({ label: swiftCase(typeof value === "string" ? camel(value) : `_${String(value).replace(/\W/gu, "_")}`), value: swiftLiteral(value) }));
    if (new Set(cases.map(({ label }) => label)).size < cases.length) throw new Error(`Two values of ${name} become the same case in Swift`);
    return [
      `enum ${name}: RawRepresentable, Codable, Hashable, Sendable {`,
      ...cases.map(({ label }) => `    case ${label}`),
      `    case unrecognized(${raw})`,
      "",
      `    init(rawValue: ${raw}) {`,
      "        switch rawValue {",
      ...cases.map(({ label, value }) => `        case ${value}: self = .${label}`),
      "        default: self = .unrecognized(rawValue)",
      "        }",
      "    }",
      "",
      `    var rawValue: ${raw} {`,
      "        switch self {",
      ...cases.map(({ label, value }) => `        case .${label}: ${value}`),
      "        case .unrecognized(let value): value",
      "        }",
      "    }",
      "}",
    ];
  };

  const union = (name: string, key: string, members: { member: unknown; values: Literal[] }[], path: string): string[] => {
    const scope = new Scope();
    const field = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? key : camel(key);
    const labels = new Set<string>();
    const cases = members.map(({ member, values }, index) => {
      const at = `${path}/anyOf/${index}`;
      const reference = referenceName(node(member, at), at);
      const [only] = values;
      const base = values.length === 1 ? (typeof only === "boolean" ? (only ? camel(key) : `not${pascal(key)}`) : camel(String(only)))
        : reference ? camel(reference) : values.map((value, position) => (position === 0 ? camel(String(value)) : pascal(String(value)))).join("Or");
      const label = swiftCase(base);
      if (labels.has(label)) throw new Error(`Two members of ${name} become case ${label} in Swift`);
      labels.add(label);
      if (reference !== undefined) return { label, values, type: defined(reference) };
      const kind = classify(member, at);
      if (!kind) throw new Error(`Unsupported union member at ${at}`);
      return { label, values, type: scope.declare(pascal(base), kind, member, at) };
    });
    const all = members.flatMap(({ values }) => values);
    const boolean = typeof all[0] === "boolean";
    const open = !(boolean && all.length === 2);
    return [
      `enum ${name}: Codable, Hashable, Sendable {`,
      ...cases.map(({ label, type }) => `    case ${label}(${type})`),
      ...(open ? ["    case unrecognized(JSONValue)"] : []),
      "",
      "    private enum Discriminator: String, CodingKey {",
      `        case ${escaped(field)}${field === key ? "" : ` = ${swiftLiteral(key)}`}`,
      "    }",
      "",
      "    init(from decoder: any Decoder) throws {",
      "        let container = try decoder.container(keyedBy: Discriminator.self)",
      `        switch try container.decode(${boolean ? "Bool" : "String"}.self, forKey: .${escaped(field)}) {`,
      ...cases.map(({ label, values, type }) => `        case ${values.map(swiftLiteral).join(", ")}: self = try .${label}(${type}(from: decoder))`),
      ...(open ? ["        default: self = try .unrecognized(JSONValue(from: decoder))"] : []),
      "        }",
      "    }",
      "",
      "    func encode(to encoder: any Encoder) throws {",
      "        switch self {",
      ...cases.map(({ label }) => `        case .${label}(let value): try value.encode(to: encoder)`),
      ...(open ? ["        case .unrecognized(let value): try value.encode(to: encoder)"] : []),
      "        }",
      "    }",
      ...scope.lines(),
      "}",
    ];
  };

  const build = (name: string, kind: SwiftKind, value: unknown, path: string): string[] => {
    switch (kind.kind) {
      case "struct": return struct(name, node(value, path), path);
      case "enum": return literalEnum(name, kind.values, kind.raw);
      case "union": return union(name, kind.key, kind.cases, path);
    }
  };

  const hoisted = new Set<string>();
  return Object.fromEntries(areas.map((area) => {
    const top = new Scope(hoisted);
    const declarations = [...owners].filter(([, owner]) => owner === area).map(([name]) => {
      const path = `#/$defs/${name}`;
      const kind = classify(definitions[name], path);
      return kind ? build(name, kind, definitions[name], path) : [`typealias ${name} = ${swiftType(definitions[name], path, name, top)}`];
    });
    const body = [...declarations, ...top.declarations].map((lines) => indent(lines).join("\n")).join("\n\n");
    return [`${pascal(area)}Payloads.swift`, `// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.\n\nextension API {\n${body}\n}\n`];
  }));
}

export async function emittedSchema(): Promise<string> {
  const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
  return `${JSON.stringify(buildApiSchema(version), null, 2)}\n`;
}

const entry = process.argv[1];
if (import.meta.main ?? (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href)) {
  const destination = new URL("docs/api.schema.json", root);
  const schema = await emittedSchema();
  const document: unknown = JSON.parse(schema);
  const clients = [
    { directory: new URL("src/api/schema/", root), extension: ".ts", files: Object.fromEntries(Object.entries(generateBrowserTypes(document)).map(([area, content]) => [`${area}.ts`, content])) },
    { directory: new URL("ios/HUI/Gateway/Schema/", root), extension: ".swift", files: generateSwiftTypes(document) },
  ];
  const stale: string[] = [];
  for (const { directory, extension, files } of clients) {
    await mkdir(directory, { recursive: true });
    stale.push(...(await readdir(directory)).filter((file) => file.endsWith(extension) && !Object.hasOwn(files, file)));
  }
  if (stale.length > 0) throw new Error(`Remove obsolete generated API types: ${stale.join(", ")}`);
  await writeFile(destination, schema);
  for (const { directory, files } of clients) for (const [file, content] of Object.entries(files)) await writeFile(new URL(file, directory), content);
}
