/** The Work pane's shared terminals: opening one from the chat header, running a command, a second independent shell,
 * the agent's tool reaching the same shells, ending one, the narrow key bar and scrolling back (WORK-024, 025, 026, 027,
 * 029, 032, 033). Gespenst paints into a canvas, so the shell's own output is read from the gateway's replay of the
 * terminal the pane is connected to. */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string; title: string; status: "running" | "exited"; exitCode?: number };

/** A + menu entry, found by the shortcut only that kind shows. */
const item = (screen: Pick<Locator, "getByText">, key: string) => screen.getByText(new RegExp(`(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)${key}`, "u"));
const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);
/** Waits for the shell to have started, so its prompt is in the replay before input is typed: keys typed before an
 * interactive shell is ready are echoed by the terminal and then discarded. */
const ready = (hui: Hui, session: string, id: string) => expect.poll(async () => (await replay(hui, session, id)).trim()).not.toBe("");

/** Types into a terminal's shell, one key at a time, the way the operator does after tapping it. */
const run = async (hui: Hui, terminal: Locator, command: string) => {
  await terminal.tap();
  await hui.type(`${command}\n`);
};

test("Open terminal in the chat header shows the conversation's terminal in the Work pane", { tags: ["WORK-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Open terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const open = screen.getByRole("button", "Open terminal");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await open.tap();

  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText(repository.path, { exact: true })).toBeVisible();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  expect(await terminals(hui, session.id)).toHaveLength(1);
  await hui.sessionList();
  expect((await hui.glyph("Open terminal")).animated).toBe(false);

  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "F").first().tap();
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await open.tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  expect(await terminals(hui, session.id)).toHaveLength(1);

  const other = await hui.createSession({ title: "Reuse the running shell", cwd: repository.path });
  const shell = (await hui.api<{ terminal: Terminal }>("POST", `/__hui/sessions/${other.id}/terminals`, {})).terminal;
  await hui.open(`/sessions/${other.id}`);
  await open.tap();
  await expect(pane.getByRole("tab", shell.title)).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  expect(await terminals(hui, other.id)).toHaveLength(1);
});

