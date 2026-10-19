/** Public bot payloads (HUI-18) and the routes that exchange them; the bot registry's stored records are not ones. */
import { Type, type Static } from "typebox";

export const BotFactKind = Type.Union([Type.Literal("fact"), Type.Literal("preference"), Type.Literal("decision")], { $id: "BotFactKind" });
export type BotFactKind = Static<typeof BotFactKind>;

export const BotFact = Type.Object({
  id: Type.String(),
  kind: BotFactKind,
  text: Type.String(),
  pinned: Type.Boolean(),
  source: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  revision: Type.Number(),
}, { $id: "BotFact" });
export type BotFact = Static<typeof BotFact>;

export const BotFactInput = Type.Object({
  kind: BotFactKind, text: Type.String(), source: Type.Optional(Type.String()), pinned: Type.Optional(Type.Boolean()),
}, { $id: "BotFactInput" });
export type BotFactInput = Static<typeof BotFactInput>;

export const BotFactPatch = Type.Object({
  kind: Type.Optional(BotFactKind), text: Type.Optional(Type.String()), pinned: Type.Optional(Type.Boolean()), revision: Type.Number(),
}, { $id: "BotFactPatch" });
export type BotFactPatch = Static<typeof BotFactPatch>;

export const BotFactsResponse = Type.Object({ facts: Type.Array(BotFact) }, { $id: "BotFactsResponse" });
export type BotFactsResponse = Static<typeof BotFactsResponse>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/bots/:id/facts", response: BotFactsResponse },
  { method: "POST", path: "/__hui/bots/:id/facts", request: BotFactInput, response: BotFactsResponse },
  { method: "PATCH", path: "/__hui/bots/:id/facts/:factId", request: BotFactPatch, response: BotFactsResponse },
  { method: "DELETE", path: "/__hui/bots/:id/facts/:factId", response: BotFactsResponse },
];
