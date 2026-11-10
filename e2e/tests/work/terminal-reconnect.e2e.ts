/** A terminal reconnects to the same shell across a reload and a dropped connection, replays its output, says when the
 * replay was cut, and offers Reconnect when the connection cannot come back (WORK-030). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
/** Waits for the shell to have started, so its prompt is in the replay before input is typed. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim(), { timeout: 60_000 }).not.toBe("");
const keyboard = (screen: Screen) => screen.getByRole("textbox", "Terminal input", { visible: true });

test("a terminal reconnects to the same shell across a reload and a dropped connection, replays its output, marks a cut replay and offers Reconnect", { tags: ["WORK-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Reconnect a terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const status = (text: string) => pane.getByText(`Shared · ${text}`);
  const prompt = screen.getByLabel("Shared terminal input", { visible: true });
  const run = async (command: string) => {
    await prompt.tap();
    await expect(keyboard(screen)).toBeFocused();
    await hui.type(`${command}\n`);
  };

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "New terminal");
  await expect(status("Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await run("printf 'ONCE-%s\\n' 1");
  await expect.poll(() => replay(hui, session.id, id)).toContain("ONCE-1");
  await run("MARK=kept; printf 'SET %s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("SET kept");

  // A reload brings the same shell back with its state, and without running the earlier command again.
  await hui.reload();
  await expect(status("Connected")).toBeVisible();
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([id]);
  await run("printf 'AFTER-%s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("AFTER-kept");
  expect((await replay(hui, session.id, id)).split("ONCE-1")).toHaveLength(2);

  // A connection that drops comes back by itself, to the same shell, with what it had printed.
  await hui.streamOpen();
  await hui.dropStreams();
  await expect(status("Connected")).toBeVisible();
  await run("printf 'DROPPED-%s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("DROPPED-kept");
  expect((await replay(hui, session.id, id)).split("ONCE-1")).toHaveLength(2);

  // More output than the replay keeps is cut, and the terminal says so.
  await run("for i in $(seq 1 6000); do printf 'PAD-%05d-%s\\n' \"$i\" LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL; done");
  await expect.poll(() => replay(hui, session.id, id), { timeout: 60_000 }).toContain("PAD-06000");
  await hui.reload();
  await expect(screen.getByText("Older output was trimmed from the replay.")).toBeVisible();

  // A connection that cannot come back says so, and Reconnect brings the same shell back.
  await hui.streamOpen();
  await hui.network("offline");
  await hui.dropStreams();
  await expect(screen.getByRole("button", "Reconnect terminal")).toBeVisible();
  await expect(status("Disconnected")).toBeVisible();
  await hui.network("online");
  await screen.getByRole("button", "Reconnect terminal").tap();
  await expect(status("Connected")).toBeVisible();
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([id]);
  await run("printf 'BACK-%s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, id)).toContain("BACK-kept");
});
