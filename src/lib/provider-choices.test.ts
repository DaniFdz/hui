import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProviderLoginFailure, ProviderTestFailure } from "../api/schema/providers.ts";
import type { ProviderSummary } from "../api/schema/providers.ts";
import {
  alternateFlow,
  brandHint,
  connectionMethods,
  connectionName,
  defaultFlow,
  expiresInMinutes,
  filterModels,
  flowSwitchLabel,
  loginFailure,
  manualEntryCopy,
  modelsForStep,
  modelsToSave,
  providerBrand,
  providerBrands,
  signInHost,
  testFailure,
  useModelRoles,
} from "./provider-choices.ts";

const provider = (id: string, methods: ("oauth" | "api_key")[], extra: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id, name: id, configured: false, authenticated: false, selected: [], models: [],
  methods: methods.map((method) => ({ id: method, label: method })),
  ...extra,
});

const catalog = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));

test("OpenAI lists one plain ChatGPT account and one all-model ChatGPT account with distinct hints", () => {
  const methods = connectionMethods("openai", [provider("openai", ["oauth", "api_key"]), provider("openai-codex", ["oauth"])]);
  assert.deepEqual(methods.map(({ provider: entry, method, label }) => [entry.id, method, label]), [
    ["openai-codex", "oauth", "ChatGPT account"],
    ["openai", "oauth", "ChatGPT account · all GPT models"],
    ["openai", "api_key", "API key"],
  ]);
  assert.equal(methods.filter((entry) => entry.label === "ChatGPT account").length, 1);
  assert.deepEqual(methods.slice(0, 2).map((entry) => entry.hint), [
    "Codex models, Calls with GPT-Live, and usage limits.",
    "Every GPT model OpenAI lists. No Calls or usage limits.",
  ]);
  assert.notEqual(methods[0]!.hint, methods[1]!.hint);
  assert.notEqual(connectionName(methods[0]!.provider), connectionName(methods[1]!.provider));
});

test("Claude offers its subscription before its API key, and each says what it costs", () => {
  const methods = connectionMethods("anthropic", [provider("anthropic", ["oauth", "api_key"]), provider("claude-code", [])]);
  assert.deepEqual(methods.map(({ provider: entry, method, label }) => [entry.id, method, label]), [
    ["anthropic", "oauth", "Claude Pro / Max"],
    ["anthropic", "api_key", "API key"],
  ]);
  assert.deepEqual(methods.map((entry) => entry.hint), ["Sign in with your Claude subscription.", "Pay per use with an Anthropic API key."]);
  assert.equal(methods[0]!.hint, "Sign in with your Claude subscription.");
  assert.equal(providerBrand("anthropic")?.name, "Claude");
  assert.equal(providerBrand("claude-code"), undefined);
});

test("the wizard lists OpenAI, Claude, OpenCode Go and Mistral, and derives each hint from its methods", () => {
  assert.deepEqual(providerBrands.map((brand) => brand.name), ["OpenAI", "Claude", "OpenCode Go", "Mistral"]);
  const all = [provider("openai", ["oauth", "api_key"]), provider("openai-codex", ["oauth"]), provider("anthropic", ["oauth", "api_key"]), provider("opencode-go", ["api_key"]), provider("mistral", ["api_key"])];
  assert.equal(brandHint("openai", all), "ChatGPT account or API key.");
  assert.equal(brandHint("anthropic", all), "Claude subscription or API key.");
  assert.equal(brandHint("opencode-go", all), "Use your OpenCode Go subscription.");
  assert.equal(brandHint("mistral", all), "Use your Mistral plan and its API credits.");
  assert.equal(brandHint("openai", []), "", "a brand with no available method has no hint");
  assert.deepEqual(connectionMethods("openai", []), []);
  assert.equal(providerBrand("custom-provider"), undefined);
});

test("OpenCode Go and Mistral keep their API-key method and hint", () => {
  const providers = [provider("opencode-go", ["api_key"]), provider("mistral", ["api_key"]), provider("opencode", ["api_key"]), provider("mistral-zen", ["api_key"])];
  for (const brand of ["opencode-go", "mistral"]) {
    const methods = connectionMethods(brand, providers);
    assert.deepEqual(methods.map(({ provider: entry, method, label, hint }) => [entry.id, method, label, hint]), [
      [(brand === "mistral" ? "mistral" : "opencode-go"), "api_key", "API key", "Enter a key saved securely by HUI."],
    ]);
  }
});

