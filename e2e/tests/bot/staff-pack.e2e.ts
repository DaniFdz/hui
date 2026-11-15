/** A fresh gateway ships the staff pack: one sleeping Chief of Staff, its own skills in the bot panel, and the five
 * default subagent routes that inherit the caller's model (BOT-070). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openBot, showBotPanel } from "./bot-panel.ts";

test("a fresh gateway ships a Chief of Staff with the staff pack's skills and routes", { tags: ["BOT-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  await openBot(screen, hui, "Chief of Staff");
  const panel = await showBotPanel(screen, "Chief of Staff");
  await panel.getByRole("button", /^Tools & skills/u).tap();
  const search = screen.getByLabel("Search skills");
  await search.fill("chief-mode");
  await expect(screen.getByLabel("Skill chief-mode")).toBeVisible();
  await search.fill("plan");
  await expect(screen.getByLabel("Skill plan")).toBeVisible();

  await hui.open("/settings/models");
  for (const name of ["planner", "explorer", "worker", "reviewer", "verifier"]) {
    await expect(screen.getByLabel(`Edit route ${name}`)).toBeVisible();
  }
  await expect(screen.getByLabel("Route planner").getByText(/Inherits the caller's model/u)).toBeVisible();
});
