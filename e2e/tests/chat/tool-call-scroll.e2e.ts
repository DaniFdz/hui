/** An opened tool call taller than its cap scrolls inside its own card, at a desktop's and a phone's width (CHAT-091). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** Far more output than the card's 520px / 60vh cap shows: a line too long for the card, many rows, then a tail line. */
const command = [
  "set -eu",
  "printf 'A long command inside its card\\n'",
  "printf 'UNBROKEN-%0400d\\n' 0",
  'seq -f "row-%03g of 160: the quick brown fox jumps over the lazy dog" 1 160',
  'printf "TAIL-MARKER: the last line of the output\\n"',
].join("\n");

test("a tool call taller than its cap scrolls inside its card, at a desktop's and a phone's width", { tags: ["CHAT-091"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "A long tool call" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await hui.prompt(session, call("bash", { command }));
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();

  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const row = transcript.getByRole("button", /^Ran /u);
  if (!(await row.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, row);
  await row.tap();

  const body = screen.getByTestId("tool-call-body");
  const commandLine = body.getByTestId("tool-call-command");
  /** The output block itself, not a match inside its text: the pre holds the whole output and is the box the card has to
   * show, so its height is what the card is measured against. */
  const output = body.getByTestId("tool-call-output");
  await expect(body).toBeVisible();
  await expect(commandLine).toBeAttached();
  await expect(output).toBeAttached();

  /** A part of the opened call with the card around it, both read while nothing above them moves: a locator has no
   * scrollTop, so the difference of two boxes is the proof of what the card shows. An attempt is discarded when the
   * card's box moved between the two reads, because a transcript scrolling under it then makes that difference a lie.
   * This reads the card's own box only: the card scrolling its content inside that box is the subject of the
   * measurement, not something these two reads can see. */
  const boxes = async (part: Locator) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [before, box] = [await body.boundingBox(), await part.boundingBox()];
      const after = await body.boundingBox();
      if (!before || !box || !after) throw new Error("the opened call or a part of it lays out no box");
      if (before.y === after.y && before.height === after.height) return { card: after, part: box };
    }
    throw new Error("the opened call keeps moving: nothing above it stands still");
  };

  /** How far the output's bottom runs past the card's, and how far its top sits above the card's. */
  const travel = async () => {
    const { card, part: lines } = await boxes(output);
    return { below: lines.y + lines.height - (card.y + card.height), above: card.y - lines.y };
  };

  /** How far the body's top sits below the command's: a body that scrolls lifts its own command out of view, while a
   * body that only clips leaves the command pinned to its top and moves an inner block alone. */
  const commandOut = async () => {
    const { card, part: line } = await boxes(commandLine);
    return card.y - line.y;
  };

  /** Each wheel is bounded by the state it changes: back up while the body has scrolled its command out of its top. */
  const bodyToTop = async () => {
    for (let step = 0; step < 60 && (await commandOut()) > 0; step++) await hui.wheel(body, -600);
    await expect.poll(commandOut, { message: "the wheel takes the body back to its top" }).toBeLessThanOrEqual(0);
  };

  for (const size of ["wide", "phone"] as const) {
    if (size === "wide") await hui.wideScreen();
    else await hui.phoneScreen();
    const viewport = await hui.viewportSize();
    expect(viewport).toEqual(size === "wide" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
    await hui.scrollTo(transcript, body);

    // The card keeps the shorter of 520px and 60vh, and holds far more than it shows.
    const [card, lines] = [await body.boundingBox(), await output.boundingBox()];
    expect(Math.abs(card!.height - Math.min(520, viewport.height * 0.6))).toBeLessThanOrEqual(2);
    expect(lines!.height).toBeGreaterThan(card!.height + 200);

    // The body is the card's one scroll region: clicking the command focuses the card inside it, and a page-down on
    // that focus scrolls the body itself rather than an inner block.
    if (size === "wide") {
      await commandLine.click();
      await hui.keyboard.down("PageDown");
      await hui.keyboard.up("PageDown");
      await expect.poll(commandOut, { message: "a page-down on the focused card scrolls the body itself" }).toBeGreaterThanOrEqual(50);
    }

    // Each wheel is bounded by the state it changes: back to the body's top, then on to the tail, so each size starts
    // the tail loop where it does today. The up-wheels can carry on into the transcript once the body has reached its
    // top, which moves the call away from the point a wheel uses, so it is revealed again before the tail loop.
    await bodyToTop();
    await hui.scrollTo(transcript, body);
    for (let step = 0; step < 60 && (await travel()).below > 0; step++) await hui.wheel(body, 600);
    await expect.poll(async () => (await travel()).below, { message: `the end of the output stays inside the ${size} card` }).toBeLessThanOrEqual(0);
    expect((await travel()).above).toBeGreaterThanOrEqual(100);
    expect(await commandOut()).toBeGreaterThanOrEqual(100);

    // The long unbroken line is contained: it never widens the card past the transcript or the page at 390px, and the
    // card stays inside the body's own horizontal band instead of spilling out of it.
    if (viewport.width === 390) {
      expect(await hui.overflowX()).toBe(0);
      const [bodyBox, transcriptBox] = [await body.boundingBox(), await transcript.boundingBox()];
      expect(card!.width).toBeLessThanOrEqual(transcriptBox!.width);
      expect(card!.x).toBeGreaterThanOrEqual(bodyBox!.x - 1);
      expect(card!.x + card!.width).toBeLessThanOrEqual(bodyBox!.x + bodyBox!.width + 1);
    }
  }
});
