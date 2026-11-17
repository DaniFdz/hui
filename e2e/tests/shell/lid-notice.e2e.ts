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

  // This host is not the Mac the notice is about, so every read of the lid switch answers the Mac held awake. The answer
  // stands before the first load, so that load's own read, every poll three seconds later and every reload take it: a
  // stub registered after a load leaves the poll that load starts to the real gateway. The state it serves is also the
  // point of the check below, which reads no notice on Home even though the lid switch is on and held awake.
  await hui.clearOffline();
  await hui.answerAll("GET", /\/__hui\/power$/u, status(true, "active"));
  await hui.open("/");
  await expect(start).toBeVisible();
  await expect(notice).toHaveCount(0);

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
  // Answering a request removes every route on its pattern, this test's standing answer included, so the state the
  // gateway holds once the switch is off goes back in after it and later polls cannot bring the notice back.
  await switched.answer(status(false, "off"));
  await hui.answerAll("GET", /\/__hui\/power$/u, status(false, "off"));
  await expect(notice).toBeHidden();
  await expect(message).toBeFocused();
});
