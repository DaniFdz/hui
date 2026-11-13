/** Public local model-server payloads: the custom PI providers HUI can start, their reachability and the one
 * operator-set start command. PI's base URL and credentials never leave the gateway; `hasEndpoint` only says one
 * exists. */
import { Type, type Static } from "typebox";

export const LocalProviderStatus = Type.Union([
  Type.Literal("online"),
  Type.Literal("offline"),
  Type.Literal("starting"),
  Type.Literal("failed"),
  Type.Literal("unknown"),
], { $id: "LocalProviderStatus" });
export type LocalProviderStatus = Static<typeof LocalProviderStatus>;

export const LocalProvider = Type.Object({
  id: Type.String(),
  name: Type.String(),
  /** Models PI's models.json lists for this provider. */
  models: Type.Number(),
  /** False when a saved command outlives its provider in PI's models.json. */
  inPi: Type.Boolean(),
  /** A health URL or the provider's own base URL can be reached. */
  hasEndpoint: Type.Boolean(),
  configured: Type.Boolean(),
  status: LocalProviderStatus,
  message: Type.Optional(Type.String()),
  checkedAt: Type.Optional(Type.Number()),
  startCommand: Type.Optional(Type.String()),
  healthUrl: Type.Optional(Type.String()),
  readyTimeoutMs: Type.Optional(Type.Number()),
}, { $id: "LocalProvider" });
export type LocalProvider = Static<typeof LocalProvider>;

export const LocalProviderSnapshot = Type.Object({
  providers: Type.Array(LocalProvider),
}, { $id: "LocalProviderSnapshot" });
export type LocalProviderSnapshot = Static<typeof LocalProviderSnapshot>;

export const LocalProviderRequest = Type.Object({
  startCommand: Type.String(),
  healthUrl: Type.Optional(Type.String()),
  readyTimeoutMs: Type.Optional(Type.Number()),
}, { $id: "LocalProviderRequest" });
export type LocalProviderRequest = Static<typeof LocalProviderRequest>;

export const LocalProviderOk = Type.Object({ ok: Type.Literal(true) }, { $id: "LocalProviderOk" });
export type LocalProviderOk = Static<typeof LocalProviderOk>;

export const LocalProviderError = Type.Object({ error: Type.String() }, { $id: "LocalProviderError" });
export type LocalProviderError = Static<typeof LocalProviderError>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/local-providers", response: LocalProviderSnapshot },
  { method: "PUT", path: "/__hui/local-providers/:provider", request: LocalProviderRequest, response: LocalProvider },
  { method: "DELETE", path: "/__hui/local-providers/:provider", response: LocalProviderOk },
  { method: "POST", path: "/__hui/local-providers/:provider/start", response: LocalProvider },
];
