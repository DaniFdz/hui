/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type ExtensionPanel = { "title": string; "entry": string; };

export type ExtensionPromptInfo = { "id": string; "title": string; "text": string; };

export type ExtensionRouteInfo = { "method": string; "path": string; "description": string; "stream"?: boolean; };

export type ExtensionStatus = { "id": string; "name": string; "description": string; "enabled": boolean; "state": ("loaded") | ("disabled") | ("failed") | ("missing"); "error"?: string; "panel"?: ExtensionPanel; "prompt"?: Array<ExtensionPromptInfo>; "tools"?: Array<ExtensionToolInfo>; "routes": Array<ExtensionRouteInfo>; };

export type ExtensionToggleRequest = { "enabled": boolean; };

export type ExtensionToolInfo = { "name": string; "runtimeName": string; "description": string; };

export type ExtensionsResponse = { "extensions": Array<ExtensionStatus>; "storeError"?: string; };

export type PluginError = { "error": string; };

export type PluginPayload = Record<string, unknown>;
