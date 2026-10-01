/** Isolated SDK host. PI owns JSONL, sessions and the agent loop; HUI owns
 * composition and a versioned, bounded inspection channel over Node IPC. */
import { createHash } from "node:crypto";
import { Console } from "node:console";
import { createSessionModelRuntime, PROVIDERS_DIR } from "./hui-models.ts";
import { installBrokeredCredentials } from "../worker/credentials.ts";
import { basename } from "node:path";
import {
  createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  runRpcMode, SessionManager, SettingsManager,
  type CreateAgentSessionOptions, type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { huiToolDefinitions } from "./hui-tools.ts";
import { lowestThinkingLevel, withUpstreamThinkingMap } from "./thinking-level.ts";
import { HUI_DEFAULT_PROMPT, HUI_PROMPT_REVISION, huiPromptExtension } from "./hui-prompt.ts";
import { PI_SDK_VERSION } from "./pi-backend.ts";
import { safeSourceLabel } from "../source-label.ts";
import skillPolicyExtension, { disabledSkillsFrom } from "./skill-policy-extension.mjs";
import { createPolicySettingsManager } from "./resource-policy.ts";
import type { RuntimeInspection } from "../../src/lib/tools-types.ts";

type Launch = {
  cwd: string; agentDir: string; sessionFile?: string; model?: string;
  thinking?: CreateAgentSessionOptions["thinkingLevel"]; noSession?: boolean; safeProbe?: boolean;
  /** Utility calls: the cheapest reasoning level the model is actually sent. */
  lowestThinking?: boolean;
  disabledPluginIds?: string[];
  bundledSkillPaths?: string[];
  /** Settings → Tools → Browser; absent means the default (on). */
  browserTool?: boolean;
  /** Extra system prompt sections, e.g. a bot's standing instructions. */
  appendSystemPrompt?: string[];
};

// Extensions sometimes log during initialization, before runRpcMode redirects
// stdout. Reserve stdout exclusively for the RPC transport from process start.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

async function main() {
  // Passed out of argv (see startPi); tools and extensions must not inherit it.
  const launch = JSON.parse(process.env["HUI_PI_WORKER_LAUNCH"] ?? "{}") as Launch;
  delete process.env["HUI_PI_WORKER_LAUNCH"];
  if (!launch.cwd || !launch.agentDir || !process.send) throw new Error("Invalid HUI worker launch.");
  // On a remote worker host, credentials come from the connected gateway.
  if (process.env["HUI_WORKER_BROKER"] === "1") {
    installBrokeredCredentials({ agentDir: launch.agentDir, providersDir: PROVIDERS_DIR, fallbackAuth: process.env["HUI_WORKER_FALLBACK_AUTH"] ?? "" });
    for (const name of ["HUI_WORKER_BROKER", "HUI_WORKER_FALLBACK_AUTH", "HUI_PROVIDERS_DIR"]) delete process.env[name];
  }
  const disabledSkills = new Set((launch.safeProbe ? [] : disabledSkillsFrom(process.env["HUI_DISABLED_SKILLS"])).map((skill) => skill.path));
  const disabledPluginIds = new Set(launch.safeProbe ? [] : launch.disabledPluginIds ?? []);
  // PI clears turn-time prompt overrides when a run settles. Preserve the last
  // assembled turn prompt explicitly instead of presenting the reset base as it.
  const turnPrompts = new WeakMap<AgentSession, string>();
  const runtime = await createAgentSessionRuntime(async (target) => {
    const settingsManager = launch.safeProbe
      ? SettingsManager.inMemory({})
      : createPolicySettingsManager({ cwd: target.cwd, agentDir: target.agentDir, disabledIds: disabledPluginIds });
    const modelRuntime = await createSessionModelRuntime(target.agentDir);
    const services = await createAgentSessionServices({
      modelRuntime,
      cwd: target.cwd, agentDir: target.agentDir,
      // Even a no-extensions loader resolves configured packages. Probe with
      // empty settings as well, so a catalog read cannot install packages.
      settingsManager,
      resourceLoaderOptions: {
        // PI appends additional paths after user/project/package resources,
        // retaining its own first-name-wins override precedence.
        additionalSkillPaths: launch.safeProbe ? [] : launch.bundledSkillPaths ?? [],
        noExtensions: launch.safeProbe, noSkills: launch.safeProbe,
        noContextFiles: launch.safeProbe, noPromptTemplates: launch.safeProbe, noThemes: true,
        systemPromptOverride: (base) => base ?? HUI_DEFAULT_PROMPT,
        // Added after APPEND_SYSTEM.md, which PI still discovers itself.
        ...(launch.appendSystemPrompt?.length && !launch.safeProbe
          ? { appendSystemPromptOverride: (base: string[]) => [...base, ...launch.appendSystemPrompt!] } : {}),
        skillsOverride: (base) => ({ ...base, skills: base.skills.filter((skill) => !disabledSkills.has(skill.filePath)) }),
        extensionFactories: launch.safeProbe ? [] : [huiPromptExtension, skillPolicyExtension],
      },
    });
    const separator = launch.model?.indexOf("/") ?? -1;
    const configured = launch.model && separator > 0
      ? services.modelRuntime.getModel(launch.model.slice(0, separator), launch.model.slice(separator + 1))
      : undefined;
    if (launch.model && !configured) throw new Error(`Unknown PI model: ${launch.model}`);
    const model = configured && launch.lowestThinking
      ? withUpstreamThinkingMap(configured, (provider, id) => services.modelRuntime.getModel(provider, id))
      : configured;
    const thinking = model && launch.lowestThinking ? lowestThinkingLevel(model) : launch.thinking;
    const result = await createAgentSessionFromServices({
      services, sessionManager: target.sessionManager, sessionStartEvent: target.sessionStartEvent,
      ...(model ? { model } : {}), ...(thinking ? { thinkingLevel: thinking } : {}),
      customTools: launch.safeProbe ? [] : huiToolDefinitions({ browser: launch.browserTool !== false }),
    });
    result.session.subscribe((event) => {
      if (event.type === "turn_start" || event.type === "turn_end") turnPrompts.set(result.session, result.session.systemPrompt);
    });
    return { ...result, services, diagnostics: services.diagnostics };
  }, {
    cwd: launch.cwd, agentDir: launch.agentDir,
    sessionManager: launch.noSession ? SessionManager.inMemory(launch.cwd)
      : launch.sessionFile ? SessionManager.open(launch.sessionFile)
      : SessionManager.create(launch.cwd),
  });

  process.on("message", (raw: unknown) => {
    void handleWorkerMessage(raw);
  });

  async function handleWorkerMessage(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    if (typeof message["id"] !== "string") return;
    // Credential brokering has its own listener (worker/credentials.ts).
    if (typeof message["type"] === "string" && message["type"].startsWith("credential")) return;
    try {
      if (message["version"] !== 1) throw new Error("Unsupported HUI worker request.");
      const session = runtime.session;
      if (message["type"] === "abort") {
        await session.abort();
        process.send?.({ version: 1, id: message["id"], type: "ok" });
        return;
      }
      if (message["type"] === "reload") {
        // PI's RPC mode has no /reload; this is the SDK call the TUI makes.
        if (session.isStreaming || session.isCompacting) throw new Error("Wait for the current run to finish before reloading.");
        await session.reload();
        process.send?.({ version: 1, id: message["id"], type: "ok" });
        return;
      }
      if (message["type"] === "rewind") {
        if (session.isStreaming) throw new Error("Wait for the current run to finish before rewinding.");
        const entryId = message["entryId"];
        const entry = typeof entryId === "string" ? session.sessionManager.getEntry(entryId) : undefined;
        if (typeof entryId !== "string" || !entry) {
          throw new Error("That rewind point is no longer available.");
        }
        if (entry.type === "message" && entry.message.role === "user" && message["excludeUserMessage"] !== true) {
          // PI's /tree editor semantics stop before a selected user message.
          // HUI's checkpoint means "after this visible message", so first let
          // PI restore extension/tool state at its parent, then include the
          // already-persisted user entry as the leaf used by Continue.
          if (entry.parentId) await session.navigateTree(entry.parentId);
          session.sessionManager.branch(entryId);
          session.refreshContext();
        } else {
          // PI's native tree editor stops before a selected user entry. This
          // leaves that message out of the active context so HUI can restore
          // its text to the composer for editing, matching OpenClaw rewind.
          await session.navigateTree(entryId);
        }
        process.send?.({ version: 1, id: message["id"], type: "ok" });
        return;
      }
      if (message["type"] === "continue") {
        if (session.isStreaming) throw new Error("That session is already running.");
        let leaf = session.sessionManager.getLeafEntry();
        if (leaf?.type === "message" && leaf.message.role === "assistant") {
          if (leaf.message.stopReason !== "aborted" && leaf.message.stopReason !== "error") {
            throw new Error("The active branch already ends with a completed assistant response.");
          }
          if (!leaf.parentId) throw new Error("There is no earlier context to continue from.");
          session.sessionManager.branch(leaf.parentId);
          session.refreshContext();
          leaf = session.sessionManager.getLeafEntry();
        }
        if (!(leaf?.type === "message" && (leaf.message.role === "user" || leaf.message.role === "toolResult"))) {
          throw new Error("Rewind to a user message or completed tool result before continuing.");
        }
        // Agent.continue() is the SDK's prompt-free continuation primitive. The
        // AgentSession subscriber still persists and emits its ordinary events;
        // HUI acknowledges only after the run has synchronously entered.
        const continuation = session.agent.continue();
        process.send?.({ version: 1, id: message["id"], type: "ok" });
        void continuation.catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (message["type"] !== "inspect") throw new Error("Unsupported HUI worker request.");
      const active = new Set(session.getActiveToolNames());
      const huiNames = new Set(huiToolDefinitions().map((tool) => tool.name));
      const loader = runtime.services.resourceLoader;
      const tools = session.getAllTools().map((tool) => ({
        name: tool.name, description: tool.description,
        source: huiNames.has(tool.name) && tool.sourceInfo.source === "sdk" ? "HUI"
          : tool.sourceInfo.source === "builtin" ? "PI"
          : `${tool.sourceInfo.scope} · ${safeSourceLabel(tool.sourceInfo.source)} · ${safeSourceLabel(tool.sourceInfo.path)}`,
        active: active.has(tool.name), parameters: tool.parameters,
      }));
      const diagnostics = [
        ...runtime.diagnostics.map((item) => item.message),
        ...loader.getExtensions().errors.map((item) => `${basename(item.path)}: ${item.error}`),
        ...(runtime.services.modelRuntime.getError() ? [runtime.services.modelRuntime.getError()!] : []),
        ...(runtime.modelFallbackMessage ? [runtime.modelFallbackMessage] : []),
      ];
      const data = {
        status: "live" as const, backend: "sdk", version: PI_SDK_VERSION, tools,
        prompt: session.isStreaming ? session.systemPrompt : turnPrompts.get(session) ?? session.systemPrompt,
        promptPhase: session.isStreaming ? "current-turn" as const
          : turnPrompts.has(session) ? "last-turn" as const : "initialized" as const,
        promptSource: loader.getSystemPromptSource() ? "SYSTEM.md override" : HUI_PROMPT_REVISION,
        diagnostics,
      };
      const serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized) > 2_000_000) throw new Error("Runtime inspection exceeds the 2 MB limit.");
      const result: RuntimeInspection = { ...data, revision: createHash("sha256").update(serialized).digest("hex").slice(0, 16) };
      process.send?.({ version: 1, id: message["id"], type: "inspection", data: result });
    } catch (error) {
      process.send?.({ version: 1, id: message["id"], type: "error", error: error instanceof Error ? error.message : "Inspection failed." });
    }
  }
  process.on("disconnect", () => { void runtime.dispose().finally(() => process.exit(0)); });
  await runRpcMode(runtime);
}

void main().catch((error: unknown) => {
  process.send?.({ version: 1, type: "fatal", error: error instanceof Error ? error.message : "SDK startup failed." });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  process.disconnect?.();
});
