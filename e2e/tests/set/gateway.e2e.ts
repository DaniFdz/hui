/** Settings → Gateway says Connecting… until the first check, then Connected with the transport, access, uptime, sessions and activity, refreshed on its own; the Connection page shows the same with the PI agent directory and live runtimes, and Refresh reads them again (SET-017). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Health = { transport: string; sessions: { registered: number } };

test("Gateway turns from an amber Connecting… to a green Connected whose runtime values refresh on their own, and the Connection page reads them again on Refresh", { tags: ["SET-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const check = await hui.intercept("GET", /\/__hui\/health$/u);
  await hui.open("/settings/connection");
  await check.arrived();
  const connecting = screen.getByText("Connecting…");
  await expect(connecting).toBeVisible();
  const [r, g, b] = (await hui.look(connecting)).color;
  expect(r - b).toBeGreaterThan(80);
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  await check.deliver();
  const connected = screen.getByText("Connected");
  await expect(connected).toBeVisible();
  const [cr, cg, cb] = (await hui.look(connected)).color;
  expect(cg).toBeGreaterThan(Math.max(cr, cb) + 30);

  const health = await hui.api<Health>("GET", "/__hui/health");
  await expect(screen.getByText(health.transport)).toBeVisible();
  expect(health.transport).toBe("HTTP + SSE");
  await expect(screen.getByText("Full Access")).toBeVisible();
  await expect(screen.getByText(/^(?:\d+s|\d+d(?: \d+h)?(?: \d+m)?|\d+h(?: \d+m)?|\d+m)$/u)).toBeVisible();
  await expect(screen.getByText(String(health.sessions.registered))).toBeVisible();
  await expect(screen.getByText("Idle")).toBeVisible();

  const session = await hui.createSession({ title: "Gateway runtime" });
  await expect(screen.getByText(String(health.sessions.registered + 1))).toBeVisible();
  await hui.prompt(session, "E2E_REPLAY");
  await hui.provider.held();
  await expect(screen.getByText("1 active")).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByText("Idle")).toBeVisible();

  await hui.restartGateway();
  const uptime = screen.getByText(/^\d+s$/u);
  await expect(uptime).toBeVisible();
  const started = await uptime.textContent();
  await expect(uptime).not.toHaveText(started ?? "");

  const { agentDir } = await hui.api<{ agentDir: string }>("GET", "/__hui/pi");
  await hui.open("/connection");
  await expect(screen.getByText(`Connected to this HUI gateway · ${health.transport}`)).toBeVisible();
  await expect(screen.getByText("Connected")).toBeVisible();
  await expect(screen.getByText("Full Access")).toBeVisible();
  await expect(screen.getByText(agentDir)).toBeVisible();
  await expect(screen.getByText(/^\d+s$/u)).toBeVisible();
  await expect(screen.getByText("PI processes currently owned by this gateway.")).toBeVisible();
  const counts = async () => Promise.all((await screen.getByText(/^\d+$/u).all()).map((count) => count.textContent()));
  const { sessions } = await hui.api<Health>("GET", "/__hui/health");
  const number = expect.stringMatching(/^\d+$/u);
  await expect.poll(counts).toEqual([String(sessions.registered), number, number]);

  await hui.createSession({ title: "Gateway runtime again" });
  await screen.getByRole("button", "Refresh").tap();
  await expect.poll(counts).toEqual([String(sessions.registered + 1), number, number]);
});
