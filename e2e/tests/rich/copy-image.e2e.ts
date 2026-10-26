/** Copy image in the media viewer: it puts the drawing's PNG on the clipboard and reports Image copied, reports Copied as rich content when the async clipboard refuses the write and the selection copy works, and reports The image could not be copied when neither works (RICH-021). */
import { expect, type Locator, type Screen } from "e2e";
import { test } from "../../fixtures/hui.ts";

const FLOWCHART = "flowchart LR\n  Idea[Idea] --> Model{Useful model}\n  Model -->|yes| Explain[Explain clearly]\n";
const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;

async function viewer(screen: Screen): Promise<Locator> {
  const open = screen.getByTestId("transcript").getByRole("button", "Open mermaid diagram viewer");
  await expect(open).toBeVisible();
  await open.tap();
  const dialog = screen.getByLabel("Mermaid diagram viewer: mermaid-diagram");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Copy image puts the drawing's PNG on the clipboard and reports Image copied, Copied as rich content or the failure", { tags: ["RICH-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const copy = async (dialog: Locator) => {
    const button = dialog.getByRole("button", "Copy image");
    await expect(button).toBeEnabled();
    await button.tap();
  };

  await hui.clipboard();
  const session = await hui.createSession({ title: "Copy image" });
  await hui.prompt(session, say(`\`\`\`mermaid\n${FLOWCHART}\`\`\``));
  await hui.open(`/sessions/${session.id}`);
  await copy(await viewer(screen));
  await expect(screen.getByText("Image copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("image/png");

  await hui.clipboard({ refuse: true, legacyCopy: true });
  await hui.reload();
  await copy(await viewer(screen));
  await expect(screen.getByText("Copied as rich content")).toBeVisible();

  await hui.clipboard({ refuse: true });
  await hui.reload();
  await copy(await viewer(screen));
  await expect(screen.getByText("The image could not be copied")).toBeVisible();
});