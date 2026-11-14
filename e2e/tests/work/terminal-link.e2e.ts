/** A link printed in the terminal opens in a new browser tab, and a scheme the pane does not follow opens nothing
 * (WORK-034). Gespenst paints into canvases, so there is no anchor to press: the pane reads the cells under the pointer
 * and asks the page for a tab, which `hui.tab()` reports. The read starts when the pointer enters and only the next
 * move looks a link up in it, so a press is preceded by a hover and its own move is what finds the link — a stale read
 * would find the previous screen's link, or miss this one, and fail the assertions instead of passing them. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string; title: string };

/** The bytes the gateway replays into this terminal: what its shell has printed. */
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

test("a link printed in the terminal opens in a new tab, and a scheme HUI does not follow opens nothing", { tags: ["WORK-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Terminal links", cwd: repository.path });
  const link = "http://127.0.0.1:8611/hui-link";
  const osc = "http://127.0.0.1:8611/hui-osc8";
  const surface = screen.getByLabel("Shared terminal input");
  const status = screen.getByText("Shared · Connected");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Open terminal").tap();
  await expect(status).toBeVisible();
  const { id } = (await hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session.id}/terminals`)).terminals[0]!;
  await expect.poll(async () => (await replay(hui, session.id, id)).trim(), { timeout: 60_000 }).not.toBe("");

  /** Types one command the way the operator does, and waits for the shell to have printed `marker`. */
  const run = async (command: string, marker: string) => {
    await screen.getByLabel("Shared terminal input", { visible: true }).tap();
    await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
    await hui.type(`${command}\n`);
    await expect.poll(() => replay(hui, session.id, id)).toContain(marker);
  };
  /** Presses the terminal's first cell the way the operator does: the pointer leaves and re-enters, so the pane reads
   * the cells it now shows, and the press's own move looks the link up in them — which is what the cursor it leaves
   * says. The press asks the page for a tab, or for none. */
  const press = async () => {
    await status.hover();
    await surface.hover();
    await surface.tap({ position: { x: 4, y: 4 } });
    return (await surface.getAttribute("style")) ?? "";
  };

  // The whole screen holds the same plain URL, so whichever cell the pointer lands on is the link.
  await run(`yes '${link}' | head -60`, link);
  // The pane found a web link under the cell it pressed.
  expect(await press()).toContain("cursor: pointer");
  const opened = await hui.tab();
  expect(opened?.url).toBe(link);
  expect(opened?.via).toBe("window.open");
  expect(opened?.noopener).toBe(true);

  // A file: URL is not a web link, and the pane leaves it alone: the same press asks for no tab at all.
  await run(`yes 'file:///etc/passwd' | head -60`, "file:///etc/passwd");
  expect(await press()).not.toContain("cursor: pointer");
  expect(await hui.tabs()).toHaveLength(1);

  // An OSC 8 hyperlink carries its destination in the cell itself, and an http one opens the same way.
  await run(`yes 'an OSC 8 link' | head -60`, "an OSC 8 link");
  await run(`printf '\\033[H\\033]8;;${osc}\\033\\\\an OSC 8 link\\033]8;;\\033\\\\\\n'`, osc);
  expect(await press()).toContain("cursor: pointer");
  expect((await hui.tabs()).map(({ url }) => url)).toEqual([link, osc]);
});
