/** TEMPORARY measurement probe for the RICH catch-up: it dumps the geometry mermaid drew inside this engine and fails
 * with it, so the trace carries the numbers. Deleted before the branch is handed over. */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const FLOWCHART = "flowchart LR\n  Idea[Idea] --> Model{Useful model}\n  Model -->|yes| Explain[Explain clearly]\n  Model -->|no| Prose[Use concise prose]\n";

const rect = async (target: Locator) => {
  const box = await target.boundingBox();
  return box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null;
};

const describe = async (label: string, host: Locator, within: Locator, hui: Hui) => ({
  label,
  host: await rect(host),
  within: await rect(within),
  labels: await Promise.all(["Idea", "Useful model", "Explain clearly", "Use concise prose"].map(async (text) => ({
    text,
    count: await host.getByText(text).count(),
    box: await rect(host.getByText(text).first()),
  }))),
});

const describeSvg = async (svg: Locator, hui: Hui) => ({
  count: await svg.count(),
  box: await rect(svg.first()),
  viewBox: await svg.first().getAttribute("viewBox"),
  widthAttr: await svg.first().getAttribute("width"),
  heightAttr: await svg.first().getAttribute("height"),
  styleAttr: (await svg.first().getAttribute("style"))?.slice(0, 200) ?? null,
  look: await hui.look(svg.first()),
});

test("probe the diagram geometry this engine draws", { tags: ["RICH-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Probe" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(`Before.\n\n\`\`\`mermaid\n${FLOWCHART}\`\`\`\n\nAfter.`).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  const diagram = transcript.getByLabel("Mermaid diagram");
  await expect(diagram.getByText("Useful model")).toBeVisible();
  await expect(transcript.getByText("Rendering diagram…")).toBeHidden();
  const embed = { ...await describe("embed", diagram, transcript, hui), svg: await describeSvg(diagram.getByRole("document"), hui) };

  await diagram.tap();
  const viewer = screen.getByLabel("Mermaid diagram viewer: mermaid-diagram");
  await expect(viewer).toBeVisible();
  const stage = screen.getByLabel("Mermaid diagram: scroll or pinch to zoom, drag to pan");
  const inViewer = {
    level: await viewer.getByRole("button", /^Zoom \d+%\. Fit to screen$/u).getAttribute("aria-label"),
    ...await describe("viewer", viewer, stage, hui),
  };
  await screen.getByRole("button", "Close viewer").tap();
  await expect(viewer).toBeHidden();

  throw new Error(`PROBE ${JSON.stringify({ embed, inViewer }, null, 1)}`);
});
