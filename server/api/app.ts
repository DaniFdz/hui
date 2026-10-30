/** Opening a chat in the HUI desktop app: the server side of a `?open=app` link, which a browser cannot start
 * itself without a click. */
import { Type, type Static } from "typebox";

export const AppOpenRequest = Type.Object({ path: Type.String() }, { $id: "AppOpenRequest" });
export type AppOpenRequest = Static<typeof AppOpenRequest>;

export const AppOpenResponse = Type.Object({ opened: Type.Literal(true) }, { $id: "AppOpenResponse" });
export type AppOpenResponse = Static<typeof AppOpenResponse>;

export const AppOpenError = Type.Object({ error: Type.String() }, { $id: "AppOpenError" });
export type AppOpenError = Static<typeof AppOpenError>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/app/open", request: AppOpenRequest, response: AppOpenResponse },
];
