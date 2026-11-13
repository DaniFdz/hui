/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type LocalProvider = { "id": string; "name": string; "models": number; "inPi": boolean; "hasEndpoint": boolean; "configured": boolean; "status": LocalProviderStatus; "message"?: string; "checkedAt"?: number; "startCommand"?: string; "healthUrl"?: string; "readyTimeoutMs"?: number; };

export type LocalProviderError = { "error": string; };

export type LocalProviderOk = { "ok": true; };

export type LocalProviderRequest = { "startCommand": string; "healthUrl"?: string; "readyTimeoutMs"?: number; };

export type LocalProviderSnapshot = { "providers": Array<LocalProvider>; };

export type LocalProviderStatus = ("online") | ("offline") | ("starting") | ("failed") | ("unknown");
