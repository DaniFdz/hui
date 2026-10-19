/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type BotFact = { "id": string; "kind": BotFactKind; "text": string; "pinned": boolean; "source": string; "createdAt": string; "updatedAt": string; "revision": number; };

export type BotFactInput = { "kind": BotFactKind; "text": string; "source"?: string; "pinned"?: boolean; };

export type BotFactKind = ("fact") | ("preference") | ("decision");

export type BotFactPatch = { "kind"?: BotFactKind; "text"?: string; "pinned"?: boolean; "revision": number; };

export type BotFactsResponse = { "facts": Array<BotFact>; };
