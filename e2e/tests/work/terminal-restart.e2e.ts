/** A gateway restart ends the shells it knew: the tab it leaves behind says its terminal is not there instead of
 * opening a replacement shell, it says so on its own, and New terminal opens one that works under a name no other tab
 * of the conversation already shows (WORK-031). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork, reopenWork } from "./work-views.ts";

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

test("after a gateway restart the open terminal tab reports its shell is gone by itself, and New terminal opens a working one under a name no tab already shows", { tags: ["WORK-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal after a restart", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();

  // The restart leaves the tab in place, naming the shell it lost. No reload and no press: the tab keeps asking the
  // gateway as it comes back, and reports the answer that ends it instead of opening a shell in its place.
  await hui.restartGateway();
  await expect(pane.getByText(/Terminal not found in this conversation\./u)).toBeVisible({ timeout: 90_000 });
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await expect(pane.getByText("Shared · Disconnected")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(0);

  // New terminal opens a shell of its own under the next free name, since that tab still shows "Terminal 1".
  await openWork(screen, "New terminal");
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const shells = await terminals(hui, session.id);
  expect(shells).toHaveLength(1);
  expect(shells[0]!.id).not.toBe(id);
  expect(shells[0]!.title).toBe("Terminal 2");
  await ready(hui, session.id, shells[0]!.id);
  await run(hui, screen, "printf 'AFTER-RESTART\\n'");
  await expect.poll(async () => replay(hui, session.id, shells[0]!.id)).toContain("AFTER-RESTART");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();

  // A reload still finds that shell and keeps the two names apart.
  await hui.reload();
  await reopenWork(screen, "Terminal 2");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  await expect(pane.getByRole("tab", "Terminal 2")).toBeVisible();
});
