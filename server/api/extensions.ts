/**
 * Gateway extensions: the two published routes (the status list and the enable switch) and the generic payloads an
 * extension's own routes answer with. The extension-instance routes are dynamic, so they are documented in prose and
 * never published here; a plugin payload is a JSON object HUI does not type.
 */
import { Type, type Static } from "typebox";

export const ExtensionRouteInfo = Type.Object({
  method: Type.String(),
  path: Type.String(),
  description: Type.String(),
  stream: Type.Optional(Type.Boolean()),
}, { $id: "ExtensionRouteInfo" });
export type ExtensionRouteInfo = Static<typeof ExtensionRouteInfo>;

export const ExtensionPanel = Type.Object({
  title: Type.String(),
  entry: Type.String(),
  icon: Type.Optional(Type.Union([
    Type.Literal("package"), Type.Literal("github"), Type.Literal("pull-request"),
  ])),
}, { $id: "ExtensionPanel" });
export type ExtensionPanel = Static<typeof ExtensionPanel>;

export const ExtensionPromptInfo = Type.Object({
  id: Type.String(),
  title: Type.String(),
  text: Type.String(),
}, { $id: "ExtensionPromptInfo" });
export type ExtensionPromptInfo = Static<typeof ExtensionPromptInfo>;

export const ExtensionToolInfo = Type.Object({
  name: Type.String(),
  runtimeName: Type.String(),
  description: Type.String(),
}, { $id: "ExtensionToolInfo" });
export type ExtensionToolInfo = Static<typeof ExtensionToolInfo>;

export const ExtensionEnginesInfo = Type.Object({
  min: Type.Optional(Type.String()),
  max: Type.Optional(Type.String()),
}, { $id: "ExtensionEnginesInfo" });
export type ExtensionEnginesInfo = Static<typeof ExtensionEnginesInfo>;

export const ExtensionStatus = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  enabled: Type.Boolean(),
  state: Type.Union([
    Type.Literal("loaded"), Type.Literal("disabled"), Type.Literal("failed"), Type.Literal("missing"),
  ]),
  error: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  engines: Type.Optional(ExtensionEnginesInfo),
  reloadedAt: Type.Optional(Type.Number()),
  mode: Type.Union([Type.Literal("in-process"), Type.Literal("process")]),
  restarts: Type.Number(),
  panel: Type.Optional(ExtensionPanel),
  prompt: Type.Optional(Type.Array(ExtensionPromptInfo)),
  tools: Type.Optional(Type.Array(ExtensionToolInfo)),
  routes: Type.Array(ExtensionRouteInfo),
}, { $id: "ExtensionStatus" });
export type ExtensionStatus = Static<typeof ExtensionStatus>;

export const ExtensionsResponse = Type.Object({
  extensions: Type.Array(ExtensionStatus),
  storeError: Type.Optional(Type.String()),
}, { $id: "ExtensionsResponse" });
export type ExtensionsResponse = Static<typeof ExtensionsResponse>;

export const ExtensionToggleRequest = Type.Object({ enabled: Type.Boolean() }, { $id: "ExtensionToggleRequest" });
export type ExtensionToggleRequest = Static<typeof ExtensionToggleRequest>;

/** One extension route's answer: a plain JSON object. HUI publishes the shape, not its fields. */
export const PluginPayload = Type.Object({}, { additionalProperties: true, $id: "PluginPayload" });
export type PluginPayload = Record<string, unknown>;

export const PluginError = Type.Object({ error: Type.String() }, { $id: "PluginError" });
export type PluginError = Static<typeof PluginError>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/ext", response: ExtensionsResponse },
  { method: "PUT", path: "/__hui/ext/:id", request: ExtensionToggleRequest, response: ExtensionStatus },
  { method: "POST", path: "/__hui/ext/:id/reload", response: ExtensionStatus },
];
