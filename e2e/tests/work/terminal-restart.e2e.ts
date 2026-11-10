/** A gateway restart ends the shells it knew: the tab it leaves behind says its terminal is not there instead of
 * opening a replacement shell, and New terminal opens one that works (WORK-031). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

/** Waits for the shell to have started, so its prompt is in the replay before input is typed. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim(), { timeout: 60_000 }).not.toBe("");

/** Taps the terminal, waits for its emulator to hold the keyboard, then types a line and Enter. */
const run = async (hui: Hui, screen: Screen, command: string) => {
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type(`${command}\n`);
};

test("after a gateway restart an old terminal tab reports its terminal is gone instead of recreating the shell, and New terminal opens a working one", { tags: ["WORK-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal after a restart", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  // The restart leaves the tab in place, naming the shell it lost, and opens no shell in its place.
  await hui.restartGateway();
  await hui.reload();
  await expect(pane.getByText(/Terminal not found in this conversation\./u)).toBeVisible({ timeout: 90_000 });
  await expect(pane.getByRole("tab", "Terminal", { exact: true })).toBeVisible();
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(0);

  // New terminal opens a shell of its own, which runs what is typed into it.
  await openWork(screen, "New terminal");
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  // The old tab is still there, naming the shell the restart took away.
  await expect(pane.getByRole("tab", "Terminal", { exact: true })).toBeVisible();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const shells = await terminals(hui, session.id);
  expect(shells).toHaveLength(1);
  expect(shells[0]!.id).not.toBe(id);
  await ready(hui, session.id, shells[0]!.id);
  await run(hui, screen, "printf 'AFTER-RESTART\\n'");
  await expect.poll(async () => replay(hui, session.id, shells[0]!.id)).toContain("AFTER-RESTART");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
});
