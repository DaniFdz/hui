/** Test-only Vite entrypoint. Never imported by the product or its build. */
import { createServer, preview } from "vite";
import { stopBackend } from "../server/backend.ts";
import { fetchProviderQuota } from "../server/pi/provider-quota.ts";
import { quotaFixture } from "./fixtures/provider-quota-fixture.mjs";
import { huiConfig } from "../server/vite-plugin.ts";
import { readFile } from "node:fs/promises";

const identity = JSON.parse(process.env.HUI_VERIFICATION_IDENTITY);
const token = process.env.HUI_VERIFICATION_TOKEN;
delete process.env.HUI_VERIFICATION_IDENTITY;
delete process.env.HUI_VERIFICATION_TOKEN;
// The shared suite runs the built app behind Vite's preview server, so its
// offline files, service worker and cached shell are the ones a release ships.
const production = process.env.HUI_VERIFICATION_PRODUCTION === "1";

let network = "online";

const json = (response, status, body) => response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));

// ---- Scripted provider setup (--provider-fixture) -------------------------------------------------------------
// The provider wizard's routes answered from memory: a sign-in that completes after a few polls, one model choice
// and one model check. Nothing here reaches an account, a provider or the gateway's own provider service, so a
// screenshot run walks Settings → Models → Connect a provider offline. Only these routes are replaced.
const providerFixture = process.env.HUI_VERIFICATION_PROVIDER_FIXTURE === "1";
const fixtureModels = [
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", contextWindow: 400_000, maxTokens: 128_000 },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", contextWindow: 400_000, maxTokens: 128_000 },
  { id: "gpt-5.1", name: "GPT-5.1", contextWindow: 400_000, maxTokens: 128_000 },
];
// `signedIn` outlives `phase`: the gateway keeps the connection when a save clears the finished login, so a reload
// after the model step must show the card and no wizard.
const providerState = { phase: "idle", signedIn: false, provider: "openai-codex", flow: "", polls: 0, selected: [] };

/** The sign-in this fixture is running: a device code for a subscription flow, a prompt for an API key. */
function fixtureLogin() {
  const base = { id: "hui-fixture-login", provider: providerState.provider, phase: providerState.phase };
  if (providerState.phase !== "pending") return { ...base, message: "Signed in." };
  if (!providerState.flow) {
    return { ...base, prompt: { id: "hui-fixture-prompt", type: "text", message: "Enter API key" } };
  }
  // The gateway repeats no browser instructions in `message`, and a device code says what to do with the code.
  return {
    ...base, flow: providerState.flow, url: "https://example.com/device", code: "HUI7-DEMO",
    ...(providerState.flow === "device_code" ? { message: "Enter the code in the sign-in page.", expiresAt: Date.now() + 900_000 } : {}),
    prompt: { id: "hui-fixture-prompt", type: "manual_code", message: "Paste the callback address" },
  };
}

/**
 * The scripted sign-in completes after about forty polls (~48 s at the wizard's 1.2 s poll), which is long enough for a
 * person to reach and capture the browser step and the device-code screen; once complete it stays complete, whatever
 * later polls arrive. Twelve polls (~14 s) were too tight to screenshot it.
 */
const FIXTURE_POLLS_BEFORE_COMPLETE = 40;

function fixtureSnapshot() {
  if (providerState.phase === "pending" && ++providerState.polls >= FIXTURE_POLLS_BEFORE_COMPLETE) {
    providerState.phase = "complete";
    providerState.signedIn = true;
  }
  const connected = providerState.signedIn;
  const provider = (id, name, methods, models) => ({
    id, name, methods, accounts: [],
    configured: connected && id === "openai-codex", authenticated: connected && id === "openai-codex",
    selected: connected && id === "openai-codex" ? providerState.selected : [],
    models: id === "openai-codex" ? fixtureModels : models,
  });
  return {
    providers: [
      // PI's openai-codex is OAuth-only: no API-key method, unlike the openai provider beside it.
      provider("openai-codex", "OpenAI Codex", [{ id: "oauth", label: "ChatGPT account" }], fixtureModels),
      provider("openai", "OpenAI", [{ id: "oauth", label: "ChatGPT account" }, { id: "api_key", label: "OpenAI API key" }], [{ id: "gpt-5.1", name: "GPT-5.1" }]),
      provider("anthropic", "Anthropic / Claude Pro & Max", [{ id: "oauth", label: "Claude Pro / Max" }, { id: "api_key", label: "Anthropic API key" }], [{ id: "claude-sonnet-5", name: "Claude Sonnet 5" }]),
      provider("opencode-go", "OpenCode Go", [{ id: "api_key", label: "OpenCode API key" }], [{ id: "kimi-k2", name: "Kimi K2" }]),
      provider("mistral", "Mistral", [{ id: "api_key", label: "Mistral API key" }], [{ id: "mistral-large", name: "Mistral Large" }]),
    ],
    ...(providerState.phase === "idle" ? {} : { login: fixtureLogin() }),
  };
}

async function fixtureProviderRoutes(request, response) {
  const path = (request.url ?? "").split("?")[0];
  if (path === "/__hui/providers" && request.method === "GET") {
    json(response, 200, fixtureSnapshot());
    return true;
  }
  const start = /^\/__hui\/providers\/([a-z0-9-]+)\/login$/u.exec(path);
  if (start && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { flow, method } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    Object.assign(providerState, { phase: "pending", signedIn: false, provider: start[1], flow: method === "api_key" ? "" : flow ?? "browser", polls: 0, selected: [] });
    json(response, 200, fixtureLogin());
    return true;
  }
  const pending = /^\/__hui\/providers\/login\/[^/]+$/u.exec(path);
  if (pending && (request.method === "POST" || request.method === "DELETE")) {
    if (request.method === "DELETE") Object.assign(providerState, { phase: "idle", signedIn: false, polls: 0, selected: [] });
    // An API-key sign-in is done once its prompt is answered; a subscription waits for the poll below.
    else if (!providerState.flow) providerState.phase = "complete";
    if (providerState.phase === "complete") providerState.signedIn = true;
    json(response, 200, { ok: true });
    return true;
  }
  const check = /^\/__hui\/providers\/([a-z0-9-]+)\/test$/u.exec(path);
  if (check && request.method === "POST") {
    json(response, 200, { ok: true, latencyMs: 412 });
    return true;
  }
  const save = /^\/__hui\/providers\/([a-z0-9-]+)$/u.exec(path);
  if (save && request.method === "PUT") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    providerState.selected = Array.isArray(body.models) ? body.models : [];
    // The gateway's save clears the finished login, so a later reload shows the card, not the wizard.
    providerState.phase = "idle";
    json(response, 200, { ok: true });
    return true;
  }
  return false;
}

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
  // The scripted setup keeps the gateway's own header guard: only HUI's own pages ask these routes.
  if (providerFixture && (request.url ?? "").startsWith("/__hui/providers") && request.headers["x-hui"] === "1"
    && await fixtureProviderRoutes(request, response)) return;
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
      plugins: [plugin, huiConfig()],
    })
  : await createServer({
      root: identity.checkout.root,
      configFile: false,
      envDir: false,
      cacheDir: process.env.HUI_VERIFICATION_CACHE,
      logLevel: "warn",
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
      plugins: [plugin, huiConfig()],
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
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("disconnect", stop);
const address = server.httpServer.address();
process.send({ type: "ready", url: `http://127.0.0.1:${address.port}` });
