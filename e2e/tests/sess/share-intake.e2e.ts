/** A link or a text shared from another app opens New Session with the shared text already in the message box, once,
 * ahead of a draft already typed and without sending anything (SESS-080). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const SHARED = "https://x.com/danifdz/status/1987654321098765432";
const SEED = `Look this post in X ${SHARED}`;
const REDDIT = "https://www.reddit.com/r/hui/comments/abc/";
const address = (value: string) => `/new-session?share=${encodeURIComponent(value)}`;

test("a shared link fills New Session, leaves the address clean and sends nothing", { tags: ["SESS-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");

  await hui.open(address(SHARED));
  await expect(message).toHaveValue(SEED);
  // The address that carried the share is canonical again, so a reload cannot paste it a second time.
  await expect.poll(async () => new URL(await hui.url()).search).toBe("");
  // A share only fills the composer, so the page still shows New Session: no session was opened in its place.
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe("/new-session");
  await expect.poll(() => hui.newSessionDraft()).toBe(SEED);
  await hui.reload();
  // One copy of the seed, not two, and the launch draft still holds exactly it: starting a session clears that draft,
  // and nothing here started one.
  await expect(message).toHaveValue(SEED);
  await expect.poll(() => hui.newSessionDraft()).toBe(SEED);
});

test("a share lands above a New Session draft already typed, below one blank line", { tags: ["SESS-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");

  await hui.open("/");
  await message.fill("A draft I was typing");
  await expect.poll(() => hui.newSessionDraft()).toBe("A draft I was typing");

  await hui.open(address(SHARED));
  await expect(message).toHaveValue(`${SEED}\n\nA draft I was typing`);
  await expect.poll(() => hui.newSessionDraft()).toBe(`${SEED}\n\nA draft I was typing`);
  await expect.poll(async () => new URL(await hui.url()).search).toBe("");
});

test("a text with no link fills New Session as it was shared", { tags: ["SESS-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");

  await hui.open(address("Remember to water the plants"));
  await expect(message).toHaveValue("Remember to water the plants");
  await expect.poll(async () => new URL(await hui.url()).search).toBe("");
  // Reading a share only fills the composer, so New Session is still the page: no session took its place.
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe("/new-session");
});

test("a link from another site becomes its sentence naming that site", { tags: ["SESS-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");

  await hui.open(address(REDDIT));
  await expect(message).toHaveValue(`Look this post in Reddit ${REDDIT}`);
  await expect.poll(async () => new URL(await hui.url()).search).toBe("");
});
