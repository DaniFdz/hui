/**
 * A secondary click over a selection formats it from the composer's own toolbar (CHAT-097). The strip is a toolbar named
 * Format selection: its twelve buttons are the inline marks, the blocks the selection can become and the clipboard's
 * three items; a toggle says what the selection carries in `aria-pressed`, one action is one undo step, Escape closes the
 * strip and gives the editor its focus back, and the keyboard's Shift+F10 opens the same strip. The draft is long enough
 * that the composer's own box lies over the words in the middle of it, which is where a secondary click has to land on a
 * browser that collapses a selection clicked outside it: the selection is every word but the last, and the strip says
 * what that range carries.
 *
 * A strip button the keyboard focus grows also shows HUI's tooltip, and a tooltip takes Escape first wherever it is open
 * (`components/badge-hovercard.ts`). The composer answers that key on the document's capture phase while the strip is
 * open, so the keyboard's way out of the strip is one press: it closes the strip and leaves the caret in the editor
 * whether the pointer or Shift+F10 opened it.
 *
 * A block action keeps the strip open over the range it changed, which is a promise about the selection and not only
 * about the document: the last section puts the paragraph into a quote and reads back a strip that is still open, a
 * pressed Quote and a range Cut can still cut.
 */
import { expect, type Locator, type Role } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** The draft's words, and the tail a secondary click leaves out of the selection it formats. */
const DRAFT = "Select every word of this draft and format the whole range from the toolbar that opens over it, without taking a line of the writing, and keep the last few words of the draft plain here.";
const TAIL = " here.";

/** The words the selection holds once the tail is trimmed from the keyboard. */
const CHOSEN = DRAFT.slice(0, -TAIL.length);

/** The draft after the pasted words land at the end of that selection. */
const PASTED = `${CHOSEN} and pasted${TAIL}`;

/** Every button the strip draws, by the name the toolbar gives it. */
const BUTTONS = ["Bold", "Italic", "Strikethrough", "Inline code", "Quote", "Note", "Bullet list", "Code block", "Text", "Cut", "Copy", "Paste"];

/** The buttons whose `aria-pressed` says what the selection carries: the marks and the blocks the others make. */
const TOGGLES = ["Bold", "Italic", "Strikethrough", "Inline code", "Quote", "Note", "Bullet list", "Code block"];

/**
 * The draft's strong words. The engine names `<strong>` with HTML-AAM's `strong` role, and the SDK's `Role` union lists
 * only the widget vocabulary, so the name is cast to it: the query built is the same one `getByRole` builds for every
 * role.
 */
const strong = (target: Locator) => target.getByRole("strong" as Role);

test("a secondary click on a selection formats it from the toolbar, and Escape gives the composer back", { tags: ["CHAT-097"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const toolbar = screen.getByRole("toolbar", "Format selection");
  const bold = toolbar.getByRole("button", "Bold");

  const session = await hui.createSession({ title: "Selection toolbar" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.pressSequentially(DRAFT);
  await expect(wire).toHaveValue(DRAFT);

  /** Selects every word of the draft but its tail, from the keyboard: all of it, then one character back per press. */
  const select = async () => {
    await message.press("ControlOrMeta+a");
    for (let step = 0; step < TAIL.length; step += 1) await message.press("Shift+ArrowLeft");
  };

  await select();
  await hui.contextMenu(message);
  await expect(toolbar).toBeVisible();
  for (const name of BUTTONS) await expect(toolbar.getByRole("button", name)).toBeVisible();
  // The selection carries no mark and no block yet, so every toggle reports itself unpressed.
  for (const name of TOGGLES) await expect(toolbar.getByRole("button", name)).toHaveAttribute("aria-pressed", "false");

  // One press is one transaction: the draft draws the words strong and the hidden field carries the markers at once.
  await bold.tap();
  await expect(wire).toHaveValue(`**${CHOSEN}**${TAIL}`);
  await expect(strong(message)).toHaveText(CHOSEN);
  await expect(bold).toHaveAttribute("aria-pressed", "true");

  // Escape closes the strip and gives the editor its focus back, over the selection the strip was opened on.
  await toolbar.press("Escape");
  await expect(toolbar).toBeHidden();
  await expect(message).toBeFocused();

  // One undo puts the draft back exactly as it was, because the action was one step of its history.
  await message.press("ControlOrMeta+z");
  await expect(wire).toHaveValue(DRAFT);
  await expect(strong(message)).toHaveCount(0);

  // A paste chord still reaches the composer after the strip was opened, used and closed: the caret goes to the end of
  // the selection the strip closed over, and the clipboard's own text lands there.
  await message.press("ArrowRight");
  await hui.paste(" and pasted");
  await expect(wire).toHaveValue(PASTED);

  // An empty selection is the platform's own: a secondary click over a caret opens no strip.
  await hui.contextMenu(message);
  await expect(toolbar).toBeHidden();

  // The keyboard's own menu key opens the same strip with focus on its first enabled button, and the arrows step.
  await select();
  await message.press("Shift+F10");
  await expect(toolbar).toBeVisible();
  await expect(bold).toBeFocused();
  await toolbar.press("ArrowRight");
  await expect(toolbar.getByRole("button", "Italic")).toBeFocused();
  await toolbar.press("ArrowLeft");
  await expect(bold).toBeFocused();
  // Escape closes the strip and gives the editor its focus back, in one press even though the focused button shows HUI's
  // tooltip: the composer answers the key before that card does (CHAT-031), so the tooltip takes no press of its own.
  await toolbar.press("Escape");
  await expect(toolbar).toBeHidden();
  await expect(message).toBeFocused();
  await expect(wire).toHaveValue(PASTED);

  // The strip is placed inside the viewport it is opened on, at a desktop's width and at a phone's.
  for (const size of ["wide", "phone"] as const) {
    if (size === "wide") await hui.wideScreen();
    else await hui.phoneScreen();
    await select();
    await message.press("Shift+F10");
    await expect(toolbar).toBeVisible();
    const viewport = await hui.viewportSize();
    expect(viewport).toEqual(size === "wide" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
    await expect.poll(async () => {
      const box = await toolbar.boundingBox();
      if (!box) return `the ${size} strip lays out no box`;
      const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
      return inside ? "inside" : `${size} strip at ${box.x},${box.y} ${box.width}x${box.height} in ${viewport.width}x${viewport.height}`;
    }, { message: `the ${size} strip stays inside the viewport` }).toBe("inside");
    await transcript.tap();
    await expect(toolbar).toBeHidden();
  }

  // A block action keeps the strip open over the range it changed: the paragraph the selection sits in went into a quote,
  // Quote is what the selection now carries, and taking that quote away again leaves the same range selected — Cut has
  // something to cut, which the caret a lost selection would leave does not. (A mark action like Bold is only half of it:
  // wrapping a block maps the selection for free, and taking a container away is what has to keep it.)
  await hui.wideScreen();
  await select();
  await message.press("Shift+F10");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", "Quote").tap();
  await expect(wire).toHaveValue(`> ${PASTED}`);
  await expect(toolbar.getByRole("button", "Quote")).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", "Text").tap();
  await expect(wire).toHaveValue(PASTED);
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", "Cut")).toBeEnabled();

  // One undo puts the quote back the way Text took it away, and the draft is the block it was.
  await message.press("ControlOrMeta+z");
  await expect(wire).toHaveValue(`> ${PASTED}`);
});
