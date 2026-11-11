/** The Work views a conversation on a remote worker cannot have: its Files say so with the reason its files live on
 * that machine (WORK-057), and its VS Code view says VS Code is not available here for the same reason (WORK-080). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

/** A conversation that runs on a worker of its own: its folder is on that machine, not this one. */
const remoteSession = async (hui: Hui, worker: string, title: string) =>
  (await hui.api<{ session: { id: string } }>("POST", "/__hui/sessions", { title, cwd: "~", worker })).session;

test("a Files view of a conversation on a remote worker says Files are not available and why", { tags: ["WORK-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("files-box");
  const session = await remoteSession(hui, worker.id, "Files on a worker");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");

  // Neither a navigator nor an editor: the view reports that the conversation's files are on the worker's machine.
  const pane = screen.getByLabel("Work pane");
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText("Files are not available", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(pane.getByText("Files are not available for conversations on a remote worker yet: their files live on that machine.", { exact: true })).toBeVisible();
  await expect(pane.getByLabel("Files navigator")).toHaveCount(0);
});

test("a VS Code view of a conversation on a remote worker says VS Code is not available here and why", { tags: ["WORK-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("code-box");
  const session = await remoteSession(hui, worker.id, "VS Code on a worker");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "VS Code");

  // VS Code runs on the gateway's machine, which does not hold the worker's files: the view says so instead of a frame.
  const pane = screen.getByLabel("Work pane");
  await expect(pane.getByRole("tab", "VS Code")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText("VS Code is not available here", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(pane.getByText("This conversation runs on a remote worker. VS Code runs on the gateway's machine, which does not have its files.", { exact: true })).toBeVisible();
});
