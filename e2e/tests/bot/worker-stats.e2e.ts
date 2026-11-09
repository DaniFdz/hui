/** An agent reads this machine and every worker's load before choosing where to run (BOT-074). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("worker_stats returns this machine's load and recommends it when no worker is connected", { tags: ["BOT-074"], platforms: ["web"] }, async ({ hui }) => {
  const source = await hui.createSession({ title: "Stats reader" });
  await hui.prompt(source, call("worker_stats", {}));
  await expect.poll(async () => (await hui.stored("Recommended: This machine")).length, { timeout: 30_000 }).toBeGreaterThan(0);
});
