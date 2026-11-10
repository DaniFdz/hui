/** After a gateway restart an old terminal tab reports that its terminal is gone instead of bringing a shell back,
 * and New terminal opens a working one (WORK-031). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited" };
const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
const keyboard = (screen: Screen) => screen.getByRole("textbox", "Terminal input", { visible: true });
const started = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim(), { timeout: 60_000 }).not.toBe("");

test("after a gateway restart the old terminal tab reports its terminal is gone, and New terminal opens a working one", { tags: ["WORK-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal after restart", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "New terminal");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await started(hui, session.id, id);

  // The restart takes the shell with it. The tab stays, its connection gone, and no shell is brought back.
  await hui.restartGateway();
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible();
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await expect(pane.getByRole("button", "Reconnect terminal")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(0);

  // Asking for it back names why it cannot come back, and still starts no shell.
  await screen.getByRole("button", "Reconnect terminal").tap();
  await expect(pane.getByText("Terminal not found in this conversation.")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(0);

  // New terminal opens one that works.
  await openWork(screen, "New terminal");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const fresh = (await terminals(hui, session.id))[0]!;
  expect(fresh.id).not.toBe(id);
  await started(hui, session.id, fresh.id);
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(keyboard(screen)).toBeFocused();
  await hui.type("printf 'FRESH-%s\\n' 1\n");
  await expect.poll(() => replay(hui, session.id, fresh.id)).toContain("FRESH-1");
});
