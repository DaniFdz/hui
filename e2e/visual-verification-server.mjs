/** Test-only Vite entrypoint. Never imported by the product or its build. */
import { createServer, preview } from "vite";
import { stopBackend } from "../server/backend.ts";
import { fetchProviderQuota } from "../server/pi/provider-quota.ts";
import { quotaFixture } from "./fixtures/provider-quota-fixture.mjs";
import { huiConfig } from "../server/vite-plugin.ts";
import { readFile } from "node:fs/promises";
import { createAutomationClock } from "./fixtures/automation-clock.ts";

const identity = JSON.parse(process.env.HUI_VERIFICATION_IDENTITY);
const token = process.env.HUI_VERIFICATION_TOKEN;
delete process.env.HUI_VERIFICATION_IDENTITY;
delete process.env.HUI_VERIFICATION_TOKEN;
// The shared suite runs the built app behind Vite's preview server, so its
// offline files, service worker and cached shell are the ones a release ships.
const production = process.env.HUI_VERIFICATION_PRODUCTION === "1";

let network = "online";
// Parent state arrives before huiConfig starts the real scheduler, including after a child restart.
const initialNow = await new Promise((resolve) => {
  const initialize = (message) => {
    if (message.type !== "automation-clock-init") return;
    process.off("message", initialize);
    resolve(message.now);
  };
  process.on("message", initialize);
  process.send({ type: "automation-clock-ready" });
});
const automationClock = createAutomationClock(initialNow);
let clockRequest = 0;
const rememberClock = () => new Promise((resolve) => {
  const id = ++clockRequest;
  const acknowledge = (message) => {
    if (message.type !== "automation-clock-ack" || message.id !== id) return;
    process.off("message", acknowledge);
    resolve();
  };
  process.on("message", acknowledge);
  process.send({ type: "automation-clock-state", id, now: automationClock.state() });
});

async function verification(request, response) {
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  if (request.headers["x-hui-verification"] !== token) {
    response.statusCode = 403;
    return response.end(JSON.stringify({ error: "verification token required" }));
  }
  if (request.url === "/__verification" && request.method === "GET") {
    return response.end(JSON.stringify({ ...identity, serverPid: process.pid, cwd: process.cwd() }));
  }
  if (request.url === "/__verification/automation-clock" && request.method === "POST") {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { action, ms } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (action === "freeze") automationClock.freeze();
      else if (action === "advance") automationClock.advance(ms);
      else if (action === "resume") automationClock.resume();
      else throw new Error("clock action must be freeze, advance or resume");
      await rememberClock();
      return response.end(JSON.stringify({ now: automationClock.state() }));
    } catch (error) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: error.message }));
    }
  }
  if (request.url === "/__verification/network" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { mode } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (mode !== "online" && mode !== "offline" && mode !== "silent") {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: "mode must be online, offline or silent" }));
    }
    network = mode;
    return response.end(JSON.stringify({ mode: network }));
  }
  if (request.url === "/__verification/shutdown" && request.method === "POST") {
    response.end(JSON.stringify({ stopping: true }));
    process.send?.({ type: "shutdown" });
    return;
  }
  response.statusCode = 405;
  response.end(JSON.stringify({ error: "method not allowed" }));
}

async function handle(request, response, next) {
  if ((request.url ?? "").startsWith("/__verification")) return verification(request, response);
  if (network === "offline") {
    request.socket.destroy();
    return;
  }
  if (network === "silent") {
    response.statusCode = 503;
    return response.end();
  }
  const quota = /^\/__hui\/providers\/(openai-codex|anthropic|opencode-go|mistral)\/accounts\/([^/]+)\/quota$/.exec(request.url ?? "");
  if (process.env.HUI_VERIFICATION_QUOTAS === "1" && quota && request.method === "GET" && request.headers["x-hui"] === "1") {
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    return response.end(JSON.stringify(await fetchProviderQuota(quota[1], "synthetic-credential", undefined, async (url) => new Response(JSON.stringify(
      String(url).endsWith("/profile") ? { account: { email_address: "alex.claude@example.com" } }
        : String(url).endsWith("/billing/subscription") ? { plan_name: "EDU", payg_enabled: false, vibe_payg_enabled: false, enterprise: false }
        : quotaFixture(quota[1], quota[2])
    )))));
  }
  // The demo recorder's stage frames HUI from HUI's own origin, since widgets refuse other ancestors.
  if (process.env.HUI_DEMO_STAGE && request.url === "/__demo/stage") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    return response.end(await readFile(process.env.HUI_DEMO_STAGE));
  }
  return next();
}

const plugin = {
  name: "hui-visual-verification-identity",
  // Preview never restarts, so it starts the backend in one place; the dev
  // server also listens before the backend starts.
  configureServer(vite) { vite.middlewares.use(handle); },
  configurePreviewServer(vite) { vite.middlewares.use(handle); },
};

const port = Number(process.env.HUI_VERIFICATION_PORT ?? 0);
const server = production
  ? await preview({
      root: identity.checkout.root,
      configFile: false,
      logLevel: "warn",
      preview: { host: "127.0.0.1", port, strictPort: true },
      plugins: [plugin, huiConfig({ automationClock: automationClock.clock })],
    })
  : await createServer({
      root: identity.checkout.root,
      configFile: false,
      envDir: false,
      cacheDir: process.env.HUI_VERIFICATION_CACHE,
      logLevel: "warn",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
      plugins: [plugin, huiConfig({ automationClock: automationClock.clock })],
    });
server.httpServer.prependListener("upgrade", (request, socket) => {
  if (!(request.url ?? "").startsWith("/__hui/")) return;
  const write = socket.write;
  socket.write = function (...args) {
    if (network !== "silent") return write.apply(this, args);
    const callback = args.at(-1);
    if (typeof callback === "function") queueMicrotask(callback);
    return true;
  };
});
if (!production) await server.listen();

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 8_000);
  deadline.unref();
  await server.close();
  // Only the dev server reaches huiConfig's closeBundle; preview would leave the backend's store open.
  if (production) await stopBackend().catch(() => undefined);
  automationClock.dispose();
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("disconnect", stop);
const address = server.httpServer.address();
process.send({ type: "ready", url: `http://127.0.0.1:${address.port}` });
