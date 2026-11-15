/** A card's updated time says where its stage came from, and only your placements carry the pin (BOARD-008). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a card's updated time says Placed by you, Reported by the agent or Not placed yet, and only your placements carry the pin", { tags: ["BOARD-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const placed = await hui.createSession({ title: "Placed card" });
  await hui.api("PATCH", `/__hui/sessions/${placed.id}`, { stage: "testing" });
  const reported = await hui.createSession({ title: "Reported card" });
  await hui.createSession({ title: "Untouched card" });
  await hui.prompt(reported, call("set_stage", { stage: "implementation" }));
  const rows = async () => (await hui.api<{ groups: { sessions: { id: string; stage?: string; stageOrigin?: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await rows()).find((row) => row.id === reported.id)?.stageOrigin).toBe("agent");

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const card = (title: string) => board.getByRole("listitem").filter({ hasText: title });
  const origin = (title: string) => card(title).getByText(/^\s*(?:just now|\d+s ago|\d+m ago|\d+h ago)\s*$/u);

  await expect(origin("Placed card")).toHaveAttribute("title", /^Placed by you · updated /u);
  await expect(card("Placed card").getByLabel("Stage placed by you")).toBeVisible();
  await expect(origin("Reported card")).toHaveAttribute("title", /^Reported by the agent · updated /u);
  await expect(card("Reported card").getByLabel("Stage placed by you")).toBeHidden();
  await expect(origin("Untouched card")).toHaveAttribute("title", /^Not placed yet · updated /u);
  await expect(card("Untouched card").getByLabel("Stage placed by you")).toBeHidden();
  await expect(board.getByLabel(/^workspace, Testing$/u).getByText("Placed card")).toBeVisible();
  await expect(board.getByLabel(/^workspace, Implementation$/u).getByText("Reported card")).toBeVisible();
});
