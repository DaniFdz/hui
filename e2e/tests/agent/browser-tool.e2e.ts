/** The agent's managed browser in the chat: the activity rows a browse leaves, the preview card that follows it live
 * and keeps its last frame, and the one fresh frame a reload draws (AGENT-054, AGENT-055, AGENT-056). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("an agent browses in HUI's headless browser with real input and reports what the page rendered", { tags: ["AGENT-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Browser tool" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_BROWSER");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });

  // The reply holds what the page rendered after the click the agent made on its own snapshot's ref.
  await expect(transcript.getByText(/^The headless browser rendered:/u)).toContainText("Hello, HUI agent!");

  // Every one of the five calls is a browser activity row of its own: the open names its host, each act says a page
  // element was touched, and the read and the screenshot say the browser was used.
  await hui.scrollTo(transcript, transcript.getByText("Used 5 tools"));
  await transcript.getByText("Used 5 tools").tap();
  await expect(transcript.getByRole("button", /^Opened 127\.0\.0\.1 Done$/u)).toBeVisible();
  await expect(transcript.getByRole("button", /^Acted on the page Done$/u)).toHaveCount(2);
  await expect(transcript.getByRole("button", /^Used the browser Done$/u)).toHaveCount(2);

  // No window on the host: the view reports the mode the call ran in.
  await hui.openWorkView("Browser");
  await expect(screen.getByText(/^(Live|Idle) · headless$/u)).toBeVisible();
});

test("the chat's Browser preview follows the browse live, keeps its last frame and moves to the newest turn", { tags: ["AGENT-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Browser preview" });
  await hui.open(`/sessions/${session.id}`);
  // The card is in the chat, and the pane the chat sits beside was never opened by it.
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();
  await hui.prompt(session, "E2E_BROWSER_SLOW");

  // Before the first frame the card says the page is opening, and it is live while the turn runs.
  await expect(transcript.getByText("Opening the page…")).toBeVisible({ timeout: 60_000 });
  await expect(transcript.getByText("Live", { exact: true })).toBeVisible();
  const frame = transcript.getByRole("img", { name: "What the agent's browser shows: HUI browser fixture" });
  await expect(frame).toBeVisible();
  await expect(transcript.getByText(/^http:\/\/127\.0\.0\.1:\d+\/browser-fixture$/u)).toBeVisible();

  // Each call narrates itself in the card's footer: the typing, then the click.
  await expect(transcript.getByText(/^Typed 9 characters into e\d+ \(textbox "Name"\)$/u)).toBeVisible();
  await expect(transcript.getByText(/^Clicked e\d+ \(button "Greet"\)$/u)).toBeVisible();

  // The turn ends: Live is gone, the last frame and its last action stay.
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await expect(transcript.getByText("Live", { exact: true })).toBeHidden();
  await expect(frame).toBeVisible();
  await expect(transcript.getByText("Took a screenshot")).toBeVisible();
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();

  // A later browser turn moves the one card under the newest activity instead of leaving a second behind.
  await hui.prompt(session, "E2E_BROWSER_SLOW");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await expect(frame).toHaveCount(1);
  const [card, activity] = [(await frame.boundingBox())!, (await transcript.getByText("Used 5 tools").last().boundingBox())!];
  expect(card.y).toBeGreaterThan(activity.y);
});

test("after a reload the preview draws one fresh frame without streaming, and nothing when no tab is left", { tags: ["AGENT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Browser preview reload" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_BROWSER");
  const frame = transcript.getByRole("img", { name: "What the agent's browser shows: HUI browser fixture" });
  await expect(frame).toBeVisible({ timeout: 120_000 });

  // The tab outlives the turn, so the reloaded page draws it once and does not keep streaming it.
  await hui.reload();
  await expect(frame).toBeVisible({ timeout: 60_000 });
  await expect(transcript.getByText("Live", { exact: true })).toBeHidden();
  await expect(transcript.getByText("Connecting…")).toBeHidden();

  // Closing the last tab leaves nothing to draw, so the card goes.
  await hui.prompt(session, call("browser", { action: "close" }));
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 60_000 });
  await hui.reload();
  await expect(transcript.getByText("Used 5 tools")).toBeVisible();
  await expect(frame).toHaveCount(0);
});
