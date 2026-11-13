/** The ntfy test route: one message to the configured relay, so the operator can prove the phone receives HUI. */
import { Type, type Static } from "typebox";

export const NotificationTestResponse = Type.Object({ sent: Type.Literal(true) }, { $id: "NotificationTestResponse" });
export type NotificationTestResponse = Static<typeof NotificationTestResponse>;

export const NotificationTestError = Type.Object({ error: Type.String() }, { $id: "NotificationTestError" });
export type NotificationTestError = Static<typeof NotificationTestError>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/notifications/test", response: NotificationTestResponse },
];
