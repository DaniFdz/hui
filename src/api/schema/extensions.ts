/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type ExtensionRouteInfo = { "method": string; "path": string; "description": string; };

export type ExtensionStatus = { "id": string; "name": string; "description": string; "enabled": boolean; "state": ("loaded") | ("disabled") | ("failed") | ("missing"); "error"?: string; "routes": Array<ExtensionRouteInfo>; };

export type ExtensionToggleRequest = { "enabled": boolean; };

export type ExtensionsResponse = { "extensions": Array<ExtensionStatus>; "storeError"?: string; };

export type PluginError = { "error": string; };

export type PluginPayload = Record<string, unknown>;
