/** Let the agent decide hands a stage you placed back to the agent: it works only for your placements, and choosing it removes the pin and returns the card to Investigation (BOARD-007). */
import { basename } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const lanes = (screen: Screen, hui: Hui) => {
  const board = screen.getByLabel("Kanban board");
  const workspace = basename(hui.workspace);
  return {
    board,
    cell: (stage: string) => board.getByLabel(`${workspace}, ${stage}`),
    card: (title: string) => board.getByRole("listitem").filter({ hasText: title }),
  };
};

test("Let the agent decide leaves a card you never placed alone, and on a card you placed it removes the pin and returns the card to Investigation", { tags: ["BOARD-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Handback fresh" });
  await hui.createSession({ title: "Handback placed" });
  await hui.open("/kanban");
  const { board, cell, card } = lanes(screen, hui);
  const options = (stage: string, title: string) => board.getByRole("button", `Stage: ${stage}. Options for ${title}`);
  const choose = (title: string, item: string) => screen.getByLabel(`Options for ${title}`).getByText(item, { visible: true }).tap();

  await expect(cell("Investigation").getByText("Handback fresh")).toBeVisible();
  await options("Investigation", "Handback fresh").tap();
  await choose("Handback fresh", "Let the agent decide");
  await screen.getByRole("button", "Refresh", { visible: true }).tap();
  await expect(cell("Investigation").getByText("Handback fresh")).toBeVisible();
  await expect(screen.getByText(/follows its agent again/u)).toBeHidden();

  await options("Investigation", "Handback placed").tap();
  await choose("Handback placed", "Testing");
  await expect(screen.getByText("Moved Handback placed to Testing.")).toBeVisible();
  await expect(card("Handback placed").getByLabel("Stage placed by you")).toBeVisible();
  await options("Testing", "Handback placed").tap();
  await choose("Handback placed", "Let the agent decide");
  await expect(screen.getByText("Handback placed follows its agent again (Investigation).")).toBeVisible();
  await expect(cell("Investigation").getByText("Handback placed")).toBeVisible();
  await expect(board.getByLabel(/^Handback placed, /u)).toHaveAccessibleName("Handback placed, Idle, Investigation");
  await expect(card("Handback placed").getByLabel("Stage placed by you")).toBeHidden();
});
