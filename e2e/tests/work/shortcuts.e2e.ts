/** The Work pane's keyboard shortcuts: showing and hiding the pane, maximizing it and opening each view, from the
 * composer, a terminal and the Files editor (WORK-016, WORK-017). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** A view from the + menu, by the name only that kind shows. */
const launch = async (screen: Screen, name: string) => {
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByRole("menuitem").filter({ hasText: name }).tap();
};

test("the pane shortcut hides and shows the Work pane from the composer, a terminal and the Files editor, and returns to the chat on a phone", { tags: ["WORK-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "notes.txt"), "one\n");
  const session = await hui.createSession({ title: "Toggle the pane", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");
  const show = screen.getByRole("button", "Show Work pane");
  const hidden = async () => {
    await expect(show).toBeVisible();
    await expect(pane.getByRole("tab")).toHaveCount(0);
  };
  const shownOn = async (caption: string) => {
    await expect(screen.getByRole("button", "Hide Work pane")).toBeVisible();
    await expect(show).toBeHidden();
    await expect(pane.getByRole("tab", caption)).toBeFocused();
  };

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await show.tap();
  await launch(screen, "Files");
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");

  await message.fill("A draft beside the work");
  await hui.workChord("P");
  await hidden();
  await expect(message).toBeFocused();
  await hui.workChord("P");
  await shownOn("Files");
  await expect(message).toHaveValue("A draft beside the work");

  await launch(screen, "New terminal");
  const terminal = screen.getByRole("textbox", "Terminal input", { visible: true });
  await expect(terminal).toBeFocused();
  await hui.workChord("P");
  await hidden();
  await expect(message).toBeFocused();
  await hui.workChord("P");
  await shownOn("Terminal 1");

  await pane.getByRole("tab", "Files").tap();
  const editor = screen.getByLabel(/Contents of .*notes\.txt$/u);
  await screen.getByLabel("Files navigator").getByRole("button", "notes.txt").tap();
  await expect(editor).toBeVisible();
  await editor.tap();
  await expect(editor).toBeFocused();
  await hui.workChord("P");
  await hidden();
  await expect(message).toBeFocused();
  await hui.workChord("P");
  await shownOn("notes.txt");

  await hui.phoneScreen();
  await screen.getByRole("button", { name: /^Active panel/u }).tap();
  await screen.getByText("Files").last().tap();
  const back = screen.getByRole("button", "Back to chat");
  await expect(back).toBeVisible();
  await hui.workChord("P");
  await expect(back).toBeHidden();
  await expect(message).toBeFocused();
  await expect(screen.getByTestId("transcript")).toBeVisible();
  await hui.wideScreen();
});

test("the maximize shortcut fills the pane over the chat and restores the chat beside it", { tags: ["WORK-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "notes.txt"), "one\n");
  const session = await hui.createSession({ title: "Maximize with a chord", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await launch(screen, "Files");
  const beside = (await pane.boundingBox())!.width;

  await message.fill("A draft under the pane");
  await hui.workChord("M");
  await expect(screen.getByRole("button", "Restore Work pane")).toBeVisible();
  await expect(transcript).toBeHidden();
  await expect(message).toBeHidden();
  await expect(pane.getByRole("tab", "Files")).toBeFocused();
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(beside);

  await hui.workChord("M");
  await expect(transcript).toBeVisible();
  await expect(message).toHaveValue("A draft under the pane");
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(Math.round(beside));
});

/** A wide conversation with its Work pane shown and no view open. */
const openWork = async (hui: Hui, screen: Screen, title: string) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "notes.txt"), "one\n");
  const session = await hui.createSession({ title, cwd: repository.path });
  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  return repository;
};

/** The Files editor of `notes.txt`, opened from a navigator row. */
const openNotes = async (screen: Screen) => {
  await launch(screen, "Files");
  await screen.getByLabel("Files navigator").getByRole("button", "notes.txt").tap();
  const editor = screen.getByLabel(/Contents of .*notes\.txt$/u);
  await editor.tap();
  await expect(editor).toHaveText("one");
  return editor;
};

test("the terminal shortcut adds a terminal tab with focus in it from the composer, a terminal and the Files editor, and no key reaches them", { tags: ["WORK-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await openWork(hui, screen, "Terminal shortcut");
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");
  const keys = () => screen.getByRole("textbox", "Terminal input", { visible: true });

  await message.fill("A draft in the composer");
  await hui.workChord("T");
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(keys()).toBeFocused();
  await expect(message).toHaveValue("A draft in the composer");

  await hui.workChord("T");
  await expect(pane.getByRole("tab", "Terminal 2")).toHaveAttribute("aria-selected", "true");
  await expect(keys()).toBeFocused();

  const editor = await openNotes(screen);
  await hui.workChord("T");
  await expect(pane.getByRole("tab", "Terminal 3")).toHaveAttribute("aria-selected", "true");
  await expect(keys()).toBeFocused();
  await pane.getByRole("tab", "notes.txt").tap();
  await expect(editor).toHaveText("one");
  await expect(message).toHaveValue("A draft in the composer");
  expect(await readFile(join(repository.path, "notes.txt"), "utf8")).toBe("one\n");
});

test("the Browser shortcut shows the conversation's one Browser tab from the composer, a terminal and the Files editor", { tags: ["WORK-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  await openWork(hui, screen, "Browser shortcut");
  const pane = screen.getByLabel("Work pane");
  const browserTab = () => pane.getByRole("tab", "Browser");

  await screen.getByLabel("Message").fill("A draft in the composer");
  await hui.workChord("B");
  await expect(browserTab()).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(1);

  await hui.workChord("T");
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.workChord("B");
  await expect(browserTab()).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(2);

  const editor = await openNotes(screen);
  await hui.workChord("B");
  await expect(browserTab()).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(3);
  await pane.getByRole("tab", "notes.txt").tap();
  await expect(editor).toHaveText("one");
});

test("the files shortcut adds a Files tab from the composer, a terminal and the Files editor without typing into any of them", { tags: ["WORK-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await openWork(hui, screen, "Files shortcut");
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");

  await message.fill("A draft in the composer");
  await hui.workChord("F");
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(1);
  await expect(message).toHaveValue("A draft in the composer");

  await hui.workChord("T");
  await expect(screen.getByRole("textbox", "Terminal input", { visible: true })).toBeFocused();
  await hui.workChord("F");
  await expect(pane.getByRole("tab")).toHaveCount(3);
  await expect(pane.getByRole("tab", "Files")).toHaveCount(2);
  await expect(pane.getByRole("tab", "Files").last()).toHaveAttribute("aria-selected", "true");

  const navigator = screen.getByLabel("Files navigator");
  await navigator.getByRole("button", "notes.txt").tap();
  const editor = screen.getByLabel(/Contents of .*notes\.txt$/u);
  await editor.tap();
  await expect(editor).toHaveText("one");
  await hui.workChord("F");
  await expect(pane.getByRole("tab")).toHaveCount(4);
  await expect(pane.getByRole("tab", "Files")).toHaveCount(2);
  await expect(pane.getByRole("tab", "notes.txt")).toHaveAttribute("aria-selected", "false");
  await pane.getByRole("tab", "notes.txt").tap();
  await expect(editor).toHaveText("one");
  await expect(message).toHaveValue("A draft in the composer");
  expect(await readFile(join(repository.path, "notes.txt"), "utf8")).toBe("one\n");
});

test("the diff shortcut adds a Diff tab for the conversation's checkout", { tags: ["WORK-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await openWork(hui, screen, "Diff shortcut");
  await writeFile(join(repository.path, "sub", "keep.txt"), "edited\n");
  const pane = screen.getByLabel("Work pane");

  await screen.getByLabel("Message").fill("A draft in the composer");
  await hui.workChord("D");
  await expect(pane.getByRole("tab", "Diff")).toHaveAttribute("aria-selected", "true");

  const changed = screen.getByLabel("Changed files");
  const file = changed.getByRole("button").filter({ hasText: "keep.txt" });
  await expect(file).toBeVisible();
  await expect(file).toContainText("sub");
  await file.tap();
  await expect(screen.getByLabel(/^Changes in .*sub\/keep\.txt$/u)).toContainText("edited");
});

