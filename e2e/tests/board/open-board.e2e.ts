/** Kanban opens the board of sessions, one lane per project, its loading and failed states, and its narrow layout (BOARD-001). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const COLUMNS = ["Backlog", "Investigation", "Implementation", "Testing", "Done"];

test("Kanban, directly below Contributions, opens /kanban with the five columns and a lane per project, without archived or subagent sessions", { tags: ["BOARD-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const parent = await hui.createSession({ title: "Board parent" });
  const child = await hui.createSubagent(parent);
  const archived = await hui.createSession({ title: "Board archived" });
  await hui.api("PATCH", `/__hui/sessions/${archived.id}`, { archived: true });
  const placed = await hui.createSession({ title: "Board testing" });
  await hui.api("PATCH", `/__hui/sessions/${placed.id}`, { stage: "testing" });
  await hui.createSession({ title: "Board repository", cwd: repo.path });

  await hui.open("/");
  const contributions = await screen.getByText("Contributions", { visible: true }).boundingBox();
  const kanban = screen.getByText("Kanban", { visible: true });
  const below = await kanban.boundingBox();
  expect(below!.y).toBeGreaterThanOrEqual(contributions!.y + contributions!.height);
  expect(below!.y).toBeLessThan(contributions!.y + 2 * contributions!.height);
  await kanban.tap();

  const board = screen.getByLabel("Kanban board");
  const workspace = basename(hui.workspace);
  await expect(board.getByLabel(`${workspace}, Investigation`).getByText("Board parent")).toBeVisible();
  expect(new URL(await hui.url()).pathname).toBe("/kanban");
  for (const column of COLUMNS) await expect(board.getByLabel(`${workspace}, ${column}`)).toBeVisible();
  await expect(board.getByLabel(`${workspace}, Testing`).getByText("Board testing")).toBeVisible();
  await expect(board.getByLabel(`${basename(repo.path)}, Investigation`).getByText("Board repository")).toBeVisible();
  const lane = board.getByLabel(workspace);
  await expect(lane.getByText(hui.workspace)).toBeVisible();
  await expect(lane.getByText("2")).toBeVisible();
  await expect(lane.getByText("1")).toHaveCount(2);
  await expect(lane.getByText("0")).toHaveCount(3);
  const repoLane = board.getByLabel(basename(repo.path));
  await expect(repoLane.getByText(repo.path)).toBeVisible();
  await expect(repoLane.getByText("1")).toHaveCount(2);
  await expect(repoLane.getByText("0")).toHaveCount(4);
  await expect(board.getByText(child.title)).toBeHidden();
  await expect(board.getByText("Board archived")).toBeHidden();
});

test("while sessions load the board says Loading sessions…, and a failed load shows its error", { tags: ["BOARD-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Loaded card" });
  const loading = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.open("/kanban");
  await loading.arrived();
  await expect(screen.getByText("Loading sessions…", { visible: true }).last()).toBeVisible();
  await loading.deliver();
  await expect(screen.getByLabel("Kanban board").getByText("Loaded card")).toBeVisible();

  const statuses = await hui.intercept("GET", /\/__hui\/sessions\/events$/u);
  const failing = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.reload();
  await failing.reject(503, "The session registry is unavailable.");
  await expect(screen.getByText("The session registry is unavailable.", { visible: true }).last()).toBeVisible();
  await statuses.deliver();
});

test("on a narrow screen the header controls wrap and the board scrolls sideways", { tags: ["BOARD-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Narrow card" });
  const phone = await hui.phoneScreen();
  await hui.open("/kanban");
  const workspace = basename(hui.workspace);
  const board = screen.getByLabel("Kanban board");
  await expect(board.getByLabel(`${workspace}, Investigation`).getByText("Narrow card")).toBeVisible();

  const title = await screen.getByText("Kanban", { visible: true }).boundingBox();
  const filter = await screen.getByPlaceholder("Filter cards…").boundingBox();
  const refresh = await screen.getByRole("button", "Refresh", { visible: true }).boundingBox();
  expect(filter!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
  expect(refresh!.x + refresh!.width).toBeLessThanOrEqual(phone.width);

  const done = board.getByLabel(`${workspace}, Done`);
  expect((await done.boundingBox())!.x).toBeGreaterThanOrEqual(phone.width);
  await done.scrollIntoView();
  const shown = await done.boundingBox();
  expect(shown!.x + shown!.width).toBeLessThanOrEqual(phone.width);
});
