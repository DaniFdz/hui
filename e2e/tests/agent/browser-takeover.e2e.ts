/** The operator takes the agent's browser without waiting for a handoff: one click stops the running turn, the tab
 * survives, the pane is the page itself — click, type, drag-select, double/triple click, copy and paste with the real
 * clipboard, and a long press for the page's context menu — and Continue releases the tab without resuming the run. */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { backToChat, openWork } from "../work/work-views.ts";

/** A fixture value, not a credential: long enough to prove the whole clipboard value crossed. */
const PASSWORD = "V7!k#Q2m@R9$tW4xL6&pN8*zB3^cF5_hJ1+gD0=sA2%yU6(iO4)eK8";

const chord = async (hui: Hui, key: string) => {
  await hui.keyboard.down("Control");
  await hui.keyboard.down(key);
  await hui.keyboard.up(key);
  await hui.keyboard.up("Control");
};

const taken = async (screen: Screen, hui: Hui) => {
  const session = await hui.createSession({ title: "Take over the browser" });
  const pane = screen.getByLabel("Work pane");
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Browser");
  await hui.prompt(session, "E2E_BROWSER_TAKEOVER");
  const take = pane.getByRole("button", "Take control");
  await expect(take).toBeVisible({ timeout: 120_000 });
  await take.click();
  await expect(pane.getByText("You have control. The agent is stopped.")).toBeVisible();
  await expect(pane.getByText("You have control", { exact: true })).toBeVisible();
  await expect(pane.getByText("You have control; the agent is stopped.")).toBeVisible();
  await expect(take).toHaveCount(0);
  const frame = pane.getByLabel("You have control of the page");
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  if (!box) throw new Error("the takeover frame has no box");
  return { pane, frame, box };
};

test("the operator takes the agent's browser and drives the page as a device screen", { tags: ["AGENT-076"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { pane, frame, box } = await taken(screen, hui);
  const picker = pane.getByRole("button", /^Browser tab: /u);

  // A click focuses the page's Name field, and the keys go into it.
  await frame.click({ position: { x: box.width / 2, y: box.height * 0.3 } });
  await hui.type("Ada");
  await expect(picker).toHaveAttribute("aria-label", /\(typed 3\)$/u);

  // A long press opens the page's own context menu.
  await frame.longPress({ duration: 800 });
  await expect(picker).toHaveAttribute("aria-label", /\(menu\)$/u);

  // Continue releases the tab without resuming the stopped run.
  await pane.getByRole("button", "I'm done — continue").click();
  await expect(pane.getByText("You finished; the agent is stopped. Write in chat to continue.")).toBeVisible();
  await expect(pane.getByRole("button", "Take control")).toBeVisible();
  await backToChat(screen);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
});

test("the operator copies page text and pastes it with the keyboard", { tags: ["AGENT-077"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { pane, frame, box } = await taken(screen, hui);
  const picker = pane.getByRole("button", /^Browser tab: /u);
  // Ctrl+A selects the field's text, Ctrl+C copies it, and Ctrl+V inserts it into the next field.
  await frame.click({ position: { x: box.width / 2, y: box.height * 0.3 } });
  await hui.type("Ada");
  await chord(hui, "a");
  await expect(picker).toHaveAttribute("aria-label", /\(selected 3\)$/u);
  await chord(hui, "c");
  await frame.click({ position: { x: box.width / 2, y: box.height * 0.75 } });
  await chord(hui, "v");
  await expect(picker).toHaveAttribute("aria-label", /\(pasted 3\)$/u);

  // An external clipboard value takes the same paste path.
  await hui.paste(PASSWORD);
  await expect(picker).toHaveAttribute("aria-label", /\(pasted 57\)$/u);
});

test("the copy control writes the page selection when the clipboard API is refused", { tags: ["AGENT-077"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The page refuses the async clipboard and records the legacy copy path instead.
  await hui.clipboard({ refuse: true, legacyCopy: true });
  const { frame, box } = await taken(screen, hui);

  await frame.click({ position: { x: box.width / 2, y: box.height * 0.3 } });
  await hui.type("Ada");
  await chord(hui, "a");
  await chord(hui, "c");
  await expect.poll(() => hui.copied(), { timeout: 15_000 }).toBe("Ada");
});
