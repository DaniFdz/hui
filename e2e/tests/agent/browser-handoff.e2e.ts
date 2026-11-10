/** The managed browser driven by an agent in steps calls and handoffs, and what Stop leaves behind: a sequence of
 * dependent steps in one call, the tab a person takes over, and a browsing turn cancelled mid-run (AGENT-064,
 * AGENT-065, AGENT-058). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const browser = (input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "browser", input })).toString("base64url")}`;

test("a dependent browser flow runs as one steps call that lists every step and names a failing one", { tags: ["AGENT-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Browser steps" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_BROWSER_STEPS");
  await expect(idle).toBeVisible({ timeout: 120_000 });

  // The one call reports every step in order with what it did, and the card says a sequence ran.
  await expect(transcript.getByText(/^The flow ran in one call:/u)).toBeVisible();
  const steps = [
    transcript.getByText(/^type: Typed 12 characters into e\d+ \(textbox "Name"\)\.$/u),
    transcript.getByText(/^click: Clicked e\d+ \(button "Greet"\)\.$/u),
    transcript.getByText(/^wait: /u),
  ];
  const tops: number[] = [];
  for (const step of steps) {
    await expect(step).toBeVisible();
    tops.push((await step.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await expect(transcript.getByText("Ran a sequence of steps")).toBeVisible();

  // A failing step names itself and the steps that already ran.
  await hui.prompt(session, browser({ action: "steps", steps: [{ kind: "type", ref: "e1", text: "x" }, { kind: "click", ref: "e99" }] }));
  await expect(transcript.getByText(/Step 2 \(click\) failed: Ref e99 is not in tab t\d+'s latest snapshot/u)).toBeVisible();
  await expect(transcript.getByText(/Steps that ran: 1\. type: Typed 1 character into e\d+ \(textbox "Name"\)\./u)).toBeVisible();

  // A navigation retires the refs the earlier snapshot handed out, so a later step using one fails.
  const page = await hui.textOf(transcript.getByText(/^http:\/\/127\.0\.0\.1:\d+\/browser-fixture$/u).first());
  await hui.prompt(session, browser({ action: "navigate", url: page }));
  await expect(idle).toBeVisible({ timeout: 60_000 });
  await hui.prompt(session, browser({ action: "steps", steps: [{ kind: "click", ref: "e1" }] }));
  await expect(transcript.getByText(/Step 1 \(click\) failed: Ref e1 is not in tab t\d+'s latest snapshot/u)).toBeVisible({ timeout: 60_000 });
});

test("an agent hands its tab to the operator, and the wait ends on Continue, on its timeout or when the browser stops", { tags: ["AGENT-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Browser handoff" });
  await hui.open(`/sessions/${session.id}`);
  const instruction = "Type your name into the Name field and click Greet, then press I'm done — continue.";
  await hui.prompt(session, "E2E_BROWSER_HANDOFF");

  // The chat's card says whose turn it is, with the agent's instruction and the way to take over.
  const waiting = /Your turn\. Type your name into the Name field/u;
  await expect(transcript.getByText(waiting)).toBeVisible({ timeout: 120_000 });
  await expect(transcript.getByText(waiting)).toContainText(instruction);
  const takeOver = transcript.getByRole("button", "Take over");
  await expect(takeOver).toBeVisible();
  await takeOver.tap();
  const pane = screen.getByRole("complementary", "Work pane");
  await expect(pane.getByText("You have control; the agent waits.")).toBeVisible();
  await expect(pane.getByText(waiting)).toContainText(instruction);
  await expect(pane.getByText("Your turn", { exact: true })).toBeVisible();

  // The operator's own pointer and keys reach the page: the field, then the button that submits it.
  const frame = screen.getByLabel("Your turn: the agent is waiting");
  await frame.tap();
  await hui.type("Operator");
  await hui.keyboard.down("Tab");
  await hui.keyboard.up("Tab");
  await hui.keyboard.down("Enter");
  await hui.keyboard.up("Enter");
  await screen.getByRole("button", "I'm done — continue").tap();

  // Continue returns the page as the operator left it, which is what the agent reports next.
  await expect(transcript.getByText(/^The operator finished in the browser:/u)).toContainText("Hello, Operator! Typed by the operator.", { timeout: 120_000 });
  await expect(idle).toBeVisible();
  // The tab stays open and the agent has it back.
  await expect(screen.getByText(/^(Live|Idle) · headless$/u)).toBeVisible();
  await expect(transcript.getByText(waiting)).toBeHidden();

  // A wait nobody answers ends after its own timeout.
  const second = /Your turn\. Finish the page yourself/u;
  await hui.prompt(session, browser({ action: "handoff", message: "Finish the page yourself.", timeoutMs: 5_000 }));
  await expect(transcript.getByText(second)).toBeVisible();
  await expect(transcript.getByText(/did not take over tab t\d+ within 5 seconds/u)).toBeVisible({ timeout: 60_000 });
  await expect(transcript.getByText(second)).toBeHidden();

  // The browser stopping under the wait ends it too.
  await hui.prompt(session, browser({ action: "handoff", message: "Finish the page yourself.", timeoutMs: 300_000 }));
  await expect(screen.getByRole("complementary", "Work pane").getByText(second)).toBeVisible();
  await hui.open("/settings/tools");
  await screen.getByRole("button", "Stop").tap();
  await hui.open(`/sessions/${session.id}`);
  await expect(transcript.getByText(/The managed browser stopped while the operator had tab t\d+\./u)).toBeVisible({ timeout: 60_000 });
});
