import { randomUUID } from "node:crypto";

/** Provider header interpolation must also work in extension-free PI workers.
 * Never mutate the gateway environment or share a generated ID between jobs. */
export function piEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    PI_CLIENT_SESSION_ID: base["PI_CLIENT_SESSION_ID"]?.trim() || randomUUID(),
  };
}
