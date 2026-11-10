/** Settings → Workers adds a worker from a name, a connect command and extra paths, connects and disconnects it, re-syncs its configuration and edits it (SET-028, SET-029, SET-030). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Worker = { id: string; name: string; command: string; state: string; extraPaths: string[]; host?: { hostname: string; [field: string]: string }; sync?: { at: string; files: number } };
type Session = { id: string; title: string; worker?: { id: string; name: string } };

const workers = (hui: Hui) => hui.api<{ workers: Worker[] }>("GET", "/__hui/workers").then(({ workers }) => workers);
const listed = (hui: Hui, id: string) => hui.api<{ groups: { sessions: Session[] }[] }>("GET", "/__hui/sessions")
  .then(({ groups }) => groups.flatMap((group) => group.sessions).find((session) => session.id === id));
/** A session that lives on a worker, which the fixture's own creator does not take. */
const sessionOn = (hui: Hui, worker: string, title: string) =>
  hui.api<{ session: Session }>("POST", "/__hui/sessions", { cwd: hui.workspace, worker, title }).then(({ session }) => session);
const pattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");

test("Add worker takes a name, a command and extra paths, says it is setting it up, then reads Not connected with the error or Connected with the host and a Configuration summary", { tags: ["SET-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  // A host the gateway already reaches, so the page has a worker to show once it is set up.
  const host = await hui.addWorker("Far box");

  await hui.open("/settings/workers");
  await page.getByLabel("Name", { exact: true }).fill("Broken box");
  await page.getByPlaceholder("ssh devbox").fill("false");
  await page.getByLabel(/Extra paths to mirror/u).fill("~/.pi/agent/mcp.json");
  await screen.getByRole("button", "Add worker").tap();
  await expect(screen.getByText("Worker added. HUI is setting it up now.", { exact: true })).toBeVisible();
  // A command that opens no host reads Not connected with the reason it left behind.
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(page.getByText("false exited with code 1.", { exact: true })).toBeVisible();
  const broken = (await workers(hui)).find((worker) => worker.name === "Broken box")!;
  expect(broken.state).toBe("error");
  expect(broken.extraPaths).toEqual(["~/.pi/agent/mcp.json"]);
  await expect(page.getByText("Extra paths", { exact: true })).toBeVisible();

  await hui.reload();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText(/· Node v\d/u)).toBeVisible();
  await expect(page.getByText(pattern(`home ${host.home}`))).toBeVisible();
  await expect(page.getByText("Configuration", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Synced \d+ files \(\d+ sent/u)).toBeVisible();
});

test("a connected worker disconnects to Disconnected with its sessions still there, syncs its configuration, and connects again", { tags: ["SET-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const worker = await hui.addWorker("Frontend box");
  const session = await sessionOn(hui, worker.id, "Remote review");

  await hui.open("/settings/workers");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Synced \d+ files \(\d+ sent/u)).toBeVisible();
  const syncedAt = async () => Date.parse((await workers(hui)).find((entry) => entry.id === worker.id)!.sync!.at);
  const before = await syncedAt();

  await page.getByRole("button", "Sync now").tap();
  await expect(screen.getByText("Sync started.", { exact: true })).toBeVisible();
  await expect.poll(syncedAt).toBeGreaterThan(before);

  await page.getByRole("button", "Disconnect").tap();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  // Its sessions keep running there: the session stays registered on that worker.
  expect((await listed(hui, session.id))?.worker).toEqual({ id: worker.id, name: "Frontend box" });

  await page.getByRole("button", "Connect").tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  expect((await workers(hui)).find((entry) => entry.id === worker.id)!.state).toBe("connected");
});

test("Edit fills the worker's form as Edit <name>, Cancel leaves it unchanged and Save worker keeps its sessions", { tags: ["SET-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const worker = await hui.addWorker("Backend box");
  const session = await sessionOn(hui, worker.id, "Remote audit");
  const name = page.getByPlaceholder("devbox");
  const command = page.getByPlaceholder("ssh devbox");
  const stored = (await workers(hui)).find((entry) => entry.id === worker.id)!;

  await hui.open("/settings/workers");
  await expect(page.getByText(/^Backend box\b/u)).toBeVisible();
  await page.getByRole("button", "Edit").tap();
  await expect(page.getByText("Edit Backend box", { exact: true })).toBeVisible();
  await expect(name).toHaveValue("Backend box");
  await expect(command).toHaveValue(stored.command);
  // Cancel leaves the worker as it was stored.
  await page.getByRole("button", "Cancel").tap();
  await expect(page.getByText("Add a worker", { exact: true })).toBeVisible();
  expect((await workers(hui)).find((entry) => entry.id === worker.id)!.name).toBe("Backend box");
  await expect(page.getByText(/^Backend box\b/u)).toBeVisible();

  await page.getByRole("button", "Edit").tap();
  await name.fill("Backend box 2");
  await page.getByRole("button", "Save worker").tap();
  await expect(screen.getByText("Worker saved. Connect again to use the new command.", { exact: true })).toBeVisible();
  await expect(page.getByText("Add a worker", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Backend box 2\b/u)).toBeVisible();
  expect((await workers(hui)).find((entry) => entry.id === worker.id)!.name).toBe("Backend box 2");
  expect((await listed(hui, session.id))?.worker?.id).toBe(worker.id);
});
