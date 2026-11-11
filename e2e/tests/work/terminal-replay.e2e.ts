/** A terminal keeps its shell across a reload and a lost connection: the tab comes back on the same shell with its
 * output and state and without resending input, "Older output was trimmed from the replay." says when the replay was
 * cut, and a connection that cannot come back reads Disconnected with Reconnect terminal (WORK-030). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openTerminalView } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string; truncated: boolean }>("GET", `/__hui/sessions/${session}/terminals/${id}`);
const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);

/** Waits for the shell to have started, so its prompt is in the replay before input is typed. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).data.trim(), { timeout: 60_000 }).not.toBe("");

/** Taps the terminal, waits for its emulator to hold the keyboard, then types a line and Enter, the way the operator
 * does. */
const run = async (hui: Hui, screen: Screen, command: string) => {
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type(`${command}\n`);
};

test("a terminal comes back on the same shell after a reload, says when its replay was cut, and reads Disconnected with Reconnect terminal once the gateway took its shell away", { tags: ["WORK-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Keep a terminal's output", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  // A shell variable and a marker with output of their own.
  await run(hui, screen, "MARK=kept; printf 'MARK-one\\n'");
  await expect.poll(async () => (await replay(hui, session.id, id)).data).toContain("MARK-one");
  const printed = (await replay(hui, session.id, id)).data.split("MARK-one").length - 1;

  // The reload comes back on the same shell, with its output already there and nothing typed again.
  await hui.reload();
  // A phone lands on the chat and reaches the pane's views from the Active panel selector again.
  await openTerminalView(screen);
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(1);
  expect((await terminals(hui, session.id))[0]!.id).toBe(id);
  expect((await replay(hui, session.id, id)).data.split("MARK-one").length - 1).toBe(printed);

  // The same shell still holds the variable the operator set before the reload.
  await run(hui, screen, "printf 'V%s\\n' \"$MARK\"");
  await expect.poll(async () => (await replay(hui, session.id, id)).data).toContain("Vkept");

  // More output than the replay keeps: the next connection says the oldest of it was dropped.
  await run(hui, screen, "seq 1 60000");
  await expect.poll(async () => (await replay(hui, session.id, id)).truncated, { timeout: 60_000 }).toBe(true);
  await hui.reload();
  await openTerminalView(screen);
  await expect(pane.getByText("Older output was trimmed from the replay.")).toBeVisible();

  // The gateway restarts and that shell cannot come back: the tab says so and offers its own reconnect.
  await hui.restartGateway();
  const reconnect = screen.getByRole("button", "Reconnect terminal");
  await expect(reconnect).toBeVisible({ timeout: 90_000 });
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible();
  await reconnect.tap();
  await expect(reconnect).toBeVisible({ timeout: 30_000 });
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible();
});
