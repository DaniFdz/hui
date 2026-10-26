/** The shared e2e suite: HUI's web UI in a browser and the iOS app on a simulator ("HUI iPhone" and port 47400 unless `E2E_IOS_DEVICE` and `E2E_IOS_PORT` name another, so two checkouts can run at once), each against a disposable gateway started by the visual-verification launcher. A run on another simulator also gets its own agent-device state folder (`~/.agent-device-<port>`) unless `AGENT_DEVICE_STATE_DIR` names one, because two runs sharing it fail with "already bound". */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { E2EConfig } from "e2e";
import { mobile } from "@e2e-dev/mobile";
import { web } from "@e2e-dev/web";

export const IOS_DEVICE = process.env.E2E_IOS_DEVICE ?? "HUI iPhone";
export const IOS_PORT = Number(process.env.E2E_IOS_PORT ?? 47400);
if (process.env.E2E_IOS_DEVICE) process.env.AGENT_DEVICE_STATE_DIR ??= join(homedir(), `.agent-device-${IOS_PORT}`);

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "HEAD";

const launcher = (target: string, port: string) => ({
  executable: "node",
  args: ["e2e/visual-verification.mjs", "launch", "--branch", branch, "--port", port, "--receipt-dir", ".e2e/hui", "--fast-fixture"],
  startupTimeout: 120_000,
  log: `.e2e/logs/hui-${target}.log`,
});

export default {
  tests: "e2e/tests/**/*.e2e.ts",
  retries: 0,
  timeout: 180_000,
  workers: 1,
  assertionTimeout: 15_000,
  actionTimeout: 60_000,
  reporters: ["list", "junit", "markdown"],
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: { url: "http://127.0.0.1:0", command: launcher("web", "{port}") },
    },
    {
      name: "ios",
      engine: mobile({ platform: "ios", device: IOS_DEVICE }),
      app: {
        bundleId: "dev.hui.ios",
        readyUrl: `http://127.0.0.1:${IOS_PORT}/`,
        command: launcher("ios", String(IOS_PORT)),
      },
    },
  ],
} satisfies E2EConfig;