test("existing legacy connections can reconnect without adding another brand to the picker", () => {
  const legacy = provider("opencode", ["api_key"], { configured: true });
  assert.equal(connectionMethods("opencode", [legacy])[0]?.provider.id, "opencode");
  assert.equal(providerBrand("opencode"), undefined);
});

test("a loopback page signs in through the browser, a remote one through the provider's code flow", () => {
  assert.equal(defaultFlow("openai-codex", "http://localhost:5173"), "browser");
  assert.equal(defaultFlow("openai-codex", "http://127.0.0.1:5173"), "browser");
  assert.equal(defaultFlow("openai-codex", "http://[::1]:5173"), "browser");
  assert.equal(defaultFlow("openai-codex", "https://hui.example.com"), "device_code");
  assert.equal(defaultFlow("anthropic", "https://hui.example.com"), "copy_code");
  assert.equal(defaultFlow("anthropic", "http://localhost:5173"), "browser");
  assert.equal(defaultFlow("openai", "https://hui.example.com"), "browser", "the all-model route has only a browser callback");
  assert.equal(defaultFlow("openai", "not a url"), "browser", "an unreadable origin cannot host a callback, but the route has no code flow");
});

test("the flow switch offers the flow a sign-in is not using", () => {
  assert.equal(flowSwitchLabel("browser"), "Use a code instead");
  assert.equal(flowSwitchLabel("device_code"), "Sign in in this browser instead");
  assert.equal(flowSwitchLabel("copy_code"), "Sign in in this browser instead");
  assert.equal(alternateFlow("openai-codex", "browser"), "device_code");
  assert.equal(alternateFlow("openai-codex", "device_code"), "browser");
  assert.equal(alternateFlow("anthropic", "browser"), "copy_code");
  assert.equal(alternateFlow("anthropic", "copy_code"), "browser");
  assert.equal(alternateFlow("openai", "browser"), undefined, "a route with one flow shows no switch");
});

test("the paste field says what to paste, and OpenAI's route needs the whole callback address", () => {
  const openai = manualEntryCopy("openai", "browser");
  assert.equal(openai.placeholder, "Paste the whole address, starting with http://localhost");
  assert.match(openai.hint, /full callback address is required/u);
  for (const id of ["openai-codex", "anthropic"]) {
    const copy = manualEntryCopy(id, "browser");
    assert.equal(copy.placeholder, "Paste the whole address, starting with http://localhost");
    assert.match(copy.hint, /code or the full callback address/u);
  }
  const claude = manualEntryCopy("anthropic", "copy_code");
  assert.equal(claude.label, "Code from Anthropic");
  assert.match(claude.hint, /^Paste the code Anthropic shows after you sign in\.$/u);
});

test("every stopped sign-in reason has its own title and sentence", () => {
  const reasons: ProviderLoginFailure[] = ["cancelled", "expired", "stale_link", "port_in_use", "network", "unknown"];
  const copy = reasons.map((reason) => loginFailure(reason));
  assert.deepEqual(copy.map((entry) => entry.title), ["Sign-in cancelled", "Sign-in expired", "Sign-in link already used", "Sign-in port in use", "Connection problem", "Sign-in failed"]);
  for (const entry of copy) assert.match(entry.sentence, /\.$/u);
  assert.equal(new Set(copy.map((entry) => entry.sentence)).size, reasons.length, "no reason falls back to another's sentence");
  assert.equal(loginFailure("port_in_use").sentence, "The local sign-in port is already in use. Close other sign-ins or the Codex CLI, then try again.");
  assert.equal(loginFailure("stale_link").sentence, "That sign-in link was already used. Start again to get a fresh one.");
  assert.equal(loginFailure("network").sentence, "HUI could not reach the provider. Check the connection and try again.");
  assert.deepEqual(loginFailure(undefined), loginFailure("unknown"));
});

