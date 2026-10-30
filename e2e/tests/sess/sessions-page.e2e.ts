/** The Sessions page lists every session with its runtime, status and update, opens on All (then Active, Archived), filters by text, status and grouping, opens a session and copies a row's path, and shows its empty, loading and error states (SESS-058). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { label: string; sessions: { id: string; title: string; status: string }[] }[] };

test("the Sessions page lists every session with its runtime, status and update, and its state opens on All, then Active and Archived", { tags: ["SESS-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const listed = (title: string) => screen.getByTestId("session-data-row").filter({ hasText: title });
  await hui.createSession({ title: "Zulu listed" });
  const archived = await hui.createSession({ title: "Bravo archived" });
  await hui.api("PATCH", `/__hui/sessions/${archived.id}`, { archived: true });

  await hui.open("/sessions");
  const zulu = listed("Zulu listed");
  await expect(zulu).toBeVisible();
  await expect(zulu.getByText("durable", { exact: true })).toBeVisible();
  await expect(zulu.getByText("idle", { exact: true })).toBeVisible();
  await expect(zulu.getByText("just now", { exact: true })).toBeVisible();
  const bravo = listed("Bravo archived");
  await expect(bravo.getByText("archived", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", { name: "All", pressed: true })).toBeVisible();

  await screen.getByRole("button", "Active").tap();
  await expect(zulu).toBeVisible();
  await expect(bravo).toBeHidden();
  await screen.getByRole("button", "Archived").tap();
  await expect(bravo).toBeVisible();
  await expect(zulu).toBeHidden();
  await screen.getByRole("button", "All").tap();
  await expect(zulu).toBeVisible();
  await expect(bravo).toBeVisible();

  await screen.getByRole("button", "Open Zulu listed").tap();
  await expect.poll(() => hui.url()).toContain("/sessions/");
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Zulu listed");
});

test("Search session registry filters by title, directory, runtime and group, and Filters narrows by status and groups rows by group or project until Reset filters", { tags: ["SESS-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const listed = (title: string) => screen.getByTestId("session-data-row").filter({ hasText: title });
  const status = async (title: string) => (await hui.api<Listed>("GET", "/__hui/sessions")).groups
    .flatMap((group) => group.sessions).find((session) => session.title === title)?.status;
  const search = screen.getByLabel("Search session registry");
  const repo = await hui.repository();
  await hui.createSession({ title: "Zulu registry", group: "Registry team" });
  await hui.createSession({ title: "Bravo registry", cwd: repo.path, group: "Registry team" });
  await hui.createSession({ title: "SDK charlie", tool: "pi", group: "Worker team" });
  const running = await hui.createSession({ title: "Delta running", group: "Registry team" });
  await hui.prompt(running, "E2E_REPLAY");
  await hui.provider.held();

  await hui.open("/sessions");
  await expect.poll(() => status("Delta running")).toBe("running");
  await expect(listed("Zulu registry")).toBeVisible();

  await search.fill("Zulu");
  await expect(listed("Zulu registry")).toBeVisible();
  await expect(listed("Bravo registry")).toBeHidden();
  await expect(listed("SDK charlie")).toBeHidden();
  await expect(listed("Delta running")).toBeHidden();

  await search.fill(basename(repo.path));
  await expect(listed("Bravo registry")).toBeVisible();
  await expect(listed("Zulu registry")).toBeHidden();
  await expect(listed("SDK charlie")).toBeHidden();

  await search.fill("durable");
  await expect(listed("Zulu registry")).toBeVisible();
  await expect(listed("Bravo registry")).toBeVisible();
  await expect(listed("SDK charlie")).toBeHidden();

  await search.fill("Worker team");
  await expect(listed("SDK charlie")).toBeVisible();
  await expect(listed("Zulu registry")).toBeHidden();
  await expect(listed("Bravo registry")).toBeHidden();

  await search.fill("");
  await expect(listed("Zulu registry")).toBeVisible();
  await screen.getByRole("button", { name: "Filters" }).tap();
  await screen.getByRole("button", "Running").tap();
  await expect(listed("Delta running")).toBeVisible();
  await expect(listed("Zulu registry")).toBeHidden();
  await expect(listed("SDK charlie")).toBeHidden();
  await screen.getByRole("button", "Reset filters").tap();
  await expect(listed("Zulu registry")).toBeVisible();
  await expect(listed("SDK charlie")).toBeVisible();

  const registry = screen.getByText("REGISTRY TEAM", { exact: true, visible: true });
  const project = screen.getByText(basename(repo.path), { exact: true, visible: true });
  await expect(registry).toHaveCount(1);
  await expect(project).toHaveCount(0);
  await screen.getByRole("button", "Group").tap();
  await expect(registry).toHaveCount(2);
  await expect(screen.getByText("3 sessions", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 session", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Project").tap();
  await expect(registry).toHaveCount(1);
  await expect(project).toHaveCount(1);
  await expect(screen.getByText("3 sessions", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 session", { exact: true })).toBeVisible();

  await screen.getByRole("button", "Reset filters").tap();
  await expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(project).toHaveCount(0);
  await expect(listed("Zulu registry")).toBeVisible();
  await expect(listed("SDK charlie")).toBeVisible();
});

test("a row's copy button copies its full path, and the table shows its empty, loading and error states", { tags: ["SESS-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const session = await hui.createSession({ title: "Zulu copied", cwd: repo.path });
  await hui.clipboard();
  await hui.open("/sessions");
  const copy = screen.getByRole("button", "Copy path of Zulu copied");
  await copy.tap();
  await expect.poll(() => hui.copied()).toBe(repo.path);
  await expect(copy).toHaveAttribute("data-hui-tooltip", "Copied");

  const events = await hui.intercept("GET", /\/__hui\/sessions\/events$/u);
  const loading = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.reload();
  await loading.arrived();
  await expect(screen.getByRole("table")).toContainText("Loading sessions…");
  await loading.deliver();
  await expect(screen.getByTestId("session-data-row").filter({ hasText: "Zulu copied" })).toBeVisible();
  await events.deliver();

  const statuses = await hui.intercept("GET", /\/__hui\/sessions\/events$/u);
  const failing = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.reload();
  await failing.arrived();
  await failing.reject(503, "The session registry is unavailable.");
  await expect(screen.getByText("The session registry is unavailable.", { visible: true }).last()).toBeVisible();
  await statuses.deliver();

  await hui.api("DELETE", `/__hui/sessions/${session.id}`);
  await hui.reload();
  await expect(screen.getByText("No sessions yet", { visible: true }).last()).toBeVisible();
});
