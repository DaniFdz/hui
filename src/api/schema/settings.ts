/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type BrowserSettings = { "enabled": boolean; "headless": boolean; "executablePath": string; "mirrorState": boolean; "allowedOrigins": Array<string>; };

export type NtfySettings = { "server": string; "topic": string; };

export type Settings = { "chat": { "toolMarks": Record<string, string>; "toolIcons": Record<string, string>; }; "profileName": string; "profileHandle": string; "name": string; "branchPrefix": string; "browser": BrowserSettings; "codemode": { "enabled": boolean; }; "questions": { "timeoutMinutes": number; }; "vscode": VscodeSettings; "power": { "keepAwake": boolean; }; "notifications": { "tool": boolean; "runFinished": boolean; "runFailed": boolean; "needsInput": boolean; "ntfy": NtfySettings; }; "models": { "primary": string; "fallback": string; "utility": string; "thinking": ("") | (("off") | ("minimal") | ("low") | ("medium") | ("high") | ("xhigh") | ("max")); "retryAttempts": number; "routes": Array<{ "name": string; "description": string; "model": string; "thinking"?: ("off") | ("minimal") | ("low") | ("medium") | ("high") | ("xhigh") | ("max"); }>; }; "calls": { "voice": ("cove") | ("arbor") | ("breeze") | ("ember") | ("juniper") | ("maple") | ("sol") | ("spruce") | ("vale"); }; "disabledSkills": Array<{ "name": string; "path": string; }>; "disabledPlugins": Array<{ "id": string; "name": string; "kind": ("package") | ("extension"); }>; "labs": { "denseObservability": boolean; "detailedDebug": boolean; }; };

export type SettingsError = { "error": string; };

export type SettingsRequest = unknown;

export type VscodeProviderPreference = ("auto") | ("configured") | ("desktop") | ("managed") | ("path");

export type VscodeSettings = { "enabled": boolean; "executable": string; "provider": VscodeProviderPreference; "licenseAcceptedAt": string; };
