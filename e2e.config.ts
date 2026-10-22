/** The shared e2e suite: HUI's web UI in a browser and the iOS app on the "HUI iPhone" simulator, each against a disposable gateway started by the visual-verification launcher. */
import { execFileSync } from "node:child_process";
import type { E2EConfig } from "e2e";
import { mobile } from "@e2e-dev/mobile";
import { web } from "@e2e-dev/web";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "HEAD";

const launcher = (target: string, port: string) => ({
  executable: "node",
  args: ["e2e/visual-verification.mjs", "launch", "--branch", branch, "--port", port, "--receipt-dir", ".e2e/hui"],
  startupTimeout: 120_000,
  log: `.e2e/logs/hui-${target}.log`,
});

export default {
  tests: "e2e/tests/**/*.e2e.ts",
  retries: 0,
  workers: 1,
  assertionTimeout: 15_000,
  reporters: ["list", "junit", "markdown"],
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: { url: "http://127.0.0.1:0", command: launcher("web", "{port}") },
    },
    {
      name: "ios",
      engine: mobile({ platform: "ios", device: "HUI iPhone" }),
      app: {
        bundleId: "dev.hui.ios",
        readyUrl: "http://127.0.0.1:47400/",
        command: launcher("ios", "47400"),
      },
    },
  ],
} satisfies E2EConfig;
