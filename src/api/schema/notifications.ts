/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type NotificationTestError = { "error": string; };

export type NotificationTestResponse = { "sent": true; };

export type PushError = { "error": string; };

export type PushStatusResponse = { "publicKey": string; "devices": Array<{ "id": string; "createdAt": string; "device"?: string; }>; };

export type PushSubscribeRequest = { "endpoint": string; "keys": { "p256dh": string; "auth": string; }; "device"?: string; };

export type PushSubscribeResponse = { "subscribed": true; "id": string; };

export type PushTestResponse = { "sent": number; "devices": number; };

export type PushUnsubscribeRequest = { "endpoint": string; };

export type PushUnsubscribeResponse = { "removed": boolean; };
