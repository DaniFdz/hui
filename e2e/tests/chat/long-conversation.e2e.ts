/** A long conversation opens on its latest rows, Show earlier messages adds the ones before in place, and Scroll to latest goes back (CHAT-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type SessionList = { groups: { sessions: { id: string; status: string }[] }[] };

test("a long conversation opens on its latest rows, shows earlier ones in place and goes back to the latest", { tags: ["CHAT-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const showEarlier = screen.getByRole("button", "Show earlier messages", { exact: false });
  const session = await hui.createSession({ title: "Long conversation" });
  const status = async () => (await hui.api<SessionList>("GET", "/__hui/sessions")).groups
    .flatMap((group) => group.sessions).find(({ id }) => id === session.id)?.status;
  for (let step = 1; step <= 26; step++) {
    await expect.poll(status).toBe("idle");
    await hui.api("POST", `/__hui/sessions/${session.id}/prompt`, { text: `Step ${step}` });
  }
  await expect.poll(status).toBe("idle");

  await hui.open(`/sessions/${session.id}`);
  await expect(transcript.getByText("Step 26")).toBeVisible();
  await expect(transcript.getByText("Step 2")).toBeAttached();
  await expect(transcript.getByText("Step 1")).toBeAttached({ attached: false });

  await showEarlier.scrollIntoView();
  const before = await transcript.getByText("Step 2").boundingBox();
  await showEarlier.tap();
  await expect(transcript.getByText("Step 1")).toBeAttached();
  await expect(showEarlier).toBeHidden();
  const after = await transcript.getByText("Step 2").boundingBox();
  expect(Math.round(after!.y)).toBe(Math.round(before!.y));

  await screen.getByRole("button", "Scroll to latest").tap();
  await expect(transcript.getByText("Step 26")).toBeVisible();
  await expect(transcript.getByText("Step 1")).toBeAttached({ attached: false });
});
