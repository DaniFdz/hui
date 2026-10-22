/** A session's stage changes from its card's Options menu, by dragging it, with Shift and the arrow keys, or when its agent calls set_stage (BOARD-004, BOARD-005, BOARD-006, BOARD-009). */
import { basename } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const lanes = (screen: Screen, hui: Hui) => {
  const board = screen.getByLabel("Kanban board");
  const workspace = basename(hui.workspace);
  return {
    board,
    cell: (stage: string, lane = workspace) => board.getByLabel(`${lane}, ${stage}`),
    card: (title: string) => board.getByRole("listitem").filter({ hasText: title }),
  };
};

const placement = async (hui: Hui, id: string) => {
  const sessions = (await hui.api<{ groups: { sessions: { id: string; stage?: string; stageOrigin?: string }[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const session = sessions.find((candidate) => candidate.id === id);
  return `${session?.stage} from ${session?.stageOrigin}`;
};

test("Options → Move to → Testing moves the card once the server confirms, pinned as your placement with focus kept, across a reload", { tags: ["BOARD-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Menu move" });
  await hui.open("/kanban");
  const { board, cell, card } = lanes(screen, hui);
  await expect(cell("Investigation").getByText("Menu move")).toBeVisible();

  const move = await hui.intercept("PATCH", new RegExp(`/__hui/sessions/${session.id}$`, "u"));
  const options = board.getByRole("button", "Stage: Investigation. Options for Menu move");
  await options.tap();
  for (const stage of ["Investigation", "Implementation", "Testing", "Done"]) await expect(screen.getByLabel("Options for Menu move").getByText(stage, { visible: true })).toBeVisible();
  await screen.getByLabel("Options for Menu move").getByText("Testing", { visible: true }).tap();
  await move.arrived();
  await expect(options).toBeDisabled();
  await expect(cell("Investigation").getByText("Menu move")).toBeVisible();
  await move.deliver();

  await expect(screen.getByText("Moved Menu move to Testing.")).toBeVisible();
  await expect(cell("Testing").getByText("Menu move")).toBeVisible();
  await expect(card("Menu move").getByLabel("Stage placed by you")).toBeVisible();
  await expect(card("Menu move").getByLabel("Menu move, Idle, Testing")).toBeFocused();
  await hui.reload();
  await expect(cell("Testing").getByText("Menu move")).toBeVisible();
  await expect(card("Menu move").getByLabel("Stage placed by you")).toBeVisible();
});

test("a refused move shows the error and leaves the card where it was", { tags: ["BOARD-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Refused move" });
  await hui.open("/kanban");
  const { board, cell, card } = lanes(screen, hui);
  await expect(cell("Investigation").getByText("Refused move")).toBeVisible();
  const move = await hui.intercept("PATCH", new RegExp(`/__hui/sessions/${session.id}$`, "u"));
  await board.getByRole("button", "Stage: Investigation. Options for Refused move").tap();
  await screen.getByLabel("Options for Refused move").getByText("Done", { visible: true }).tap();
  await move.reject(503, "The registry is read-only right now.");
  await expect(screen.getByText("The registry is read-only right now.")).toBeVisible();
  await expect(cell("Investigation").getByText("Refused move")).toBeVisible();
  await expect(card("Refused move").getByLabel("Stage placed by you")).toBeHidden();
});

test("dragging a card onto another stage of its lane places it once the server confirms, while Backlog and other projects' lanes dim and refuse it", { tags: ["BOARD-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const session = await hui.createSession({ title: "Dragged card" });
  await hui.createSession({ title: "Other project card", cwd: repo.path });
  await hui.open("/kanban");
  const { cell, card } = lanes(screen, hui);
  const elsewhere = cell("Testing", basename(repo.path));
  await expect(cell("Investigation").getByText("Dragged card")).toBeVisible();

  await hui.drag(card("Dragged card"), elsewhere, async () => {
    expect((await hui.look(cell("Backlog"))).opacity).toBeLessThan(1);
    expect((await hui.look(elsewhere)).opacity).toBeLessThan(1);
    expect((await hui.look(cell("Testing"))).opacity).toBe(1);
  });
  await hui.drag(card("Dragged card"), cell("Backlog"), async () => {
    expect((await hui.look(cell("Backlog"))).opacity).toBeLessThan(1);
  });
  await expect(cell("Investigation").getByText("Dragged card")).toBeVisible();
  expect(await placement(hui, session.id)).toBe("investigation from default");

  const move = await hui.intercept("PATCH", new RegExp(`/__hui/sessions/${session.id}$`, "u"));
  await card("Dragged card").dragTo(cell("Testing"));
  await move.arrived();
  await expect(cell("Investigation").getByText("Dragged card")).toBeVisible();
  await move.deliver();
  await expect(screen.getByText("Moved Dragged card to Testing.")).toBeVisible();
  await expect(cell("Testing").getByText("Dragged card")).toBeVisible();
  await expect(card("Dragged card").getByLabel("Stage placed by you")).toBeVisible();
});

test("Shift+ArrowRight and Shift+ArrowLeft move the focused card a stage at a time, and nothing moves past the first or last stage", { tags: ["BOARD-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Keyed card" });
  await hui.open("/kanban");
  const { card } = lanes(screen, hui);
  const title = (stage: string) => card("Keyed card").getByLabel(`Keyed card, Idle, ${stage}`);
  await title("Investigation").focus();
  await title("Investigation").press("Shift+ArrowLeft");
  await expect(title("Investigation")).toBeFocused();
  expect(await placement(hui, session.id)).toBe("investigation from default");

  for (const [from, to] of [["Investigation", "Implementation"], ["Implementation", "Testing"], ["Testing", "Done"]]) {
    await title(from!).press("Shift+ArrowRight");
    await expect(screen.getByText(`Moved Keyed card to ${to}.`)).toBeVisible();
    await expect(title(to!)).toBeFocused();
  }
  await title("Done").press("Shift+ArrowRight");
  await expect(title("Done")).toBeFocused();
  await expect(screen.getByText("Moved Keyed card to Done.")).toBeVisible();
  await title("Done").press("Shift+ArrowLeft");
  await expect(screen.getByText("Moved Keyed card to Testing.")).toBeVisible();
  await expect(title("Testing")).toBeFocused();
});

test("set_stage moves the card on the next refresh as the agent's report, a card you placed stays put, and Backlog is refused", { tags: ["BOARD-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reported = await hui.createSession({ title: "Agent reported" });
  const placed = await hui.createSession({ title: "Agent overruled" });
  await hui.api("PATCH", `/__hui/sessions/${placed.id}`, { stage: "testing" });
  await hui.open("/kanban");
  const { cell, card } = lanes(screen, hui);
  await expect(cell("Investigation").getByText("Agent reported")).toBeVisible();

  await hui.prompt(reported, call("set_stage", { stage: "implementation" }));
  await expect.poll(() => placement(hui, reported.id)).toBe("implementation from agent");
  await screen.getByRole("button", "Refresh").tap();
  await expect(cell("Implementation").getByText("Agent reported")).toBeVisible();
  await expect(card("Agent reported").getByText("just now")).toHaveAttribute("title", /^Reported by the agent · updated /u);
  await expect(card("Agent reported").getByLabel("Stage placed by you")).toBeHidden();

  const transcript = screen.getByTestId("transcript");
  await hui.prompt(placed, call("set_stage", { stage: "done" }));
  await hui.open(`/sessions/${placed.id}`);
  await expect(transcript.getByText(/^tool answered: .*The operator placed this session in Testing; their placement wins until they reset it\./u)).toBeVisible();
  await hui.prompt(placed, call("set_stage", { stage: "backlog" }));
  await expect(transcript.getByText(/^tool answered: [\s\S]*Validation failed for tool "set_stage"/u)).toBeVisible();
  await hui.open("/kanban");
  await expect(cell("Testing").getByText("Agent overruled")).toBeVisible();
  expect(await placement(hui, placed.id)).toBe("testing from operator");
});
