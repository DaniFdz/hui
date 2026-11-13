/** Settings → Models starts a custom PI provider's machine on demand, and a chat sent meanwhile waits for it (SET-098). */
import { expect } from "e2e";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "../../fixtures/hui.ts";
import type { LocalProviderSnapshot } from "../../../src/api/schema/local-providers.ts";

function body(request: AsyncIterable<Buffer>): Promise<Buffer> {
  return (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  })();
}

test("a local model server starts on demand and a chat waits for it", { tags: ["SET-098"], platforms: ["web"] }, async ({ screen, hui }) => {
  const release = join(hui.workspace, "local-model-ready");
  const modelsPath = join(hui.piAgentDir, "models.json");
  const original = await readFile(modelsPath, "utf8");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET") {
      response.writeHead(existsSync(release) ? 200 : 503);
      response.end();
      return;
    }
    const headers = Object.fromEntries(Object.entries(request.headers)
      .filter(([name]) => !["host", "content-length", "connection", "transfer-encoding"].includes(name))
      .flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]]));
    try {
      const upstream = await fetch(`${hui.provider.url}${url.pathname}`, { method: request.method, headers, body: (await body(request)).toString("utf8") });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "local fixture failed" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The local model fixture did not bind a port.");
  const local = JSON.parse(original) as { providers: Record<string, unknown> };
  local.providers["local-e2e"] = {
    name: "Local fixture",
    baseUrl: `http://127.0.0.1:${address.port}`,
    api: "anthropic-messages",
    apiKey: "e2e-not-a-secret",
    models: [{
      id: "fixture", name: "Local fixture model", reasoning: true, input: ["text"],
      contextWindow: 200_000, maxTokens: 4_096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  };

  try {
    await writeFile(modelsPath, JSON.stringify(local, null, 2));
    await hui.open("/settings/models");
    // The Models page renders its provider area before the PI snapshot settles;
    // wait for the routing section so the page does not replace the group mid-edit.
    await expect(screen.getByText("HUI model routing", { exact: true })).toBeVisible();
    const group = screen.getByText("Local model servers", { exact: true });
    await expect(group).toBeVisible();
    await group.tap();
    const card = screen.getByTestId("local-provider").filter({ hasText: "local-e2e" });
    await expect(card.getByText("Offline", { exact: true })).toBeVisible();

    await card.getByRole("button", "Set up start command").tap();
    const dialog = screen.getByTestId("local-provider-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", "Close start command dialog")).toBeVisible();
    await dialog.getByLabel(/Start command/u).fill(`while [ ! -e '${release}' ]; do sleep 0.05; done`);
    await dialog.getByLabel(/Health URL/u).fill(`http://127.0.0.1:${address.port}`);
    await dialog.getByLabel(/Ready timeout/u).fill("30");
    await dialog.getByRole("button", "Save command").tap();
    await expect(screen.getByText("Start command saved for Local fixture.", { exact: true })).toBeVisible();

    await card.getByRole("button", "Start server").tap();
    await expect(card.getByText("Starting…", { exact: true }).first()).toBeVisible();

    const session = await hui.createSession({ title: "Local model", model: "local-e2e/fixture" });
    await hui.open(`/sessions/${session.id}`);
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await hui.prompt(session, "Hello local model");
    await expect(screen.getByText("Waiting for Local fixture to start…", { exact: true })).toBeVisible();
    await writeFile(release, "");
    await expect(screen.getByText("Fixture response.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

    await hui.open("/settings/models");
    await expect(screen.getByText("HUI model routing", { exact: true })).toBeVisible();
    const reopened = screen.getByText("Local model servers", { exact: true });
    await expect(reopened).toBeVisible();
    await reopened.tap();
    const online = screen.getByTestId("local-provider").filter({ hasText: "local-e2e" });
    await expect(online.getByText("Online", { exact: true })).toBeVisible();
    const snapshot = await hui.api<LocalProviderSnapshot>("GET", "/__hui/local-providers");
    const view = snapshot.providers.find((provider) => provider.id === "local-e2e");
    expect(view).toMatchObject({ configured: true, hasEndpoint: true, inPi: true, status: "online" });

    await online.getByRole("button", "Remove command").tap();
    await expect(online.getByText(/Remove the start command\?/u)).toBeVisible();
    await online.getByRole("button", "Keep command").tap();
    await expect(online.getByRole("button", "Edit command")).toBeVisible();
    await online.getByRole("button", "Remove command").tap();
    await online.getByRole("button", "Confirm removal").tap();
    await expect(screen.getByText("Start command removed for Local fixture.", { exact: true })).toBeVisible();
    await expect(online.getByRole("button", "Set up start command")).toBeVisible();
  } finally {
    await writeFile(modelsPath, original);
    await hui.api("DELETE", "/__hui/local-providers/local-e2e").catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
