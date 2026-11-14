/**
 * The Appearance → Terminal font reaches terminals that are already open: the shell a conversation's Work pane drew
 * before the change is the same process afterwards, still holds what it printed, and is drawn in the new face
 * (SET-084).
 *
 * The face is read off Gespenst's own hidden input, which it styles with the stack it draws the terminal in, so the
 * check is the terminal's rendering and not the picker's preview. The shell is proved by the pid it printed: a new
 * process would print a different one.
 */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork, reopenWork } from "../work/work-views.ts";

type Terminal = { id: string; title: string; status: "running" | "exited" };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into a terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

/** Whether the host still has the process a shell printed: a restarted shell would print another. */
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** The terminal Gespenst styles with the stack it draws in, which is the face the terminal renders with. */
const face = async (screen: Screen, hui: Hui) => (await hui.look(screen.getByRole("textbox", "Terminal input", { visible: true }))).fonts;

/** Runs a command in the open terminal and waits for the shell to have printed it. */
const run = async (hui: Hui, screen: Screen, session: string, command: string, printed: RegExp) => {
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type(`${command}\n`);
  const [terminal] = await terminals(hui, session);
  await expect.poll(() => replay(hui, session, terminal!.id), { timeout: 60_000 }).toMatch(printed);
};

test("another Terminal font reaches a terminal that is already open: the same shell stays connected with what it printed, drawn in the new face", { tags: ["SET-084"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Terminal font" });
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "New terminal");
  await expect(pane.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute("aria-selected", "true");
  // The shell prints its own pid and a marker, which a terminal that had restarted could not keep.
  await run(hui, screen, session.id, "printf 'FONT-PROOF %s\\n' \"$$\"", /FONT-PROOF \d+/u);
  const [opened] = await terminals(hui, session.id);
  const pid = Number(/FONT-PROOF (\d+)/u.exec(await replay(hui, session.id, opened!.id))![1]);
  expect(alive(pid)).toBe(true);
  // The terminal draws in the default face: the chosen family heads the stack.
  expect((await face(screen, hui))[0]).toBe("JetBrains Mono");

  // Another Terminal font is chosen in Settings → Appearance.
  await hui.open("/settings/appearance");
  const page = screen.getByTestId("settings-page");
  const picker = async (name: string) => {
    await hui.scrollTo(page, screen.getByRole("button", { name: `Terminal font: ${name}` }));
    await screen.getByRole("button", { name: `Terminal font: ${name}` }).tap();
    return screen.getByTestId("picker-list", { visible: true });
  };
  const list = await picker("JetBrains Mono");
  await hui.scrollTo(page, list.getByText("FiraCode Nerd Font Mono", { exact: true }));
  await list.getByText("FiraCode Nerd Font Mono", { exact: true }).tap();
  await expect(screen.getByRole("button", { name: "Terminal font: FiraCode Nerd Font Mono" })).toBeVisible();
  await expect.poll(async () => (await hui.storedAppearance())?.fontTerminal).toBe("FiraCode Nerd Font Mono");
  expect((await hui.api<Record<string, unknown>>("GET", "/__hui/settings")).fontTerminal).toBeUndefined();

  // The same terminal is still there, its shell is the same process, and it keeps what it printed…
  await hui.open(`/sessions/${session.id}`);
  await reopenWork(screen, "Terminal 1");
  await expect(pane.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText(/^Shared · Connected/u)).toBeVisible();
  const [reopened] = await terminals(hui, session.id);
  expect(reopened).toMatchObject({ id: opened!.id, title: "Terminal 1", status: "running" });
  expect(alive(pid)).toBe(true);
  await expect.poll(() => replay(hui, session.id, opened!.id)).toMatch(new RegExp(`FONT-PROOF ${pid}\\r?\\n`, "u"));
  // …and it draws with the face that was chosen.
  await expect.poll(async () => (await face(screen, hui))[0]).toBe("FiraCode Nerd Font Mono");
  expect(await face(screen, hui)).toContain("JetBrains Mono");
});
