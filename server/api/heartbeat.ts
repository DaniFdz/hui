/** The gateway heartbeat's manual check: which watched sessions it continued. */
import { Type, type Static } from "typebox";

export const HeartbeatRun = Type.Object({ notified: Type.Array(Type.String()) }, { $id: "HeartbeatRun" });
export type HeartbeatRun = Static<typeof HeartbeatRun>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/heartbeat", response: HeartbeatRun },
];
