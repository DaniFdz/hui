/** An image attached to a message: a bounded thumbnail named for the file opens the media viewer, it is served again by
 * the gateway after a reload, and an image whose bytes cannot load turns into the file's card instead (RICH-025). */
import { readFile } from "node:fs/promises";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const NAME = "wide-shot.png";
const SHOT = new URL("../../fixtures/files/wide-shot.png", import.meta.url);

/** The pixel size a PNG declares in its own header. */
async function declared(url: URL) {
  const bytes = await readFile(url);
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") throw new Error(`${url.pathname} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("An attached image is a bounded thumbnail named for the file that opens the viewer, comes from the gateway after a reload, and turns into the file's card when its bytes cannot load", { tags: ["RICH-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const png = await declared(SHOT);
  const ratio = png.width / png.height;
  const session = await hui.createSession({ title: "Attached image" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.attach(screen.getByLabel("Choose photos"), [NAME]);
  await expect(screen.getByRole("button", `Remove ${NAME}`, { visible: true })).toBeVisible();
  await screen.getByLabel("Message", { visible: true }).fill("What is in this screenshot?");
  await screen.getByRole("button", "Send message", { visible: true }).tap();

  const transcript = screen.getByTestId("transcript");
  const thumbnail = transcript.getByLabel(`Open ${NAME}`);
  await expect(thumbnail).toBeVisible();

  // A bounded thumbnail: never wider than the 240 px a transcript image may take, nor than a phone's screen. It is
  // the file's own pixels, drawn from what the gateway served.
  const phone = await hui.phoneScreen();
  const picture = transcript.getByRole("image", NAME);
  const drawn = async () => (await picture.boundingBox())!;
  await expect.poll(async () => (await drawn()).width).toBeLessThanOrEqual(240);
  await expect.poll(async () => (await drawn()).x + (await drawn()).width).toBeLessThanOrEqual(phone.width);
  expect(await hui.overflowX()).toBe(0);
  expect((await drawn()).width / (await drawn()).height).toBeCloseTo(ratio, 1);

  await thumbnail.tap();
  await expect(screen.getByLabel(`Image viewer: ${NAME}`)).toBeVisible();
  await screen.getByRole("button", "Close viewer").tap();
  await expect(screen.getByLabel(`Image viewer: ${NAME}`)).toBeHidden();

  // After a reload the message asks the gateway for the image again.
  const served = await hui.intercept("GET", /\/attachments\/[^/]+\/[^/]+$/u);
  await hui.reload();
  await served.arrived();
  await served.deliver();
  await expect(transcript.getByLabel(`Open ${NAME}`)).toBeVisible();
  const again = async () => (await picture.boundingBox())!;
  await expect.poll(async () => (await again()).width / (await again()).height).toBeCloseTo(ratio, 1);

  // Bytes the gateway cannot serve leave the file's card in place of the thumbnail.
  const bytes = await hui.intercept("GET", /\/attachments\/[^/]+\/[^/]+$/u);
  await hui.reload();
  await bytes.arrived();
  await bytes.reject(404, "The image is gone.");
  await expect(transcript.getByText(NAME, { exact: true })).toBeVisible();
  await expect(transcript.getByText("PNG", { exact: true })).toBeVisible();
  await expect(transcript.getByLabel(`Open ${NAME}`, { visible: true })).toHaveCount(0);
  await expect(transcript.getByText("What is in this screenshot?")).toBeVisible();
});
