/** A failed chat action shows its error in the shell's toast, which Dismiss notification closes and repeating the action shows again (CHAT-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const REFUSED = "The fixture refused this model switch.";

test("a failed chat action shows a dismissible toast in the trailing top corner, and repeating it shows it again", { tags: ["CHAT-021"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Refused switch" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const header = screen.getByTestId("chat-header");
  const picker = screen.getByLabel(/^Model: /u);
  const toast = screen.getByText(REFUSED, { exact: true });
  const other = "HUI Route Fixture";

  // A switch the gateway refuses: the error is the toast's text, in the page once.
  const refuse = async () => {
    const held = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/model$/u);
    await picker.tap();
    await screen.getByRole("listbox", "Model").getByRole("option", { name: new RegExp(other, "u") }).tap();
    await held.reject(500, REFUSED);
  };

  await refuse();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(1);
  const head = (await header.boundingBox())!;
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(head.y + head.height);
  expect(box.x).toBeGreaterThan(head.x + head.width / 2);
  await expect(screen.getByLabel(/^Model: HUI SDK Fixture$/u)).toBeVisible();

  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(toast).toBeHidden();
  await refuse();
  await expect(toast).toBeVisible();

  // On a phone the same toast stays inside the screen, still below the header.
  const phone = await hui.phoneScreen();
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(toast).toBeHidden();
  await refuse();
  await expect(toast).toBeVisible();
  const narrow = (await toast.boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(phone.width);
  expect(narrow.y).toBeGreaterThanOrEqual(0);
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(phone.height);
  expect(narrow.y).toBeGreaterThanOrEqual((await header.boundingBox())!.y + (await header.boundingBox())!.height);
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(toast).toBeHidden();
});
