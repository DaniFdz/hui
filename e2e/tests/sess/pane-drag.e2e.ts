/** Dragging a pane's header onto another pane swaps them and dragging its Move panel handle onto an edge moves it into that column, keeping its draft, scroll, stream, terminal, focus and the layout across a reload, while a drop on itself or a cancelled drag changes nothing (SESS-054). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

test("a pane dragged by its header swaps with another, its handle moves it into a column, and its draft, scroll, stream, terminal, focus and layout survive while a drop on itself or a cancelled drag change nothing", { tags: ["SESS-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const shown = async (pane: Locator) => {
    const title = pane.getByTestId("session-title", { visible: true });
    return (await title.count()) > 0 ? ((await title.textContent()) ?? "").trim() : "";
  };
  const paneShowing = async (title: string) => {
    for (let index = 0; index < await panes.count(); index += 1) {
      if (await shown(panes.nth(index)) === title) return panes.nth(index);
    }
    throw new Error(`no pane shows ${title}`);
  };
  const columns = async () => {
    const placed: { title: string; x: number; y: number }[] = [];
    for (let index = 0; index < await panes.count(); index += 1) {
      const box = await panes.nth(index).boundingBox();
      const title = await shown(panes.nth(index));
      if (box && title) placed.push({ title, x: Math.round(box.x), y: Math.round(box.y) });
    }
    return placed.sort((a, b) => a.x - b.x || a.y - b.y).map(({ title }) => title);
  };
  const dropOn = (source: Locator, onto: Locator, at: { x: number; y: number }, preview: string) =>
    hui.dragOnto(source, onto, at, async () => {
      await expect(screen.getByText(preview, { exact: true, visible: true })).toBeVisible();
    });
  const shell = async (session: string, terminal: string, mark: string) => {
    await screen.getByLabel("Shared terminal input", { visible: true }).tap();
    await hui.type(`printf 'SET %s\\n' "${mark}"\n`);
    await expect.poll(() => replay(hui, session, terminal), { timeout: 60_000 }).toContain(`SET ${mark}`);
  };

  const alpha = await hui.createSession({ title: "Alpha pane" });
  await hui.createSession({ title: "Bravo pane" });
  const charlie = await hui.createSession({ title: "Charlie pane" });
  await hui.wideScreen(2200);
  await hui.open(`/sessions/${alpha.id}`);
  await (await hui.sessionMenu("Bravo pane")).getByText("Open in split pane", { visible: true }).tap();
  await (await hui.sessionMenu("Charlie pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);
  expect(await columns()).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);

  const moved = await paneShowing("Alpha pane");
  const transcript = moved.getByTestId("transcript");
  await moved.getByTestId("session-title").tap();
  await expect(moved).toHaveAttribute("aria-current", "true");

  await hui.dragOnto(moved.getByTestId("chat-header"), moved, { x: 0.5, y: 0.5 }, async () => {
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toHaveCount(0);
  });
  await expect.poll(columns).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);

  await hui.dragOnto(moved.getByTestId("chat-header"), await paneShowing("Bravo pane"), { x: 0.5, y: 0.5 }, async () => {
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toBeVisible();
    await hui.keyboard.down("Escape");
    await hui.keyboard.up("Escape");
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toBeHidden();
  });
  await expect.poll(columns).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);

  for (const note of ["Note one", "Note two", "Note three", "Note four", "Note five"]) {
    await moved.getByLabel("Message").fill(note);
    await moved.getByRole("button", "Send message").tap();
    await expect(moved.getByLabel("Session status: Idle")).toBeVisible();
  }
  await moved.getByLabel("Message").fill("E2E_REPLAY held draft");
  await moved.getByRole("button", "Send message").tap();
  await hui.provider.held();
  const streamed = moved.getByText("Replay prefix —", { exact: false });
  await expect(streamed).toBeVisible();
  await expect(moved.getByLabel("Session status: Running")).toBeVisible();
  await hui.wheel(transcript, -4000);
  await expect(moved.getByText("Note one")).toBeVisible();
  await moved.getByLabel("Message").fill("Half-written note");

  await dropOn(moved.getByTestId("chat-header"), await paneShowing("Bravo pane"), { x: 0.5, y: 0.5 }, "Swap panels");
  await expect.poll(columns).toEqual(["Bravo pane", "Alpha pane", "Charlie pane"]);
  await expect(moved).toHaveAttribute("aria-current", "true");
  await expect(moved.getByText("Note one")).toBeVisible();
  await expect(moved.getByLabel("Message")).toHaveValue("Half-written note");
  await expect(streamed).toHaveCount(1);
  await expect(moved.getByLabel("Session status: Running")).toBeVisible();
  await hui.provider.release();
  await expect(moved.getByLabel("Session status: Idle")).toBeVisible();
  await expect(moved.getByText("Replay prefix — replay suffix")).toHaveCount(1);

  const charliePane = await paneShowing("Charlie pane");
  await charliePane.getByTestId("session-title").tap();
  await expect(charliePane).toHaveAttribute("aria-current", "true");
  await charliePane.getByRole("button", "Open terminal").tap();
  await expect.poll(async () => (await terminals(hui, charlie.id)).length).toBe(1);
  const terminal = (await terminals(hui, charlie.id))[0]!;
  await expect.poll(async () => (await replay(hui, charlie.id, terminal.id)).trim(), { timeout: 60_000 }).not.toBe("");
  await shell(charlie.id, terminal.id, "kept");

  await dropOn(charliePane.getByRole("button", "Move panel"), moved, { x: 0.5, y: 0.1 }, "Move panel");
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Bravo pane", "Charlie pane", "Alpha pane"]);
  await expect.poll(async () => (await terminals(hui, charlie.id)).map(({ id }) => id)).toEqual([terminal.id]);
  await expect(await replay(hui, charlie.id, terminal.id)).toContain("SET kept");

  await hui.reload();
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Bravo pane", "Charlie pane", "Alpha pane"]);
});