test("every failed model check has its own category and guidance", () => {
  const reasons: ProviderTestFailure[] = ["auth", "rate_limit", "billing", "timeout", "format", "unavailable", "unknown"];
  const copy = reasons.map((reason) => testFailure(reason));
  assert.deepEqual(copy.map((entry) => entry.title), ["Authentication failed", "Rate limited", "Billing problem", "Timed out", "Invalid response", "Unavailable", "Connection failed"]);
  for (const entry of copy) assert.match(entry.guidance, /\.$/u);
  assert.equal(new Set(copy.map((entry) => entry.guidance)).size, reasons.length);
  assert.deepEqual(testFailure(undefined), testFailure("unknown"));
});

test("a completed sign-in with an empty selection saves exactly one model", () => {
  const step = modelsForStep(catalog("gpt-5", "gpt-5-mini"), []);
  assert.equal(step.selected, "gpt-5", "the first model is preselected");
  assert.deepEqual(step.saved, ["gpt-5"]);
  assert.equal(step.saved.length, 1);
});

test("a reconnect keeps the models it already had and adds the one it holds", () => {
  const models = catalog("a", "b", "c");
  const reconnect = modelsForStep(models, ["a", "b"], "c");
  assert.equal(reconnect.selected, "c");
  assert.deepEqual(reconnect.saved, ["a", "b", "c"], "the saved selection is never narrowed");
  assert.deepEqual(modelsForStep(models, ["a", "b"], "a").saved, ["a", "b"], "a model that is already saved adds nothing");
  assert.deepEqual(modelsForStep(models, ["gone"], "b").saved, ["b"], "a saved model the catalog dropped cannot be written back");
  assert.deepEqual(modelsToSave([], "a"), ["a"], "a new connection saves exactly one model");
  assert.deepEqual(modelsToSave(["a"], ""), [], "nothing is written without a model");
  assert.deepEqual(modelsToSave(["a", "b"], "b"), ["a", "b"], "the union never repeats a model");
});

test("the model step keeps a saved or chosen model and never invents one", () => {
  assert.equal(modelsForStep(catalog("a", "b"), ["b"]).selected, "b");
  assert.equal(modelsForStep(catalog("a", "b"), ["gone"], "b").selected, "b");
  assert.equal(modelsForStep(catalog("a", "b"), ["gone"]).selected, "a", "a saved model no longer in the catalog is replaced");
  const empty = modelsForStep([], ["a"], "b");
  assert.deepEqual(empty.saved, [], "a provider with no model writes no empty selection");
  assert.deepEqual(filterModels(catalog("gpt-5", "claude-4"), "GPT").map((model) => model.id), ["gpt-5"]);
  assert.equal(filterModels(catalog("a"), "").length, 1);
});

test("a checked model fills only the roles that are still empty", () => {
  assert.deepEqual(useModelRoles({ primary: "", utility: "" }, "openai/gpt-5"), {
    primary: "openai/gpt-5", utility: "openai/gpt-5", assignedPrimary: true, assignedUtility: true,
  });
  const kept = useModelRoles({ primary: "anthropic/claude", utility: "" }, "openai/gpt-5");
  assert.equal(kept.primary, "anthropic/claude", "an existing primary is never overwritten");
  assert.equal(kept.utility, "openai/gpt-5");
  assert.equal(kept.assignedPrimary, false);
  assert.equal(kept.assignedUtility, true);
  assert.deepEqual(useModelRoles({ primary: "a", utility: "b" }, "c"), { primary: "a", utility: "b", assignedPrimary: false, assignedUtility: false });
});

test("a device code names its page and counts down from the gateway's own expiry", () => {
  assert.equal(signInHost("https://auth.openai.com/codex/device"), "auth.openai.com/codex/device");
  assert.equal(signInHost(undefined), "the sign-in page");
  const started = Date.parse("2026-11-14T10:00:00Z");
  assert.equal(expiresInMinutes({ expiresAt: started + 900_000 }, started, started), 15, "PI's own lifetime is used as given");
  assert.equal(expiresInMinutes({ expiresAt: started + 900_000 }, started, started + 14 * 60_000 + 1), 1);
  assert.equal(expiresInMinutes({ expiresAt: started + 900_000 }, started, started + 20 * 60_000), 0, "an expired code counts no minutes");
  // A payload without an expiry (an older gateway) keeps the estimate HUI always had.
  assert.equal(expiresInMinutes({}, started, started), 15);
  assert.equal(expiresInMinutes({}, started, started + 14 * 60_000 + 1), 1);
  assert.equal(expiresInMinutes({}, started, started + 20 * 60_000), 0);
});
