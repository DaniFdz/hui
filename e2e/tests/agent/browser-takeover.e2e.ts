/** The operator takes the agent's browser without waiting for a handoff: one click stops the running turn, the tab
 * survives, a click focuses the page's field and a link navigates, pasted text reaches the focused element from the
 * strip or the keyboard, and Continue releases the tab without resuming the run (AGENT-075, AGENT-076, AGENT-077). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openWork } from "../work/work-views.ts";

/** A fixture password, not a credential: long enough to prove the whole value crossed and never came back. */
const PASSWORD = "V7!k#Q2m@R9$tW4xL6&pN8*zB3^cF5_hJ1+gD0=sA2%yU6(iO4)eK8";

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
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  const frame = pane.getByLabel("You have control of the page");
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  if (!box) throw new Error("the takeover frame has no box");
  return { pane, frame, box };
};

test("the operator takes the agent's browser, clicks through the page and pastes a password", { tags: ["AGENT-075", "AGENT-076"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const { pane, frame, box } = await taken(screen, hui);
  const picker = pane.getByRole("button", /^Browser tab: /u);

  // A click focuses the page's Name field, and the keys go into it.
  await frame.click({ position: { x: box.width / 2, y: box.height * 0.4 } });
  await hui.type("Ada");
  await expect(picker).toHaveAttribute("aria-label", /\(typed 3\)$/u);

  // The takeover strip's field sends the password to the page's focused element and clears itself. The
  // page reports only the length, so the value never appears in the title, the transcript or a log.
  await frame.click({ position: { x: box.width / 2, y: box.height * 0.6 } });
  const strip = pane.getByLabel("Text to send into the page");
  await strip.fill(PASSWORD);
  await pane.getByRole("button", "Send", { exact: true }).click();
  await expect(picker).toHaveAttribute("aria-label", /\(pasted 54\)$/u);
  await expect(transcript).not.toContainText(PASSWORD);

  // A click on a link navigates the page, so the tab's own title and address change under the operator.
  await frame.click({ position: { x: box.width / 2, y: 20 } });
  await expect(picker).toHaveAttribute("aria-label", /\/browser-fixture$/u);

  // Continue releases the tab without resuming the stopped run.
  await pane.getByRole("button", "I'm done — continue").click();
  await expect(pane.getByText("You finished; the agent is stopped. Write in chat to continue.")).toBeVisible();
  await expect(pane.getByLabel("Text to send into the page")).toHaveCount(0);
  await expect(pane.getByRole("button", "Take control")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});

test("the operator pastes into the page with the keyboard", { tags: ["AGENT-077"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const { pane, frame, box } = await taken(screen, hui);
  const picker = pane.getByRole("button", /^Browser tab: /u);

  await frame.click({ position: { x: box.width / 2, y: box.height * 0.4 } });
  await hui.type("Ada");
  await expect(picker).toHaveAttribute("aria-label", /\(typed 3\)$/u);

  // The frame's paste event reads the clipboard, not a forwarded Control+V chord.
  await hui.paste("Chord!");
  await expect(picker).toHaveAttribute("aria-label", /\(typed 9\)$/u);
  await expect(transcript).not.toContainText("Chord!");
});
