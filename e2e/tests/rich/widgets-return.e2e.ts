/** A widget found again after leaving: it is back and still interactive after a reload, Back and Forward between
 * sessions and a gateway restart, and a widget that navigates its own frame or whose sandbox does not start stops with
 * the reason and a Retry that brings it back (RICH-060). A card whose saved code no longer renders is not asserted here:
 * nothing can leave a transcript holding widget code the chat refuses, so that clause stays reported, not covered. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** The counter keeps its count inside the sandbox, so a live document counts up and a new one starts again at zero. */
const COUNTER = `<div id="counter"><button type="button" class="primary" id="add">Add one</button><output id="count" data-testid="count" aria-live="polite">0</output></div>
<script>
let count = 0;
document.getElementById("add").addEventListener("click", () => {
  count += 1;
  document.getElementById("count").textContent = String(count);
});
</script>`;

/** A widget whose own control leaves the document it was given. */
const LEAVES = `<div id="leaver"><button type="button" class="primary" id="leave">Leave the frame</button><p>Still here.</p></div>
<script>
document.getElementById("leave").addEventListener("click", () => {
  location.href = "https://example.com/left";
});
</script>`;

const widget = async (hui: Hui, index = 0) => (await hui.frame(`iframe.hui-widget-card__frame >> nth=${index}`)).frameLocator("iframe");

/** The counter counts up once, which is what "still interactive" means here. */
const counts = async (hui: Hui, index = 0) => {
  const inside = await widget(hui, index);
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByTestId("count")).toHaveText("1");
};

test("A widget comes back, still interactive, after a reload, Back and Forward between sessions and a gateway restart, and one that leaves its frame or cannot start says why and retries", { tags: ["RICH-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Returning widget" });
  await hui.prompt(session, call("show_widget", { title: "Counter", widget_code: COUNTER }));
  await hui.open(`/sessions/${session.id}`);
  const card = screen.getByLabel("Widget: Counter");
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await counts(hui);

  // A reload: the widget is drawn again from the transcript and works.
  await hui.reload();
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await counts(hui);

  // Leaving the chat and coming back through history: the widget is there both ways.
  const other = await hui.createSession({ title: "Another session" });
  await hui.prompt(other, `E2E_REPLY:${Buffer.from("Nothing to see here.").toString("base64url")}`);
  await hui.open(`/sessions/${other.id}`);
  await expect(screen.getByTestId("transcript").getByText("Nothing to see here.")).toBeVisible();
  await hui.back();
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await counts(hui);
  await hui.forward();
  await expect(screen.getByTestId("transcript").getByText("Nothing to see here.")).toBeVisible();
  await hui.back();
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await counts(hui);

  // A gateway restart: the app reconnects, the session settles and the widget is live again.
  await hui.restartGateway();
  await expect(screen.getByRole("status", "Session status: Idle")).toBeVisible();
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await counts(hui);

  // A widget that navigates its own frame stops with the reason, and Retry loads it again.
  await hui.prompt(session, call("show_widget", { title: "Leaver", widget_code: LEAVES }));
  const leaver = screen.getByLabel("Widget: Leaver");
  await expect(leaver.getByText("Interactive widget · sandboxed")).toBeVisible();
  const leaving = await widget(hui, 1);
  await leaving.getByRole("button", "Leave the frame").tap();
  const stopped = leaver.getByRole("alert");
  await expect(stopped).toContainText("The widget tried to navigate away from its frame and was stopped.");
  await expect(leaver.getByText("Stopped")).toBeVisible();
  await leaver.getByRole("button", "Retry").tap();
  await expect(leaver.getByText("Interactive widget · sandboxed")).toBeVisible();
  const again = await widget(hui, 1);
  await expect(again.getByText("Still here.")).toBeVisible();

  // A sandbox that never starts says so, with the Retry that would load it again.
  const sandbox = await hui.intercept("GET", /widget-sandbox/u);
  const blocked = await hui.createSession({ title: "Blocked sandbox" });
  await hui.prompt(blocked, call("show_widget", { title: "Never starts", widget_code: COUNTER }));
  await hui.open(`/sessions/${blocked.id}`);
  await sandbox.arrived();
  await sandbox.reject(503, "The sandbox is unreachable");
  const never = screen.getByLabel("Widget: Never starts");
  await expect(never.getByRole("alert")).toContainText("The widget sandbox did not start. Reload the page to try again.");
  await expect(never.getByRole("button", "Retry")).toBeVisible();
});
