/** The sidebar's Search sessions field and Filter & sort menu narrow, order and group the session list without changing the registry (SESS-019, SESS-020, SESS-021, SESS-022). */
import { basename, dirname } from "node:path";
import { expect, type Screen } from "e2e";
import { test } from "../../fixtures/hui.ts";

const choose = async (screen: Screen, choice: string) => {
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByText(choice, { exact: true, visible: true }).tap();
};

test("Search sessions filters by title, directory and group, opens collapsed groups while searching, and the phone's Search focuses it", { tags: ["SESS-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  const search = screen.getByPlaceholder("Search sessions");
  const row = (title: string) => screen.getByTestId("session-row").filter({ hasText: title });
  await hui.createSession({ title: "Miami appearance" });
  await hui.createSession({ title: "Lisbon notes" });
  await hui.createSession({ title: "Kickoff call", group: "Atlas" });
  await hui.createSession({ title: "Budget review", group: "Atlas" });
  await hui.createSession({ title: "Upstairs draft", cwd: dirname(hui.workspace) });

  await hui.open("/");
  await expect(row("Upstairs draft")).toBeVisible();
  await search.fill("miami");
  await expect(row("Miami appearance")).toBeVisible();
  await expect(row("Lisbon notes")).toBeHidden();
  await expect(row("Kickoff call")).toBeHidden();

  await search.fill("atlas");
  await expect(row("Kickoff call")).toBeVisible();
  await expect(row("Budget review")).toBeVisible();
  await expect(row("Miami appearance")).toBeHidden();

  await search.fill(basename(hui.workspace));
  await expect(row("Lisbon notes")).toBeVisible();
  await expect(row("Upstairs draft")).toBeHidden();

  await search.fill("");
  await expect(row("Kickoff call")).toBeVisible();
  await screen.getByText("ATLAS", { exact: true, visible: true }).tap();
  await expect(row("Kickoff call")).toBeHidden();
  await search.fill("kickoff");
  await expect(row("Kickoff call")).toBeVisible();
  await search.fill("");
  await expect(row("Upstairs draft")).toBeVisible();
  await expect(row("Kickoff call")).toBeHidden();
  await expect(row("Budget review")).toBeHidden();

  await search.fill("no such session anywhere");
  await expect(screen.getByText("No matching sessions.")).toBeVisible();

  await search.fill("");
  await hui.phoneScreen();
  await screen.getByRole("button", "Search sessions").tap();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
});

test("Sort by orders rows by Created, Last updated, Name or Stage with pinned first, survives a reload and leaves the registry alone", { tags: ["SESS-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const order = () => screen.getByLabel(/^(Alpha|Bravo|Charlie|Delta|Echo) sort, status/u).allTextContents();
  const registry = async () => (await hui.api<{ groups: { label: string; sessions: { id: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.map(({ label, sessions }) => [label, sessions.map(({ id }) => id)]);
  const bravo = await hui.createSession({ title: "Bravo sort" });
  await hui.api("PATCH", `/__hui/sessions/${bravo.id}`, { stage: "testing" });
  const charlie = await hui.createSession({ title: "Charlie sort" });
  await hui.api("PATCH", `/__hui/sessions/${charlie.id}`, { stage: "done", pinned: true });
  await hui.createSession({ title: "Alpha sort" });
  await hui.createSession({ title: "Delta sort" });
  await hui.createSession({ title: "Echo sort" });
  await hui.prompt(bravo, "Bump Bravo");

  await hui.open("/");
  await expect(screen.getByLabel(/^Bravo sort, status idle, tool durable, stage testing/u)).toBeVisible();
  const before = await registry();
  await expect.poll(order).toEqual(["Charlie sort", "Bravo sort", "Echo sort", "Delta sort", "Alpha sort"]);
  await choose(screen, "Created");
  await expect.poll(order).toEqual(["Charlie sort", "Echo sort", "Delta sort", "Alpha sort", "Bravo sort"]);
  await choose(screen, "Stage");
  await expect.poll(order).toEqual(["Charlie sort", "Echo sort", "Delta sort", "Alpha sort", "Bravo sort"]);
  await choose(screen, "Last updated");
  await expect.poll(order).toEqual(["Charlie sort", "Bravo sort", "Echo sort", "Delta sort", "Alpha sort"]);
  await choose(screen, "Name");
  await expect.poll(order).toEqual(["Charlie sort", "Alpha sort", "Bravo sort", "Delta sort", "Echo sort"]);

  await hui.reload();
  await expect(screen.getByLabel(/^Bravo sort, status idle, tool durable, stage testing/u)).toBeVisible();
  await expect.poll(order).toEqual(["Charlie sort", "Alpha sort", "Bravo sort", "Delta sort", "Echo sort"]);
  expect(await registry()).toEqual(before);
});

test("Group by Project splits rows by directory with only New session, None lists every row together, and Custom groups returns across a reload", { tags: ["SESS-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = dirname(hui.workspace);
  const here = basename(hui.workspace).toLocaleUpperCase();
  const there = basename(parent).toLocaleUpperCase();
  const order = () => screen.getByLabel(/^(First|Second|Third) row, status/u).allTextContents();
  const heading = (label: string) => screen.getByText(label, { exact: true, visible: true });
  const first = await hui.createSession({ title: "First row", group: "Atlas" });
  await hui.createSession({ title: "Second row", cwd: parent });
  await hui.createSession({ title: "Third row", group: "Atlas" });

  await hui.open("/");
  await expect(heading("ATLAS")).toBeVisible();
  await expect(screen.getByRole("button", "Group options for Atlas")).toHaveCount(1);
  await expect.poll(order).toEqual(["Third row", "First row", "Second row"]);

  await choose(screen, "Project");
  await expect(heading(there)).toBeVisible();
  await expect(heading(here)).toBeVisible();
  await expect(heading("ATLAS")).toBeHidden();
  await expect(screen.getByRole("button", "Group options for Atlas")).toHaveCount(0);
  await expect.poll(order).toEqual(["Second row", "Third row", "First row"]);
  await screen.getByTestId("session-row").filter({ hasText: "First row" }).dragTo(heading(there));
  await hui.peek(heading(there));
  await screen.getByRole("button", `New session in ${there}`).tap();
  await expect(screen.getByLabel("Project directory")).toHaveValue(parent);
  await expect(screen.getByLabel("Choose session group")).toContainText("OTHER");
  await hui.reload();
  await expect(heading(there)).toBeVisible();
  await expect.poll(order).toEqual(["Second row", "Third row", "First row"]);

  await choose(screen, "None");
  await expect.poll(order).toEqual(["Third row", "Second row", "First row"]);
  await expect(heading(here)).toBeHidden();
  await expect(heading(there)).toBeHidden();

  await choose(screen, "Custom groups");
  await expect(heading("ATLAS")).toBeVisible();
  await expect.poll(order).toEqual(["Third row", "First row", "Second row"]);
  const listed = await hui.api<{ groups: { label: string; sessions: { id: string }[] }[] }>("GET", "/__hui/sessions");
  expect(listed.groups.find(({ sessions }) => sessions.some(({ id }) => id === first.id))?.label).toBe("Atlas");
});

test("Status shows only sessions in that live status, announces when none match with New group still there, and Hide empty groups follows its choice", { tags: ["SESS-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = (title: string) => screen.getByTestId("session-row").filter({ hasText: title });
  const empty = screen.getByText("EMPTY SHELF", { exact: true, visible: true });
  const busy = await hui.createSession({ title: "Busy one" });
  await hui.createSession({ title: "Quiet one" });
  await hui.api("POST", "/__hui/session-groups", { name: "Empty shelf" });

  await hui.open("/");
  await expect(empty).toBeVisible();
  await hui.prompt(busy, "E2E_REPLAY");
  await hui.provider.held();
  await expect(screen.getByLabel("Busy one, status running, tool durable, stage investigation")).toBeVisible();

  await choose(screen, "Running");
  await expect(row("Busy one")).toBeVisible();
  await expect(row("Quiet one")).toBeHidden();
  await expect(empty).toBeHidden();

  await choose(screen, "Error");
  await expect(screen.getByText("No matching sessions.")).toBeVisible();
  await expect(row("Busy one")).toBeHidden();
  await expect(screen.getByRole("button", "New group")).toBeVisible();

  await choose(screen, "Never");
  await expect(empty).toBeVisible();
  await expect(row("Quiet one")).toBeHidden();

  await choose(screen, "All");
  await expect(row("Quiet one")).toBeVisible();
  await choose(screen, "Always");
  await expect(empty).toBeHidden();
  await choose(screen, "When filtering");
  await expect(empty).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByLabel(/^Busy one, status idle, tool durable, stage investigation/u)).toBeVisible();
});
