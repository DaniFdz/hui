/**
 * Finds the ChatGPT/Codex OAuth credential a media request runs on: HUI's own connected accounts first, then PI's
 * agent directory, which is where a `pi` or Codex login already lives. Tokens are refreshed by the same model
 * runtime that refreshes chat credentials, so an expired access token is not a failure here.
 */
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { resolvePiAgentDir } from "../pi/paths.ts";
import { ProviderAccounts } from "../pi/provider-accounts.ts";
import { PROVIDERS_DIR } from "../runtimes/hui-models.ts";
import type { CodexCredential } from "./openai-codex.ts";

export function codexCredentialResolver(options: { dir?: string; agentDir?: string } = {}): () => Promise<CodexCredential | undefined> {
  return async () => {
    const accounts = new ProviderAccounts(options.dir ?? PROVIDERS_DIR);
    for (const account of await accounts.list("openai-codex")) {
      const token = await (await accounts.runtime(account.id)).getAuth("openai-codex")
        .then((resolution) => resolution?.auth?.apiKey).catch(() => undefined);
      if (typeof token === "string" && token) return { accessToken: token };
    }
    const agentDir = options.agentDir ?? resolvePiAgentDir();
    const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false });
    const token = await runtime.getAuth("openai-codex").then((resolution) => resolution?.auth?.apiKey).catch(() => undefined);
    return typeof token === "string" && token ? { accessToken: token } : undefined;
  };
}
