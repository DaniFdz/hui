/** An X post in a reply: the card loads X only after the reader consents with Load post, and when X's script cannot
 * load the card shows the load error next to a link to the post (RICH-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const POST = "https://x.com/hui_e2e/status/1723456789012345678";

const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;

test("When X's script cannot load, the post's card shows the load error with an Open on X link to the post and HUI stays put", { tags: ["RICH-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const script = await hui.intercept("GET", /platform\.twitter\.com/u);
  const session = await hui.createSession({ title: "X post" });
  await hui.prompt(session, say(`Before the post.\n\n${POST}\n\nAfter the post.`));
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();

  // The facade names X and what loading it would do, and links to the post without contacting X.
  const card = transcript.getByText("Post on X", { exact: true });
  await expect(card).toBeVisible();
  await hui.expectLinkTo(transcript, "Open on X", POST);
  await expect(transcript.getByRole("button", "Load post")).toBeVisible();

  const before = await hui.url();
  await transcript.getByRole("button", "Load post").tap();
  await script.arrived();
  await script.reject(503, "X is unreachable");

  await expect(transcript.getByText("X embed script could not be loaded.")).toBeVisible();
  await expect(card).toBeHidden();
  await hui.expectLinkTo(transcript, "Open on X", POST);
  expect(await hui.url()).toBe(before);
  await expect(transcript.getByText("Before the post.")).toBeVisible();
  await expect(transcript.getByText("After the post.")).toBeVisible();
});
