/** Choosing another Terminal font leaves every open shared terminal attached to the same shell, with what it showed:
 * the same terminals, the same shell processes and their output, and a shell that still answers (SET-084). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed, kept across a font change. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
const keyboard = (screen: Screen) => screen.getByRole("textbox", "Terminal input", { visible: true });
const run = async (hui: Hui, screen: Screen, command: string) => {
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await expect(keyboard(screen)).toBeFocused();
  await hui.type(`${command}\n`);
};
/** A shell's own pid, printed by that shell: the number survives only if the shell is never restarted. */
const pidIn = (data: string) => Number(/SHELL (\d+)/u.exec(data)?.[1] ?? 0);
/** A + menu entry, found by the shortcut only that kind shows. */
const item = (screen: Pick<Locator, "getByText">, key: string) => screen.getByText(new RegExp(`(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)${key}`, "u"));

test("choosing another Terminal font keeps every open shared terminal on its own shell, with its output, without a restart", { tags: ["SET-084"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal font", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected", { visible: true })).toBeVisible();
  const first = (await terminals(hui, session.id))[0]!;
  await expect.poll(async () => (await replay(hui, session.id, first.id)).trim(), { timeout: 60_000 }).not.toBe("");
  await run(hui, screen, "printf 'SHELL %s\\n' \"$$\"; printf 'KEPT %s\\n' first");
  await expect.poll(() => replay(hui, session.id, first.id)).toContain("KEPT first");
  const firstPid = pidIn(await replay(hui, session.id, first.id));
  expect(firstPid).toBeGreaterThan(1);

  // A second terminal is open too: the preference redraws every one of them, not just the visible tab.
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "T").first().tap();
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  const second = (await terminals(hui, session.id))[1]!;
  await expect.poll(async () => (await replay(hui, session.id, second.id)).trim(), { timeout: 60_000 }).not.toBe("");
  await run(hui, screen, "printf 'SHELL %s\\n' \"$$\"; printf 'KEPT %s\\n' second");
  await expect.poll(() => replay(hui, session.id, second.id)).toContain("KEPT second");
  const secondPid = pidIn(await replay(hui, session.id, second.id));
  expect(secondPid).toBeGreaterThan(1);
  expect(secondPid).not.toBe(firstPid);

  // The Terminal font, chosen the way an operator chooses it.
  await hui.open("/settings/appearance");
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByRole("button", "Terminal font: JetBrains Mono"));
  await screen.getByRole("button", "Terminal font: JetBrains Mono").tap();
  const fonts = screen.getByTestId("picker-list", { visible: true });
  const search = screen.getByLabel("Search or type a font name");
  await hui.scrollTo(screen.getByTestId("settings-page"), search);
  await search.fill("DejaVu Sans Mono");
  await fonts.getByText("Use this local font").tap();
  await expect(screen.getByRole("button", "Terminal font: DejaVu Sans Mono")).toBeVisible();

  // Both terminals are the same ones, on the same two shells, with what they showed.
  await hui.open(`/sessions/${session.id}`);
  expect((await terminals(hui, session.id)).map((terminal) => terminal.id)).toEqual([first.id, second.id]);
  for (const [terminal, marker, pid] of [[first, "first", firstPid], [second, "second", secondPid]] as const) {
    // Each tab is the same pane it was: connected to that terminal, still holding what it printed.
    await pane.getByRole("tab", terminal.title).tap();
    await expect(pane.getByText("Shared · Connected", { visible: true })).toBeVisible();
    const kept = await replay(hui, session.id, terminal.id);
    expect(kept).toContain(`KEPT ${marker}`);
    expect(pidIn(kept)).toBe(pid);
    // And its shell still answers through the pane, in the new font.
    await run(hui, screen, `printf 'AFTER %s\\n' ${marker}`);
    await expect.poll(() => replay(hui, session.id, terminal.id)).toContain(`AFTER ${marker}`);
    expect(pidIn(await replay(hui, session.id, terminal.id))).toBe(pid);
  }
});
