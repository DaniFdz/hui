/** Public payloads for `POST /__hui/staff/chiefs`: a Chief of Staff for one custom session group, whose chat works in
 * that group's project. */
import { Type, type Static } from "typebox";
import { BotResponse } from "./bots.ts";

export const StaffChiefInput = Type.Object({
  /** The custom session group's label, which the bot record carries. */
  group: Type.String(),
  /** The project directory the chief's chat works in; its workers inherit it. */
  cwd: Type.String(),
}, { $id: "StaffChiefInput" });
export type StaffChiefInput = Static<typeof StaffChiefInput>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/staff/chiefs", request: StaffChiefInput, response: BotResponse },
];
