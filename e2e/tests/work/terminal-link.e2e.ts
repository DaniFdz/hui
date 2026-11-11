/** A link the shell prints opens in a new browser tab, and a destination that is not a web page asks for none
 * (WORK-034). Gespenst paints the terminal into a canvas, so there is no anchor to press: the test types a screenful of
 * links, each one row wide and wider than half the terminal so every visible row covers the cell the press lands on,
 * and taps the middle of the terminal, the cell the pane reads when it is pressed. The tab is read from the address the
 * page asked for (`hui.tab()`): the suite's engine drives one page, so the request is what a test asserts. The pane
 * offers the cell under the pointer as a link on the terminal's own cursor, and that offer is what proves the pane had
 * read the screen standing in front of it when the press landed. */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string; cols: number };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

/** Types a command at the shell's prompt. The terminal keeps the keyboard across a link press, so only the first press
 * of the test has to take it: a press on the middle of a screen that still holds a link follows that link and asks for a
 * tab of its own. */
const run = async (hui: Hui, screen: Screen, command: string) => {
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.type(`${command}\n`);
};

/** A shell line that prints `text` on `count` rows and then `<tail>`, so that mark proves the screen was drawn. */
const rows = (count: number, text: string, tail: string) => `for i in $(seq 1 ${count}); do printf '%s\\n' '${text}'; done; printf '${tail}%s\\n' -DONE`;

/** The same, each row an OSC 8 hyperlink to `uri` whose clickable text fills the row. */
const hyperlinks = (count: number, uri: string, label: string, tail: string) =>
  `for i in $(seq 1 ${count}); do printf '\\033]8;;${uri}\\033\\\\${label}\\033]8;;\\033\\\\\\n'; done; printf '${tail}%s\\n' -DONE`;

/** Whether the pane offers the cell under the pointer as a link: it writes that on the terminal's inline cursor. */
const offersLink = async (terminal: Locator) => ((await terminal.getAttribute("style")) ?? "").includes("cursor: pointer");

/**
 * Moves the pointer over the terminal until the pane offers its middle cell as a link, or stops offering it. The pane
 * reads the rows under the pointer on each move, so only a read of the screen it now holds can change that offer: the
 * test therefore presses only once the offer names the screen it typed.
 */
const pointerOffers = (hui: Hui, terminal: Locator, offered: boolean) => expect.poll(async () => {
  await hui.peek(terminal);
  return offersLink(terminal);
}).toBe(offered);

test("a link printed in the terminal opens in a new browser tab, and a destination that is not a web page opens none", { tags: ["WORK-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Open a terminal link", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const terminal = screen.getByLabel("Shared terminal input", { visible: true });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(pane.getByText("Shared · Connected")).toBeVisible();

  // The pane fits the grid to the box it ends up in and sends that width to the shell, and the Work pane's own layout
  // settles after the terminal opens. Changing the window once makes the pane send the grid it lays the rows out on, and
  // that is the width the rows below are printed for.
  const opened = (await terminals(hui, session.id))[0]!;
  await hui.wideScreen(1_400);
  await expect.poll(async () => (await terminals(hui, session.id))[0]?.cols).not.toBe(opened.cols);
  const { id, cols } = (await terminals(hui, session.id))[0]!;
  // The shell runs this machine's own startup files, which a loaded machine can take many seconds over.
  await expect.poll(() => replay(hui, session.id, id).then((data) => data.trim()), { timeout: 60_000 }).not.toBe("");
  // A tap takes the terminal's keyboard, which a press on the middle of the screen would not give without following a
  // link. Nothing on screen is one yet, so this is the only press the test makes that is not the link it reads.
  await terminal.tap();
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();

  // Each row is one link, two columns short of the terminal's width, so every visible row holds a link that also covers
  // the middle column the press lands on. Their addresses stay on this gateway instead of reaching the network.
  const link = (path: string) => `${hui.gateway}${path}${"a".repeat(Math.max(4, cols - 2 - `${hui.gateway}${path}`.length))}`;
  const plain = link("/__hui/terminal-link/");
  const linked = link("/__hui/terminal-link/hyperlink/");
  const scheme = `file:///tmp/${"b".repeat(Math.max(4, cols - 2 - "file:///tmp/".length))}`;
  const here = await hui.url();

  // A plain http URL in the shell's output: the pane marks the cell under the pointer and the press asks for it.
  await run(hui, screen, rows(40, plain, "LINK"));
  await expect.poll(() => replay(hui, session.id, id)).toContain("LINK-DONE");
  await pointerOffers(hui, terminal, true);
  await hui.tapAt(terminal);
  const openedLink = await hui.tab();
  expect(openedLink?.via).toBe("window.open");
  expect(openedLink?.url).toBe(plain);
  expect(openedLink?.noopener).toBe(true);
  expect(openedLink?.noreferrer).toBe(true);
  expect(await hui.url()).toBe(here);

  // An OSC 8 hyperlink asks for its own destination, which is not the text the row shows, and every cell of the row
  // carries it whatever the row's width.
  await run(hui, screen, hyperlinks(40, linked, "H".repeat(Math.max(8, cols - 2)), "OSC"));
  await expect.poll(() => replay(hui, session.id, id)).toContain("OSC-DONE");
  expect(await replay(hui, session.id, id)).toContain("\u001b]8;;");
  await pointerOffers(hui, terminal, true);
  await hui.tapAt(terminal);
  const openedHyperlink = await hui.tab();
  expect(openedHyperlink?.via).toBe("window.open");
  expect(openedHyperlink?.url).toBe(linked);
  expect(openedHyperlink?.noopener).toBe(true);
  expect(openedHyperlink?.noreferrer).toBe(true);
  expect(await hui.url()).toBe(here);

  // A destination that is not a web page is never followed. The pane offered this cell a moment ago, so the offer can
  // only go away once the pane has read the file link standing in front of it, and that is the screen the press reads.
  await run(hui, screen, hyperlinks(40, scheme, "F".repeat(Math.max(8, cols - 2)), "FILE"));
  await expect.poll(() => replay(hui, session.id, id)).toContain("FILE-DONE");
  await pointerOffers(hui, terminal, false);
  await hui.tapAt(terminal);
  expect(await hui.tabs()).toHaveLength(2);
  expect((await hui.tab())?.url).toBe(linked);
  expect(await hui.url()).toBe(here);

  // The terminal keeps the shell it was showing: a link press is not a click into the program.
  await run(hui, screen, "printf 'STILL%s\\n' -HERE");
  await expect.poll(() => replay(hui, session.id, id)).toContain("STILL-HERE");
  await expect(pane.getByText("Shared · Connected")).toBeVisible();
});
