/**
 * The web target's browser: this machine's Chromium, launched here so the target can hand it the switches a use case
 * needs, and leased to the engine as a `BrowserProvider` — a browser the engine attaches to over CDP instead of
 * launching one itself. One switch matters today: `--use-fake-device-for-media-stream` gives every page a fake camera
 * and microphone, so the CALL use cases can reach a call instead of stopping at "No microphone was found".
 *
 * The permission is deliberately not in the launch. `--use-fake-ui-for-media-stream` answers every permission prompt
 * with "allowed", and CALL-004 — the use case about a call whose microphone could not open — would lose the only case
 * this engine can prove. The device exists in every page; a test that wants the microphone asks for it with
 * `hui.allowMedia()`, which grants the permission on the attempt's own browser context (Playwright's
 * `context.grantPermissions`), and a page that never asks is refused exactly as a browser refuses a page the operator
 * denied. What the fake device cannot do is carry a real conversation: GPT-Live still needs a ChatGPT login and the
 * gateway's realtime route, so a call reaches its pre-connect surface and no further.
 *
 * The browser is launched by the engine's own Playwright (`launchServer`), so it keeps every default a normal launch
 * has — the headless shell, the fonts, the sRGB colour profile, the sandbox decisions — with only the switches this
 * module adds on top, and it answers a raw CDP endpoint beside Playwright's: `--remote-debugging-port` is what the
 * engine attaches to. `release` closes the browser, and a process that ends without releasing leaves nothing behind.
 *
 * It always launches headless: a browser this module started is not what `--headed` reaches, and a run that wants a
 * window to watch should use a target the engine launches itself.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { web, surfaceOf, type BrowserLease, type BrowserProvider, type BrowserReleaseContext, type BrowserRequest } from "@e2e-dev/web";

/** The engine's own Playwright: the exact copy `@e2e-dev/web` pins, whatever the layout of `node_modules`. */
const playwright = createRequire(import.meta.resolve("@e2e-dev/web"))("playwright-core") as
  typeof import("playwright-core");

/** How long a launch may take to answer its CDP endpoint, in milliseconds: a bound on a browser that never starts, never a wait in place of a fact. */
const ENDPOINT_DEADLINE_MS = 60_000;

/** The switches every page of the web target gets: a fake camera and microphone, and no permission answered for the page. */
export const FAKE_MEDIA_ARGS = ["--use-fake-device-for-media-stream"] as const;

/** A free port on this machine's loopback, from the kernel and released at once: the browser binds it a moment later. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error("the web target's browser was given no loopback port for its CDP endpoint");
  return port;
}

/** The CDP endpoint a launched browser answers on, once it answers; it fails with why when it never does. */
async function debugEndpoint(port: number): Promise<string> {
  const deadline = Date.now() + ENDPOINT_DEADLINE_MS;
  let last = "";
  while (Date.now() < deadline) {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
      (response) => response.json() as Promise<{ webSocketDebuggerUrl?: string }>,
      (error: unknown) => {
        last = error instanceof Error ? error.message : String(error);
        return undefined;
      });
    if (version?.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the web target's browser never answered its CDP endpoint on 127.0.0.1:${port} (${last || "no answer"})`);
}

/**
 * A `BrowserProvider` that launches this machine's Chromium with `args` and leases it to the engine over CDP. The
 * browsers it started are closed by `release`, and by the process's own exit if a run ends without one.
 */
export function localChromium({ name, args }: { name: string; args: readonly string[] }): BrowserProvider {
  const launched = new Map<string, Awaited<ReturnType<typeof playwright.chromium.launchServer>>>();
  process.once("exit", () => {
    for (const server of launched.values()) server.process()?.kill();
    launched.clear();
  });
  let counter = 0;
  return {
    name,
    async acquire(request: BrowserRequest): Promise<BrowserLease> {
      const executable = playwright.chromium.executablePath();
      if (!existsSync(executable)) {
        throw new Error(`${name}: this machine has no Playwright Chromium at ${executable}. The engine installs the browser it launches itself, and this one is launched here, so run "npx e2e-web install chromium" first.`);
      }
      const port = await freePort();
      const server = await playwright.chromium.launchServer({ headless: true, args: [...args, `--remote-debugging-port=${port}`], timeout: ENDPOINT_DEADLINE_MS });
      const id = `${request.targetName}-${request.slot + 1}-${(counter += 1)}`;
      launched.set(id, server);
      try {
        request.log(`${name}: launched on 127.0.0.1:${port}`);
        return { id, cdpEndpoint: await debugEndpoint(port) };
      } catch (error) {
        launched.delete(id);
        await server.close().catch(() => undefined);
        throw error;
      }
    },
    async release(lease: BrowserLease, context: BrowserReleaseContext): Promise<void> {
      const server = launched.get(lease.id);
      if (!server) return;
      launched.delete(lease.id);
      context.log(`${name}: closing ${lease.id}`);
      await server.close();
    },
  };
}

/**
 * The web target's engine. `e2e.config.ts` gives it to the target and `hui.allowMedia()` reaches its attempt context, so
 * both import this one handle: the config a worker resolves and the fixture it runs are the same module instance.
 */
export const webEngine = web({
  viewport: { width: 1440, height: 900 },
  browser: localChromium({ name: "this machine's Chromium with a fake camera and microphone", args: FAKE_MEDIA_ARGS }),
});

/** Grants this attempt's page the microphone and the camera: the fake device is what answers them. */
export async function allowMedia(): Promise<void> {
  const surface = surfaceOf(webEngine);
  if (!surface) throw new Error("hui.allowMedia(): the web target's engine owns no attempt to grant a permission on");
  await surface.context().grantPermissions(["microphone", "camera"]);
}
