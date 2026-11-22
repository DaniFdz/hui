/** Public payloads for `POST /__hui/staff/chiefs`: a Chief of Staff for one custom session group. Its chat works in its
 * own bot folder, on the machine the group runs on; the group's project directory is where the sessions it creates
 * run. */
import { Type, type Static } from "typebox";
import { BotResponse } from "./bots.ts";

export const StaffChiefInput = Type.Object({
  /** The custom session group's label, which the bot record carries. The group's stored New session defaults name the
   * project directory and the machine. */
  group: Type.String(),
}, { $id: "StaffChiefInput" });
export type StaffChiefInput = Static<typeof StaffChiefInput>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/staff/chiefs", request: StaffChiefInput, response: BotResponse },
];
