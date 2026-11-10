/** After a gateway restart an old terminal tab reports that its terminal is gone instead of recreating the shell, and
 * New terminal opens a working one (WORK-031). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

test("an old terminal tab reports its terminal unavailable after a gateway restart instead of recreating the shell, and New terminal opens a working one", { tags: ["WORK-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Restarted terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const status = (text: string) => pane.getByText(`Shared · ${text}`);
  const alert = pane.getByRole("alert");
  const run = async (command: string) => {
    await screen.getByLabel("Shared terminal input", { visible: true }).tap();
    await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
    await hui.type(`${command}\n`);
  };

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "New terminal");
  await expect(status("Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await expect.poll(async () => (await replay(hui, session.id, id)).trim(), { timeout: 60_000 }).not.toBe("");
  await run("printf 'BEFORE-%s\\n' 1");
  await expect.poll(() => replay(hui, session.id, id)).toContain("BEFORE-1");

  // The gateway comes back with no shells at all, and the tab's terminal is not one of its own to make again.
  await hui.restartGateway();
  await expect(status("Disconnected")).toBeVisible();
  await expect(alert).toBeVisible();
  expect(await terminals(hui, session.id)).toEqual([]);

  // Asking it to come back names the missing shell instead of opening a new one.
  await screen.getByRole("button", "Reconnect terminal").tap();
  await expect(alert).toHaveText(/^Terminal not found in this conversation\.$/u);
  expect(await terminals(hui, session.id)).toEqual([]);

  // New terminal opens a working shell of its own, and the old tab stays as it was.
  await openWork(screen, "New terminal");
  await expect(status("Connected")).toBeVisible();
  const fresh = await terminals(hui, session.id);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]!.id).not.toBe(id);
  await expect.poll(async () => (await replay(hui, session.id, fresh[0]!.id)).trim(), { timeout: 60_000 }).not.toBe("");
  await run("printf 'AFTER-%s\\n' 1");
  await expect.poll(() => replay(hui, session.id, fresh[0]!.id)).toContain("AFTER-1");

  // The restarted gateway numbers its first shell 1 again, so both tabs read Terminal 1; the old one is the first.
  await pane.getByRole("tab").first().tap();
  await expect(alert).toHaveText(/^Terminal not found in this conversation\.$/u);
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([fresh[0]!.id]);
});
