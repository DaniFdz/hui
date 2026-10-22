/** New Session suggests project folders and inspects the chosen one's checkout, starts on the chosen model, effort and speed, and reopens recent chats (SESS-003, SESS-004, SESS-006). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string; title: string; model?: string }[] }[] };

test("Project directory suggests the folders under the typed prefix, and choosing one inspects its checkout", { tags: ["SESS-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const directory = screen.getByPlaceholder("~/");
  const folder = screen.getByText(`${repository.path}/sub/`, { exact: true });

  await hui.open("/");
  await directory.fill(`${repository.path}/s`);
  await expect(folder).toBeVisible();
  await directory.fill(`${repository.path}/x`);
  await expect(folder).toBeHidden();
  await expect(screen.getByLabel(/^Checkout: /u)).toBeHidden();
  await directory.fill(`${repository.path}/s`);
  await folder.tap();
  await expect(directory).toHaveValue(`${repository.path}/sub/`);
  await expect(screen.getByLabel("Checkout: main")).toBeVisible();
});

test("the model, effort and speed chosen on New Session are what the session starts on", { tags: ["SESS-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const options = screen.getByLabel("Model", { exact: true });

  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Run on Opus");
  const effort = screen.getByLabel(/^Thinking: /u);
  await effort.tap();
  await expect(screen.getByLabel("Thinking effort")).toBeVisible();
  await expect(screen.getByLabel("Speed")).toBeHidden();
  await effort.tap();
  await expect(screen.getByLabel("Thinking effort")).toBeHidden();
  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await screen.getByLabel("Search models").fill("opus");
  await expect(options.getByText("HUI SDK Fixture")).toBeHidden();
  await options.getByText("Opus fixture").tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();

  await effort.tap();
  await screen.getByLabel("Thinking effort").fill("0");
  await screen.getByLabel("Speed").getByText("Fast").tap();
  await expect(screen.getByLabel("Thinking: low, fast")).toBeVisible();
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await expect(screen.getByLabel("Thinking: low, fast")).toBeVisible();
  const sessions = (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  expect(sessions.find((session) => session.title === "Run on Opus")?.model).toBe("hui-e2e/anthropic/claude-opus-5-5");
});

test("Recent chats lists the five most recently updated top-level sessions that are not archived, and opens one", { tags: ["SESS-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const ids: string[] = [];
  for (const title of ["Recent 0", "Recent 1", "Recent 2", "Recent 3", "Recent 4"]) ids.push((await hui.createSession({ title })).id);
  const parent = await hui.createSession({ title: "Recent parent" });
  await hui.createSubagent(parent);
  const archived = await hui.createSession({ title: "Recent archived" });
  await hui.api("PATCH", `/__hui/sessions/${archived.id}`, { archived: true });
  await hui.prompt({ id: ids[0]! }, "Bring Recent 0 back up");
  const recent = screen.getByLabel("Recent chats");

  await hui.open("/");
  await expect.poll(() => recent.getByRole("button").allTextContents())
    .toEqual(["Recent 0", "Recent parent", "Recent 4", "Recent 3", "Recent 2"].map((title) => `${title} this hour`));
  await recent.getByRole("button", "Open Recent 3").tap();
  await expect(screen.getByTestId("session-title")).toHaveText("Recent 3");
  expect(await hui.url()).toMatch(new RegExp(`/sessions/${ids[3]}$`, "u"));
});
