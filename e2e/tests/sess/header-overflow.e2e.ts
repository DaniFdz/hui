/** A long session title and its metadata shorten to one line with the full title in the heading's tooltip, Open parent
 * and Continue keep only their icons in a narrow header, and at the 320px pane minimum and on a phone the terminal,
 * Continue, pane menu and Close session pane controls stay inside the header and reachable by Tab (SESS-056). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const TITLE = "A very long session title that keeps going well past the width of a narrow chat pane header";

test("a long title and its metadata shorten to one line with the full title in the tooltip, and a narrow or phone header keeps its controls inside it and in the Tab order", { tags: ["SESS-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const divider = screen.getByTestId("pane-divider");
  const step = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  const inside = async (header: Locator, control: Locator) => {
    const [outer, box] = [await header.boundingBox(), await control.boundingBox()];
    if (!outer || !box) return false;
    return box.x >= outer.x - 0.5 && box.x + box.width <= outer.x + outer.width + 0.5
      && box.y >= outer.y - 0.5 && box.y + box.height <= outer.y + outer.height + 0.5;
  };
  /** The active pane draws its actions: each sits inside the header, is reachable, and comes next in the Tab walk. */
  const headerControls = async (pane: Locator, names: readonly string[]) => {
    const header = pane.getByTestId("chat-header");
    for (const name of names) {
      const control = pane.getByRole("button", name);
      await expect.poll(() => inside(header, control)).toBe(true);
      expect(await hui.reachable(control)).toBe(true);
    }
    await pane.getByRole("button", "Move panel").focus();
    for (const name of names) {
      await step("Tab");
      await expect(pane.getByRole("button", name)).toBeFocused();
    }
  };
  /** How wide a header action's written label is: the words, or the 1px of the visually hidden copy. */
  const labelWidth = async (pane: Locator, text: string) => (await pane.getByText(text, { exact: true }).boundingBox())!.width;
  const activate = async (pane: Locator) => {
    await pane.getByTestId("session-title").tap();
    await expect(pane).toHaveAttribute("aria-current", "true");
  };
  const parent = await hui.createSession({ title: "Header parent" });
  const child = await hui.createSubagent(parent);
  await hui.api("PATCH", `/__hui/sessions/${child.id}`, { title: TITLE });
  const worker = await hui.createSession({ title: "Worker chat", tool: "pi" });
  await hui.prompt(worker, "Answer once so Continue has a history");

  await hui.wideScreen(2200);
  await hui.open(`/sessions/${child.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Worker chat")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  const subagentPane = panes.nth(0);
  const workerPane = panes.nth(1);
  await expect(subagentPane.getByTestId("session-title")).toHaveText(TITLE);
  await expect(workerPane.getByTestId("session-title")).toHaveText("Worker chat");

  // The title keeps its full text in the heading's tooltip, and both it and the metadata take one line.
  await activate(subagentPane);
  const heading = subagentPane.getByTestId("session-title");
  await expect(heading).toHaveAttribute("title", TITLE);
  const meta = subagentPane.getByText("Subagent · OTHER · Idle");
  await expect(meta).toHaveAttribute("title", hui.workspace);
  for (const line of [heading, meta]) {
    const size = (await hui.look(line)).size;
    expect((await line.boundingBox())!.height).toBeLessThan(size * 2);
  }
  // A wide header writes Open parent and Continue out.
  expect(await labelWidth(subagentPane, "Open parent")).toBeGreaterThan(40);
  await activate(workerPane);
  expect(await labelWidth(workerPane, "Continue")).toBeGreaterThan(40);

  // At the 320px pane minimum the worker's header keeps Continue as a labeled icon beside the terminal, pane menu and
  // close controls, all inside it and in the Tab order.
  const maximum = (await divider.getAttribute("aria-valuemax"))!;
  const paneRight = async () => (await workerPane.boundingBox())!.x + (await workerPane.boundingBox())!.width;
  await hui.dragBy(divider, { dx: (await paneRight()) - (await divider.boundingBox())!.x - 2, dy: 0 },
    async () => expect(divider).toHaveAttribute("aria-valuenow", maximum));
  await expect.poll(async () => Math.round((await workerPane.boundingBox())!.width)).toBe(320);
  await expect(workerPane.getByRole("button", "Continue without a prompt")).toBeVisible();
  await expect.poll(() => labelWidth(workerPane, "Continue")).toBeLessThanOrEqual(1);
  await headerControls(workerPane, ["Open terminal", "Continue without a prompt", "Pane actions", "Close session pane"]);

  // The subagent's pane holds Open parent the same way when it is the narrow one.
  const minimum = (await divider.getAttribute("aria-valuemin"))!;
  await activate(subagentPane);
  await hui.dragBy(divider, { dx: -(await divider.boundingBox())!.x + 2, dy: 0 },
    async () => expect(divider).toHaveAttribute("aria-valuenow", minimum));
  await expect.poll(async () => Math.round((await subagentPane.boundingBox())!.width)).toBe(320);
  await expect(subagentPane.getByRole("button", "Open parent")).toBeVisible();
  await expect.poll(() => labelWidth(subagentPane, "Open parent")).toBeLessThanOrEqual(1);
  expect(await hui.textOf(subagentPane.getByTestId("session-title"))).toBe(TITLE);
  await headerControls(subagentPane, ["Open parent", "Open terminal", "Pane actions", "Close session pane"]);

  // On a phone the open session's header holds the same controls, its pane menu being the Active panel selector.
  await hui.phoneScreen();
  await hui.open(`/sessions/${worker.id}`);
  const phonePane = screen.getByTestId("session-pane", { visible: true });
  await expect(phonePane).toHaveCount(1);
  // The address focuses the pane already showing the worker, its second view here, instead of repeating it in the
  // first: the panel selector names the second pane.
  await expect(phonePane.getByRole("button", /^Active panel: 2 · Chat · Worker chat$/u)).toBeVisible();
  const phoneHeader = phonePane.getByTestId("chat-header");
  for (const control of [phonePane.getByRole("button", "Open terminal"), phonePane.getByRole("button", "Continue without a prompt"),
    phonePane.getByRole("button", "Close session pane"), phonePane.getByRole("button", /^Active panel:/u)]) {
    await expect(control).toBeVisible();
    expect(await hui.reachable(control)).toBe(true);
  }
  for (const control of [phonePane.getByRole("button", "Open terminal"), phonePane.getByRole("button", "Continue without a prompt"),
    phonePane.getByRole("button", "Close session pane")]) {
    await expect.poll(() => inside(phoneHeader, control)).toBe(true);
  }
  await phonePane.getByRole("button", "Open terminal").focus();
  await step("Tab");
  await expect(phonePane.getByRole("button", "Continue without a prompt")).toBeFocused();
  await step("Tab");
  await expect(phonePane.getByRole("button", "Close session pane")).toBeFocused();
});