test("typing a command into the terminal runs it in a real shell and its output, colours included, reaches the terminal", { tags: ["WORK-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Run a command", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await run(hui, terminal, "printf '\\e[31mRED\\e[0m plain\\n'");
  await expect.poll(() => replay(hui, session.id, id)).toContain("\u001b[31mRED");
  const printed = await replay(hui, session.id, id);
  expect(printed).toContain("\u001b[31mRED\u001b[0m plain");

  await hui.prompt(session, "E2E_REPLY:V2hhdCBhIHNoZWxs");
  await expect(screen.getByText("What a shell")).toBeVisible();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  await expect(screen.getByLabel("Message")).toBeVisible();
  await expect(screen.getByTestId("transcript")).toBeVisible();
});

test("New terminal adds a second tab with its own shell, and each tab keeps its own output and state", { tags: ["WORK-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Two terminals", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  const first = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, first.id);
  await run(hui, terminal, "export MARK=first-shell");
  await expect.poll(() => replay(hui, session.id, first.id)).toContain("first-shell");

  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "T").first().tap();
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  const opened = await terminals(hui, session.id);
  expect(opened).toHaveLength(2);
  const second = opened.find(({ id }) => id !== first.id)!;
  expect(second.title).toBe("Terminal 2");
  await ready(hui, session.id, second.id);

  await run(hui, terminal, "export MARK=second-shell");
  await expect.poll(() => replay(hui, session.id, second.id)).toContain("second-shell");
  expect(await replay(hui, session.id, first.id)).not.toContain("second-shell");

  await run(hui, terminal, "printf 'MARK is %s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, second.id)).toContain("MARK is second-shell");
  await pane.getByRole("tab", "Terminal 1").tap();
  await run(hui, terminal, "printf 'MARK is %s\\n' \"$MARK\"");
  await expect.poll(() => replay(hui, session.id, first.id)).toContain("MARK is first-shell");
  expect(await replay(hui, session.id, second.id)).not.toContain("MARK is first-shell");
});

test("the agent's terminal tool lists, reads and types into the shells the operator opened, and no other conversation reaches them", { tags: ["WORK-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Share a terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);
  await run(hui, terminal, "shared_from_user=hello-from-operator");
  await expect.poll(() => replay(hui, session.id, id)).toContain("hello-from-operator");

  await hui.prompt(session, "E2E_SHARED_TERMINAL");
  await expect(screen.getByText("I sent the command to your shared terminal.", { exact: false })).toBeVisible();
  await expect.poll(() => replay(hui, session.id, id)).toContain("Shared variable: hello-from-operator");
  expect(await replay(hui, session.id, id)).toContain("PI_SHARED_TERMINAL");
  await expect(screen.getByText("Ran 3 commands")).toBeVisible();

  const stranger = await hui.createSession({ title: "Another conversation", cwd: repository.path });
  await hui.prompt(stranger, "E2E_SHARED_TERMINAL");
  await hui.open(`/sessions/${stranger.id}`);
  await expect(screen.getByText("No shared terminal was opened.")).toBeVisible();
  expect(await replay(hui, session.id, id)).not.toContain("No shared terminal");
});

test("End terminal stops its shell and closes its tab while the other terminals keep running, and a shell that exits keeps its tab with its code", { tags: ["WORK-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "End a terminal", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "T").first().tap();
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  const opened = await terminals(hui, session.id);
  expect(opened).toHaveLength(2);
  for (const { id } of opened) await ready(hui, session.id, id);

  await pane.getByRole("tab", "Terminal 1").tap();
  await pane.getByRole("button", "Terminal actions").tap();
  await screen.getByText("End terminal", { visible: true }).tap();
  await expect(pane.getByRole("tab")).toHaveCount(1);
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
  const left = await terminals(hui, session.id);
  expect(left).toHaveLength(1);
  expect(left[0]?.status).toBe("running");

  await run(hui, terminal, "exit 3");
  await expect(pane.getByText("Shared · Exited · 3")).toBeVisible();
  await expect(pane.getByRole("tab", "Terminal 2")).toBeVisible();
  expect((await terminals(hui, session.id))[0]?.status).toBe("exited");
  expect((await terminals(hui, session.id))[0]?.exitCode).toBe(3);
});

test("below 1100px the key bar interrupts a running program, locks Ctrl on a double tap and recalls the last command", { tags: ["WORK-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal keys", cwd: repository.path });
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  const key = (name: string) => screen.getByRole("button", name);
  for (const name of ["Escape", "Tab", "Control for next keystroke", "Up arrow", "Down arrow", "Left arrow", "Right arrow"]) {
    await expect(key(name)).toBeVisible();
  }
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await run(hui, terminal, "echo RECALL_MARK");
  await expect.poll(() => replay(hui, session.id, id)).toContain("RECALL_MARK");
  const before = (await replay(hui, session.id, id)).split("RECALL_MARK").length - 1;
  await key("Up arrow").tap();
  await hui.type("\n");
  await expect.poll(async () => (await replay(hui, session.id, id)).split("RECALL_MARK").length - 1).toBeGreaterThan(before + 1);

  await run(hui, terminal, "sleep 60");
  await expect.poll(() => replay(hui, session.id, id)).toContain("sleep 60");
  await key("Control for next keystroke").tap();
  await expect(key("Control for next keystroke")).toHaveAttribute("aria-pressed", "true");
  await hui.type("c");
  await expect.poll(() => replay(hui, session.id, id)).toContain("^C");
  await run(hui, terminal, "echo AFTER");
  await expect.poll(() => replay(hui, session.id, id)).toContain("AFTER");

  await key("Control for next keystroke").tap();
  await key("Control for next keystroke").tap();
  await expect(key("Control, locked on")).toHaveAttribute("aria-pressed", "true");
});

test("a scrolled-back terminal keeps its place while output arrives, and Jump to bottom returns it to the newest output", { tags: ["WORK-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Scroll back", cwd: repository.path });
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });
  const jump = screen.getByLabel("Jump to bottom");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();
  const { id } = (await terminals(hui, session.id))[0]!;
  await ready(hui, session.id, id);

  await run(hui, terminal, "for i in $(seq 1 200); do echo LINE$i; done");
  await expect.poll(() => replay(hui, session.id, id)).toContain("LINE200");
  await expect(jump).toHaveAttribute("aria-hidden", "true");

  await run(hui, terminal, "for i in $(seq 1 40); do echo LATE$i; sleep 0.2; done");
  await hui.wheel(terminal, -2_000);
  await expect(jump).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => replay(hui, session.id, id)).toContain("LATE40");
  await expect(jump).toHaveAttribute("aria-hidden", "false");

  await jump.tap();
  await expect(jump).toHaveAttribute("aria-hidden", "true");
  await run(hui, terminal, "echo TAIL");
  await expect.poll(() => replay(hui, session.id, id)).toContain("TAIL");
  await expect(jump).toHaveAttribute("aria-hidden", "true");
});