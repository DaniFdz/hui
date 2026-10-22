/** Settings → Diagnostics shows the gateway's runtime, activity count and token total, says when it is reading or failed, and "Export JSON" or Logs' and Debug's "Export diagnostics" download a redacted snapshot (SET-074, SET-075). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Snapshot = { retention: { maximum: number }; usage: { totalTokens: number }; debug: Record<string, string> };

test("Diagnostics shows the gateway's platform, Node, activity held out of its limit and tokens, after reading or a failed read retried", { tags: ["SET-074"], platforms: ["web"] }, async ({ screen, hui }) => {
  const read = await hui.intercept("GET", /\/__hui\/observability$/u);
  await hui.open("/settings/diagnostics");
  await read.arrived();
  await expect(screen.getByText(/^Reading diagnostics…/u)).toBeVisible();
  await read.reject(500, "diagnostics are unavailable");
  await expect(screen.getByText(/^diagnostics are unavailable/u)).toBeVisible();
  await expect(screen.getByText(/^Reading diagnostics…/u)).toBeHidden();

  await screen.getByRole("button", "Retry").tap();
  const snapshot = await hui.api<Snapshot>("GET", "/__hui/observability");
  await expect(screen.getByText(`${snapshot.debug["platform"]} · ${snapshot.debug["node"]}`)).toBeVisible();
  await expect(screen.getByText(new RegExp(`^\\d+ / ${snapshot.retention.maximum}$`, "u"))).toBeVisible();
  await expect(screen.getByText(`${snapshot.usage.totalTokens.toLocaleString("en-US")} tokens`)).toBeVisible();
  await expect(screen.getByText(/^diagnostics are unavailable/u)).toBeHidden();
});

test("Export JSON and Logs' and Debug's Export diagnostics download the snapshot without prompts, tool payloads or credentials, and a failed export says why", { tags: ["SET-075"], platforms: ["web"] }, async ({ screen, hui }) => {
  const secret = "password=hunter2-diagnostics-secret";
  const payload = "diagnostics-tool-payload-5521";
  const call = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "bash", input: { command: `echo ${payload}` } })).toString("base64url")}`;
  const session = await hui.createSession({ title: "Diagnostics export" });
  await hui.prompt(session, `Keep ${secret} out of exports ${call}`);
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByText(`tool answered: ${payload}`)).toBeVisible();

  const exported = async (button: string) => {
    const file = await hui.download(screen.getByRole("button", button));
    expect(file.name).toMatch(/^hui-diagnostics-\d{4}-\d{2}-\d{2}\.json$/u);
    const snapshot = JSON.parse(file.text) as Record<string, unknown>;
    expect(Object.keys(snapshot)).toEqual(expect.arrayContaining(["activity", "logs", "debug", "usage"]));
    expect(snapshot["debug"]).toEqual(expect.objectContaining({ memory: expect.any(Object), uptimeSeconds: expect.any(Number) }));
    for (const kept of [secret, "hunter2", payload, "e2e-not-a-secret"]) expect(file.text).not.toContain(kept);
  };

  const refused = async (button: string, error: string) => {
    const request = await hui.intercept("GET", /\/__hui\/diagnostics\/export$/u);
    await screen.getByRole("button", button).tap();
    await request.reject(500, error);
    await expect(screen.getByText(new RegExp(`^${error}`, "u"))).toBeVisible();
  };

  await hui.open("/settings/diagnostics");
  await exported("Export JSON");
  await refused("Export JSON", "settings export failed");
  await hui.open("/logs");
  await exported("Export diagnostics");
  await refused("Export diagnostics", "logs export failed");
  await hui.open("/debug");
  await exported("Export diagnostics");
  await refused("Export diagnostics", "debug export failed");
});
