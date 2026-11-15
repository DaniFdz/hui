/** A link shared from another app opens New Session with the shared text already in the message box, once, ahead of a
 * draft already typed and without sending anything (SESS-080). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string }[] }[] };

const SHARED = "https://x.com/danifdz/status/1987654321098765432";
const SEED = `Look this post in X ${SHARED}`;
const address = (value: string) => `/new-session?share=${encodeURIComponent(value)}`;

test("a shared link fills New Session, leaves the address clean and sends nothing", { tags: ["SESS-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");
  const listed = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions).length;
  const before = await listed();

  await hui.open(address(SHARED));
  await expect(message).toHaveValue(SEED);
  // The address that carried the share is canonical again, so a reload cannot paste it a second time.
  await expect.poll(async () => new URL(await hui.url()).search).toBe("");
  await expect.poll(() => hui.newSessionDraft()).toBe(SEED);
  await hui.reload();
  await expect(message).toHaveValue(SEED);
  // A share only fills the composer: with no directory chosen there is nothing to start, and no session was created.
  await expect(screen.getByRole("button", "Start session")).toBeDisabled();
  expect(await listed()).toBe(before);
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
