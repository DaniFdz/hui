/** A canonical Slack permalink alone in the latest user or assistant message becomes a Slack message or channel card naming the workspace and channel it came from and linking to the original, with no request to Slack, and it survives a reload, while labeled, mixed-prose, http and non-canonical Slack links stay ordinary (RICH-016). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const CHANNEL = "https://acme.slack.com/archives/C01234567";
const MESSAGE = "https://acme.slack.com/archives/C01234567/p1723456789012345";
const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;

test("A Slack permalink alone in the latest message becomes a Slack message or channel card that survives a reload, while other Slack links stay ordinary", { tags: ["RICH-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const requests = await hui.intercept("GET", /slack\.com/u);
  let fetched = false;
  void requests.arrived().then(() => { fetched = true; });

  const user = await hui.createSession({ title: "Slack channel" });
  await hui.prompt(user, CHANNEL);
  await hui.open(`/sessions/${user.id}`);
  const channel = screen.getByTestId("transcript").getByLabel("Slack channel");
  await expect(channel).toHaveCount(1);
  await expect(channel.getByText("Slack channel", { exact: true })).toBeVisible();
  await expect(channel.getByText("acme · C01234567")).toBeVisible();
  await hui.expectLinkTo(channel, "Open in Slack", CHANNEL);
  await hui.reload();
  await expect(screen.getByTestId("transcript").getByLabel("Slack channel")).toHaveCount(1);

  const assistant = await hui.createSession({ title: "Slack reply" });
  await hui.prompt(assistant, say(`${MESSAGE}\n\nSee ${CHANNEL} for context.\n\n[Open the channel](${CHANNEL})\n\nhttp://acme.slack.com/archives/C01234567\n\nhttps://app.slack.com/client/T01234567`));
  await hui.open(`/sessions/${assistant.id}`);
  let transcript = screen.getByTestId("transcript");
  const message = transcript.getByLabel("Slack message");
  await expect(message).toHaveCount(1);
  await expect(message.getByText("Slack message", { exact: true })).toBeVisible();
  await expect(message.getByText("acme · C01234567")).toBeVisible();
  await hui.expectLinkTo(message, "Open in Slack", MESSAGE);
  await expect(transcript.getByLabel("Slack channel")).toHaveCount(0);
  await hui.expectLinkTo(transcript, CHANNEL, CHANNEL);
  await hui.expectLinkTo(transcript, "Open the channel", CHANNEL);
  await hui.expectLinkTo(transcript, "http://acme.slack.com/archives/C01234567", "http://acme.slack.com/archives/C01234567");
  await hui.expectLinkTo(transcript, "https://app.slack.com/client/T01234567", "https://app.slack.com/client/T01234567");

  await hui.reload();
  transcript = screen.getByTestId("transcript");
  await expect(transcript.getByLabel("Slack message")).toHaveCount(1);
  await expect(transcript.getByText("acme · C01234567")).toBeVisible();
  expect(fetched).toBe(false);
});