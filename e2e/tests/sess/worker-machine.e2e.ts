/** Where a new session runs: the worker picker offers Local and each worker with its state, a worker's own folders and Git, a remote directory rule, and a session that opens on the worker it names (SESS-013); and a session whose worker link is lost reads Reconnecting to <worker>… in its row, header and one composer status line while HUI retries (SESS-065). */
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string; title: string; cwd: string; status: string; worker?: { name: string } }[] }[] };

const listed = async (hui: { api: <T>(method: string, path: string) => Promise<T> }) =>
  (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);

test("the worker picker offers Local and each worker, a chosen worker brings its own folders and directory rule, and the session opens on it without waiting for a connection", { tags: ["SESS-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("build-box");
  await mkdir(join(worker.home, "project-box"), { recursive: true });
  const picker = screen.getByLabel("Choose where the session runs");
  const directory = screen.getByRole("combobox", "Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const start = screen.getByRole("button", "Start session");

  await hui.open("/");
  await expect(start).toBeVisible();

  // Local and the worker, each with its state.
  await picker.tap();
  const menu = screen.getByRole("menu", "Run on");
  await expect(menu.getByRole("menuitemradio", { name: /^Local$/u })).toHaveAttribute("aria-checked", "true");
  const workerChoice = menu.getByRole("menuitemradio", { name: /^build-box/u });
  await expect(workerChoice).toHaveAttribute("data-worker-state", "connected");
  await expect(workerChoice).toContainText(/Connected · /u);
  await workerChoice.tap();
  await expect(picker).toContainText("build-box");

  // Its folders, not this machine's: `~/project-box` exists in the worker's home only.
  await directory.fill("~/project-box");
  await expect(screen.getByRole("listbox", "Project directory").getByRole("option")).toHaveText(["~/project-box/"]);
  await screen.getByRole("listbox", "Project directory").getByRole("option", { name: "~/project-box/" }).tap();
  await expect(directory).toHaveValue("~/project-box/");
  // The folder is not a Git repository, so the worker reports no checkout to pick.
  await expect(screen.getByRole("button", /^Checkout: /u)).toHaveCount(0);

  // A worker's directory is on that machine: HUI can only check its shape.
  await directory.fill("relative/dir");
  await directory.press("Escape");
  await message.fill("Run where the folder is not a path");
  await start.tap();
  await expect(screen.getByText("Could not start session")).toBeVisible();
  await expect(screen.getByText("A remote directory must be absolute or start with ~/.")).toBeVisible();
  expect((await listed(hui)).map(({ title }) => title)).not.toContain("Run where the folder is not a path");

  await directory.fill("~/project-box");
  await directory.press("Escape");
  await message.fill("Build the box");
  await start.tap();
  // The session opens on the worker it names, in its own header.
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible({ timeout: 180_000 });
  await expect(screen.getByText("durable on build-box · OTHER · Idle")).toBeVisible();
  const session = (await listed(hui)).find(({ title }) => title === "Build the box");
  expect(session?.worker?.name).toBe("build-box");
  expect(session?.cwd).toBe("~/project-box");
  expect(new URL(await hui.url()).pathname).toBe(`/sessions/${session?.id}`);

  // Created without waiting for a connection: the worker is away and the session still opens at once.
  await hui.api("POST", `/__hui/workers/${worker.id}/disconnect`);
  await hui.open("/");
  await picker.tap();
  await menu.getByRole("menuitemradio", { name: /^build-box/u }).tap();
  await directory.fill("~/project-box");
  await directory.press("Escape");
  await message.fill("Start while the worker is away");
  await start.tap();
  await expect.poll(async () => (await listed(hui)).find(({ title }) => title === "Start while the worker is away")?.id).toBeTruthy();
  const away = (await listed(hui)).find(({ title }) => title === "Start while the worker is away")!;
  expect(away.worker?.name).toBe("build-box");
  await expect(screen.getByTestId("chat-header")).toContainText("durable on build-box");
});

test("a session whose worker link is lost reads Reconnecting to <worker>… in its row, its header and one status line under the composer, keeps its draft and offers no second copy in the chat", { tags: ["SESS-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("build-box");
  await mkdir(join(worker.home, "project-box"), { recursive: true });
  const created = await hui.api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: "~/project-box", worker: worker.id, title: "Remote build" });

  await hui.open(`/sessions/${created.session.id}`);
  const message = screen.getByLabel("Message");
  await expect(screen.getByTestId("chat-header")).toContainText("durable on build-box");
  await message.fill("Hello there");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible({ timeout: 120_000 });

  // The machine's release can no longer start, so every retry fails and the retrying state stays readable.
  await rm(join(worker.home, ".local", "share", "hui-worker"), { recursive: true, force: true });
  execFileSync("pkill", ["-f", worker.home]);
  await expect.poll(async () => (await listed(hui)).find(({ id }) => id === created.session.id)?.status, { timeout: 60_000 }).toBe("reconnecting");

  const away = `Reconnecting to build-box…`;
  await hui.sessionList();
  await expect(screen.getByLabel(/^Remote build, status reconnecting, tool durable/u)).toBeVisible();
  expect((await hui.glyph("Remote build")).label).toBe(away);
  // The header and the one status lane under the composer carry it; the chat itself never repeats it.
  await expect(screen.getByTestId("chat-header")).toContainText(away);
  await expect(screen.getByTestId("composer-status")).toContainText(away);
  await expect(screen.getByText(away, { exact: true })).toHaveCount(2);

  // Drafting stays open; only sending waits.
  await message.fill("Draft kept while HUI retries the worker");
  await expect(screen.getByRole("button", "Send message")).toBeDisabled();
  await expect(message).toHaveValue("Draft kept while HUI retries the worker");
});
