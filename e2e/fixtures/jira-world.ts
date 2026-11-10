/**
 * The shared suite's Jira world: `jira-fixture.mjs` on a free port, started by the test that needs a live Jira
 * connection instead of by the launcher for every run (`--jira-fixture`). It owns only the process; `hui.ts` admits
 * the origin to the verified gateway and connects it, so a test asks for the world with `hui.jira()` and the runs
 * that never do pay nothing for it.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./jira-fixture.mjs", import.meta.url));

export type JiraFixture = {
  /** The loopback origin the fixture answers on, as the gateway must be told it. */
  origin: string;
  /** Stops the fixture; the gateway is disconnected by the fixture that owns this world. */
  stop(): Promise<void>;
};

export async function startJiraFixture(): Promise<JiraFixture> {
  const child = spawn(process.execPath, [fixture], {
    // Port 0 asks the OS for a free port, so two checkouts running the suite at once never collide. The fixture reads
    // nothing but this, so the operator's environment stays out of it.
    env: { PATH: process.env["PATH"] ?? "", HUI_E2E_JIRA_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const origin = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      const found = /HUI E2E Jira: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1];
      if (found) resolve(found);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`The Jira fixture exited (${code ?? signal}) before it answered.`)));
  });
  return {
    origin,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await exited;
    },
  };
}
