/** A shared terminal whose tab was closed (WORK-028) and what an old terminal tab says after the gateway restarted
 * (WORK-031). The shell's own output is read from the gateway's replay of the terminal, as in the rest of the suite. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string; title: string; status: "running" | "exited" };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
/** Waits for the shell to have started, so its prompt is in the replay before input is typed. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim(), { timeout: 60_000 }).not.toBe("");

test("closing a terminal tab leaves its shell running, its launcher lists it under Running, and choosing it reopens the same shell with its state", { tags: ["WORK-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Reopen a shell", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type("MARK=kept; printf 'SET %s\\n' \"$MARK\"\n");
  await expect.poll(() => replay(hui, session.id, id)).toContain("SET kept");

  await pane.getByRole("button", "Close Terminal 1").tap();
  await expect(pane.getByRole("tab")).toHaveCount(0);
  expect((await terminals(hui, session.id))[0]?.status).toBe("running");

  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await expect(screen.getByText("Running").first()).toBeVisible();
  await screen.getByText("Terminal 1", { visible: true }).tap();

  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  expect((await terminals(hui, session.id)).map(({ id: kept }) => kept)).toEqual([id]);

  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type("printf 'MARK is %s\\n' \"$MARK\"\n");
  await expect.poll(() => replay(hui, session.id, id)).toContain("MARK is kept");
});

test("after a gateway restart an old terminal tab reports that its terminal is unavailable and New terminal opens a working one", { tags: ["WORK-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Recover a terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await hui.restartGateway();
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible({ timeout: 60_000 });
  await expect(pane.getByRole("button", "Reconnect terminal")).toBeVisible();
  expect(await terminals(hui, session.id)).toEqual([]);

  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(/⌥⇧⌘T|Ctrl\+Alt\+Shift\+T/u).first().tap();
  await expect(pane.getByRole("tab")).toHaveCount(2);
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const [replacement] = await terminals(hui, session.id);
  expect(replacement?.status).toBe("running");
  await ready(hui, session.id, replacement!.id);
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type("echo AFTER-RESTART\n");
  await expect.poll(() => replay(hui, session.id, replacement!.id)).toContain("AFTER-RESTART");
});
