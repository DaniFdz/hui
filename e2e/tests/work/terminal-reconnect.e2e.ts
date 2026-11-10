/** A terminal reconnects to the same shell across a reload and a dropped connection, replays its output, says when
 * the replay was cut, and offers Reconnect when the connection cannot come back (WORK-030). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork, showWork } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
/** Waits for the shell to have started, so its prompt is in the replay before input is typed. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim(), { timeout: 60_000 }).not.toBe("");
const keyboard = (screen: Screen) => screen.getByRole("textbox", "Terminal input", { visible: true });
const run = async (hui: Hui, screen: Screen, command: string) => {
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(keyboard(screen)).toBeFocused();
  await hui.type(`${command}\n`);
};

test("a terminal reconnects to the same shell across a reload and a dropped connection, replays its output, marks a cut replay and offers Reconnect", { tags: ["WORK-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Reconnect a terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const status = (text: string) => pane.getByText(`Shared · ${text}`);
  // A reload draws the app again; a pane that does not come back on its own (a phone leaves the full-screen Work
  // destination for the chat) is shown again with the view it had.
  const ensureTerminal = async () => {
    await expect.poll(() => screen.getByRole("button", "Open terminal").first().isVisible().catch(() => false), { timeout: 60_000 }).toBe(true);
    const shown: Locator = screen.getByText(/^Shared · /u).first();
    if (!(await shown.isVisible().catch(() => false))) await showWork(screen);
  };

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "New terminal");
  await expect(status("Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await run(hui, screen, "printf 'ONCE-%s\\n' 1");
  await expect.poll(() => replay(hui, session.id, id)).toContain("ONCE-1");
  await run(hui, screen, "MARK=kept; printf 'SET %s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("SET kept");

  // The reload brings the same shell back, with its state, without running the earlier command again.
  await hui.reload();
  await ensureTerminal();
  await expect(status("Connected")).toBeVisible();
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([id]);
  await run(hui, screen, "printf 'AFTER-%s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("AFTER-kept");
  expect((await replay(hui, session.id, id)).split("ONCE-1")).toHaveLength(2);

  // More output than the replay keeps is cut, and the terminal says so.
  await run(hui, screen, "for i in $(seq 1 6000); do printf 'PAD-%05d-%s\\n' \"$i\" LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL; done");
  await expect.poll(() => replay(hui, session.id, id), { timeout: 60_000 }).toContain("PAD-06000");
  await hui.reload();
  await ensureTerminal();
  await expect(screen.getByText("Older output was trimmed from the replay.")).toBeVisible();

  // A connection that cannot come back says so, and Reconnect brings the same shell back.
  await hui.network("offline");
  await hui.streamOpen();
  await hui.dropStreams();
  await expect.poll(() => screen.getByRole("button", "Reconnect terminal").isVisible().catch(() => false), { timeout: 45_000 }).toBe(true);
  await expect(status("Disconnected")).toBeVisible();
  await hui.network("online");
  await screen.getByRole("button", "Reconnect terminal").tap();
  await expect(status("Connected")).toBeVisible();
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([id]);
});
