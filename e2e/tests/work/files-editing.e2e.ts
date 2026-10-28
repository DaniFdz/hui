/** The Files view under editing: a conflict with a change made on disk and the two ways out of it (WORK-045), unsaved
 * text shared by every view of the file, kept across a reload until it reaches the disk, and the selection and folders
 * a closed tab forgets (WORK-046), the view following the disk when the agent's turn ends, when it is shown again or on
 * Refresh (WORK-047), and Copy full path (WORK-055). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const disk = (path: string) => readFile(path, "utf8");

test("a change on disk under unsaved text reads Conflict, shows the disk's version, and Reload from disk or Overwrite with mine settles it", { tags: ["WORK-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const file = join(repository.path, "note.txt");
  await writeFile(file, "start\n");
  const session = await hui.createSession({ title: "Resolve a conflict", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await navigator.getByRole("button", /^note\.txt$/u).tap();
  const text = screen.getByLabel(/Contents of .*note\.txt$/u);
  await expect(text).toBeVisible();

  const first = await hui.intercept("PUT", /\/files\/file\?/u);
  await text.fill("mine-1");
  await first.arrived();
  await writeFile(file, "theirs\n");
  await first.deliver();
  await expect(screen.getByText("Conflict")).toBeVisible();
  await expect(screen.getByText("This file changed on disk while you were editing it.")).toBeVisible();
  await expect(screen.getByText("Your edits are kept here and nothing is saved until you choose.")).toBeVisible();
  expect(await disk(file)).toBe("theirs\n");

  await screen.getByText("Show the version on disk").tap();
  await expect(screen.getByText("theirs")).toBeVisible();

  await screen.getByRole("button", "Reload from disk").tap();
  await expect(screen.getByText("Conflict")).toHaveCount(0);
  await expect(screen.getByText("Saved")).toBeVisible();
  await expect(text).toContainText("theirs");
  expect(await text.textContent()).not.toContain("mine-1");
  expect(await disk(file)).toBe("theirs\n");

  const second = await hui.intercept("PUT", /\/files\/file\?/u);
  await text.fill("mine-3");
  await second.arrived();
  await writeFile(file, "theirs-2\n");
  await second.deliver();
  await expect(screen.getByText("Conflict")).toBeVisible();
  await screen.getByRole("button", "Overwrite with mine").tap();
  await expect(screen.getByText("Saved")).toBeVisible();
  await expect.poll(() => disk(file)).toBe("mine-3");
  await expect(screen.getByText("Conflict")).toHaveCount(0);
});

test("unsaved text shows in every Files view of the file and survives a reload until it reaches the disk, and a closed tab forgets its selection and folders", { tags: ["WORK-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const file = join(repository.path, "note.txt");
  await writeFile(file, "start\n");
  const session = await hui.createSession({ title: "Keep unsaved text", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const navigators = screen.getByLabel("Files navigator");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await navigators.first().getByRole("button", /^note\.txt$/u).tap();
  await expect(screen.getByLabel(/Contents of .*note\.txt$/u)).toBeVisible();

  const held = await hui.intercept("PUT", /\/files\/file\?/u);
  await screen.getByLabel(/Contents of .*note\.txt$/u).fill("unsaved text");
  await held.arrived();
  await held.reject(503, "The gateway is busy.");
  expect(await disk(file)).toBe("start\n");

  await hui.workChord("F");
  await expect(pane.getByRole("tab")).toHaveCount(2);
  await navigators.last().getByRole("button", /^note\.txt$/u).tap();
  await expect(screen.getByLabel(/Contents of .*note\.txt$/u).last()).toContainText("unsaved text");

  await hui.reload();
  await expect(screen.getByLabel(/Contents of .*note\.txt$/u).last()).toContainText("unsaved text");
  await expect.poll(() => disk(file)).toBe("unsaved text");

  await navigators.last().getByRole("button", "sub").tap();
  await navigators.last().getByRole("button", /^keep\.txt$/u).tap();
  await expect(pane.getByRole("tab", "keep.txt")).toBeVisible();
  await pane.getByRole("button", "Close keep.txt").last().tap();
  await hui.workChord("F");
  await expect(navigators.last().getByRole("button", "sub")).toHaveAttribute("aria-expanded", "false");
  await expect(screen.getByText("Select a file to view or edit it.")).toBeVisible();
});

test("when the agent's turn ends, when the view is shown again or on Refresh, open folders and a clean open file show the disk's current contents", { tags: ["WORK-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const file = join(repository.path, "sub", "keep.txt");
  const session = await hui.createSession({ title: "Follow the disk", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const navigator = screen.getByLabel("Files navigator");
  const text = screen.getByLabel(/Contents of .*keep\.txt$/u);

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await navigator.getByRole("button", "sub").tap();
  await navigator.getByRole("button", /^keep\.txt$/u).tap();
  await expect(text).toContainText("sub");

  await hui.prompt(session, call("bash", { command: "printf 'from the agent\\n' > sub/keep.txt; printf 'fresh\\n' > sub/fresh.txt" }));
  await expect(screen.getByText(/tool answered/u)).toBeVisible();
  await expect(text).toContainText("from the agent");
  await expect(navigator.getByRole("button", /^fresh\.txt$/u)).toBeVisible();

  await writeFile(file, "shown again\n");
  await writeFile(join(repository.path, "sub", "later.txt"), "later\n");
  await hui.workChord("D");
  await pane.getByRole("tab", "keep.txt").tap();
  await expect(text).toContainText("shown again");
  await expect(navigator.getByRole("button", /^later\.txt$/u)).toBeVisible();

  await writeFile(file, "on refresh\n");
  await navigator.getByLabel("Refresh").tap();
  await expect(text).toContainText("on refresh");
});

test("Copy full path puts the file's absolute path on the clipboard and the control briefly reads Copied", { tags: ["WORK-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "note.txt"), "start\n");
  const session = await hui.createSession({ title: "Copy a path", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");

  await hui.clipboard();
  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await navigator.getByRole("button", /^note\.txt$/u).tap();
  const copy = screen.getByRole("button", "Copy full path");

  await copy.tap();
  await expect(copy).toHaveAttribute("data-hui-tooltip", "Copied");
  expect(await hui.copied()).toBe(join(repository.path, "note.txt"));
  await expect(copy).toHaveAttribute("data-hui-tooltip", "Copy full path");
});
