/** The shared e2e suite: HUI's web UI in a browser against a disposable gateway, started by the visual-verification launcher. */
import { execFileSync } from "node:child_process";
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "HEAD";

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
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "node",
          args: ["e2e/visual-verification.mjs", "launch", "--branch", branch, "--production", "--port", "{port}", "--receipt-dir", ".e2e/hui"],
          startupTimeout: 300_000,
          log: ".e2e/logs/hui-web.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
