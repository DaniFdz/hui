/** The lid-closed notice belongs to the open conversation: it is drawn in flow under the chat header, Home draws none, Dismiss lasts until the page reloads and Turn off asks the gateway for the lid switch off (SET-021). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** What `GET` and `PUT /__hui/power` answer: the lid switch, and whether HUI holds the Mac awake for it. */
const status = (lidOn: boolean, lidAwake: "active" | "off") => JSON.stringify({ power: {
  keepAwake: { state: "active", detail: "" },
  lidAwake: { state: lidAwake, detail: "" },
  lidOn,
} });

test("the lid-closed notice is drawn in the open conversation under its header, is absent from Home and Settings, and Dismiss and Turn off answer it", { tags: ["SET-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const notice = screen.getByLabel("Sleep prevention");
  const dismiss = notice.getByRole("button", "Dismiss sleep prevention notification");
  const turnOff = notice.getByRole("button", "Turn off");
  const message = screen.getByLabel("Message");
  const start = screen.getByRole("button", "Start session");
  const box = async (target: Locator) => (await target.boundingBox())!;

  // The power read is a page load's own request, so its route is in place before the load that asks, and this load's
  // own answer is what the checks below read: Home draws no notice even though the state says the lid is held awake.
  await hui.clearOffline();
  await hui.open("/");
  await expect(start).toBeVisible();
  const loaded = await hui.intercept("GET", /\/__hui\/power$/u);
  await hui.reload();
  await loaded.arrived();
  await loaded.answer(status(true, "active"));
  await expect(start).toBeVisible();
  await expect(notice).toHaveCount(0);
  // Every poll and later load answers the same state: a one-shot answer would be undone by the read three seconds later.
  await hui.answerAll("GET", /\/__hui\/power$/u, status(true, "active"));

  // Settings reads it too — the switch reflects the gateway's lid state — and draws no notice either.
  await hui.open("/settings/connection");
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Gateway");
  await expect(screen.getByRole("switch", "Stay awake with the lid closed")).toBeChecked();
  await expect(notice).toHaveCount(0);

  const session = await hui.createSession({ title: "Lid closed" });
  await hui.open(`/sessions/${session.id}`);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("This Mac won't sleep with the lid closed.");

  // In flow inside the conversation: below the chat header it starts, above the transcript it ends, and no wider than
  // the transcript it shares its column with, so no part of the shell moved for it.
  const placement = async () => {
    const header = await box(screen.getByTestId("chat-header"));
    const drawn = await box(notice);
    const transcript = await box(screen.getByTestId("transcript"));
    return {
      belowHeader: drawn.y >= header.y + header.height,
      aboveTranscript: drawn.y + drawn.height <= transcript.y,
      insideTranscriptColumn: drawn.x >= transcript.x && drawn.x + drawn.width <= transcript.x + transcript.width,
    };
  };
  await expect.poll(placement).toEqual({ belowHeader: true, aboveTranscript: true, insideTranscriptColumn: true });

  await dismiss.tap();
  await expect(notice).toBeHidden();
  await expect(message).toBeFocused();

  // Dismissal is this page's only: a reload draws the notice again while the lid switch is still on.
  await hui.reload();
  await expect(notice).toBeVisible();

  const switched = await hui.intercept("PUT", /\/__hui\/power$/u);
  await turnOff.tap();
  await switched.arrived();
  const sent = switched.request();
  expect({ method: sent.method, path: new URL(sent.url).pathname }).toEqual({ method: "PUT", path: "/__hui/power" });
  expect(JSON.parse(sent.body)).toEqual({ lidAwake: false });
  // Later polls read what the gateway holds once the switch is off, so they cannot bring the notice back.
  await hui.answerAll("GET", /\/__hui\/power$/u, status(false, "off"));
  await switched.answer(status(false, "off"));
  await expect(notice).toBeHidden();
  await expect(message).toBeFocused();
});
