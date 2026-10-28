/** Dragging a pane's header or Move panel handle onto another pane swaps them and onto an edge moves it into that column, keeping its draft, scroll, stream, terminal, focus and the layout across a reload, while a drop on itself or a cancelled drag changes nothing (SESS-054). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Terminal = { id: string };

const terminals = (hui: Hui, session: string) => hui.api<{ terminals: Terminal[] }>("GET", `/__hui/sessions/${session}/terminals`).then(({ terminals }) => terminals);
const replay = (hui: Hui, session: string, id: string) => hui.api<{ data: string }>("GET", `/__hui/sessions/${session}/terminals/${id}`).then(({ data }) => data);

test("a pane dragged by its header or handle swaps with another, its handle moves it into a column, and its draft, scroll, stream, terminal, focus and layout survive while a drop on itself or a cancelled drag change nothing", { tags: ["SESS-054"], platforms: ["web"] }, async ({ screen, hui }) => {
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
  const swapped = async () => {
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toBeVisible();
  };
  const swap = (source: Locator, onto: Locator) => hui.drag(source, onto, swapped);
  const moving = async () => {
    await expect(screen.getByText("Move panel", { exact: true, visible: true })).toBeVisible();
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
  const header = moved.getByTestId("chat-header");
  await moved.getByTestId("session-title").tap();
  await expect(moved).toHaveAttribute("aria-current", "true");

  await hui.drag(header, moved, async () => {
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toHaveCount(0);
  });
  await expect.poll(columns).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);
  await hui.drag(header, await paneShowing("Bravo pane"), async () => {
    await swapped();
    await hui.keyboard.down("Escape");
    await hui.keyboard.up("Escape");
    await expect(screen.getByText("Swap panels", { exact: true, visible: true })).toBeHidden();
  });
  await expect.poll(columns).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);

  await swap((await paneShowing("Bravo pane")).getByRole("button", "Move panel"), moved);
  await expect.poll(columns).toEqual(["Bravo pane", "Alpha pane", "Charlie pane"]);
  await moved.getByTestId("session-title").tap();
  await swap(header, await paneShowing("Bravo pane"));
  await expect.poll(columns).toEqual(["Alpha pane", "Bravo pane", "Charlie pane"]);

  const transcript = moved.getByTestId("transcript");
  const note = moved.getByText("Note one");
  const noteTop = async () => (await note.count()) > 0 ? (await note.boundingBox())?.y ?? Number.NaN : Number.NaN;
  for (const text of ["Note one", "Note two", "Note three", "Note four", "Note five", "Note six", "Note seven", "Note eight", "Note nine", "Note ten"]) {
    await moved.getByLabel("Message").fill(text);
    await moved.getByRole("button", "Send message").tap();
    await expect(moved.getByLabel("Session status: Idle")).toBeVisible();
  }
  await moved.getByLabel("Message").fill("E2E_REPLAY held draft");
  await moved.getByRole("button", "Send message").tap();
  await hui.provider.held();
  const streamed = moved.getByText("Replay prefix —", { exact: false });
  await expect(streamed).toBeVisible();
  await expect(moved.getByLabel("Session status: Running")).toBeVisible();
  const transcriptBox = (await transcript.boundingBox())!;
  expect(await noteTop()).toBeLessThan(transcriptBox.y);
  await hui.wheel(transcript, -4000);
  await expect.poll(noteTop).toBeGreaterThan(transcriptBox.y);
  const scrolled = await noteTop();
  await moved.getByLabel("Message").fill("Half-written note");

  await swap(header, await paneShowing("Bravo pane"));
  await expect.poll(columns).toEqual(["Bravo pane", "Alpha pane", "Charlie pane"]);
  await expect(moved).toHaveAttribute("aria-current", "true");
  expect(Math.abs((await noteTop()) - scrolled)).toBeLessThanOrEqual(2);
  await expect(moved.getByLabel("Message")).toHaveValue("Half-written note");
  await expect(streamed).toHaveCount(1);
  await expect(moved.getByLabel("Session status: Running")).toBeVisible();
  await hui.provider.release();
  await expect(moved.getByLabel("Session status: Idle")).toBeVisible();
  await expect(moved.getByText("Replay prefix — replay suffix")).toHaveCount(1);

  const charliePane = await paneShowing("Charlie pane");
  await charliePane.getByTestId("session-title").tap();
  await charliePane.getByRole("button", "Open terminal").tap();
  await expect.poll(async () => (await terminals(hui, charlie.id)).length).toBe(1);
  const terminal = (await terminals(hui, charlie.id))[0]!;
  await expect.poll(async () => (await replay(hui, charlie.id, terminal.id)).trim(), { timeout: 60_000 }).not.toBe("");
  await screen.getByLabel("Shared terminal input", { visible: true }).tap();
  await hui.type("printf 'SET kept\\n'\n");
  await expect.poll(() => replay(hui, charlie.id, terminal.id), { timeout: 60_000 }).toContain("SET kept");

  await hui.drag(charliePane.getByRole("button", "Move panel"), moved, moving, { x: 0.5, y: 0.2 });
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Bravo pane", "Charlie pane", "Alpha pane"]);
  const [charlieBox, movedBox] = [(await (await paneShowing("Charlie pane")).boundingBox())!, (await moved.boundingBox())!];
  expect(Math.round(charlieBox.x)).toBe(Math.round(movedBox.x));
  expect(charlieBox.y).toBeLessThan(movedBox.y);
  await expect.poll(async () => (await terminals(hui, charlie.id)).map(({ id }) => id)).toEqual([terminal.id]);
  await expect(await replay(hui, charlie.id, terminal.id)).toContain("SET kept");

  await hui.reload();
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Bravo pane", "Charlie pane", "Alpha pane"]);
  const [afterReload, reloaded] = [(await (await paneShowing("Charlie pane")).boundingBox())!, (await (await paneShowing("Alpha pane")).boundingBox())!];
  expect(Math.round(afterReload.x)).toBe(Math.round(reloaded.x));
  expect(afterReload.y).toBeLessThan(reloaded.y);

  const bravoPane = await paneShowing("Bravo pane");
  await bravoPane.getByTestId("session-title").tap();
  await hui.drag(bravoPane.getByTestId("chat-header"), await paneShowing("Alpha pane"), moving, { x: 0.5, y: 0.9 });
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Charlie pane", "Alpha pane", "Bravo pane"]);
  const stack = await Promise.all(["Charlie pane", "Alpha pane", "Bravo pane"].map(async (title) => (await (await paneShowing(title)).boundingBox())!));
  expect(new Set(stack.map((box) => Math.round(box.x))).size).toBe(1);
  expect(stack[0]!.y).toBeLessThan(stack[1]!.y);
  expect(stack[1]!.y).toBeLessThan(stack[2]!.y);
});
