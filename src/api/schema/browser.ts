/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type BrowserControl = { "action": ("start") | ("stop"); };

export type BrowserError = { "error": string; };

export type BrowserExecutableView = { "path": string; "name": string; "source": ("configured") | ("detected"); };

export type BrowserHandoff = { "tabId": string; "message": string; "since": string; };

export type BrowserPreview = { "image": string; };

export type BrowserState = ("stopped") | ("starting") | ("running") | ("stopping");

export type BrowserStatus = { "enabled": boolean; "headless": boolean; "executablePath": string; "executable": (BrowserExecutableView) | (null); "executableError": string; "state": BrowserState; "mode"?: ("headless") | ("windowed"); "version"?: string; "startedAt"?: string; "profileDir": string; "lastError": string; "tabs": Array<BrowserTabView>; };

export type BrowserTabView = { "id": string; "ownerSessionId": string; "ownerTitle": string; "title": string; "url": string; };

export type BrowserViewAction = { "tabId": string; "text": string; "point"?: { "x": number; "y": number; }; "at": string; };

export type BrowserViewConnection = { "url": string; };

export type BrowserViewControl = ({ "action": "select"; "tabId": (string) | (null); }) | ({ "action": "pointer"; "tabId": string; "kind": ("move") | ("down") | ("up"); "x": number; "y": number; "button": ("left") | ("right"); }) | ({ "action": "wheel"; "tabId": string; "x": number; "y": number; "deltaX": number; "deltaY": number; }) | ({ "action": "key"; "tabId": string; "key": string; }) | ({ "action": "continue"; "tabId": string; });

export type BrowserViewMessage = ({ "type": "state"; "running": boolean; "mode"?: ("headless") | ("windowed"); "tabs": Array<BrowserViewTab>; "current": (string) | (null); "watching": (string) | (null); "following": boolean; "handoff": (BrowserHandoff) | (null); }) | ({ "type": "action"; "tabId": string; "text": string; "point"?: { "x": number; "y": number; }; "at": string; });

export type BrowserViewState = { "running": boolean; "mode"?: ("headless") | ("windowed"); "tabs": Array<BrowserViewTab>; "current": (string) | (null); "watching": (string) | (null); "following": boolean; "handoff": (BrowserHandoff) | (null); };

export type BrowserViewTab = { "id": string; "title": string; "url": string; };
