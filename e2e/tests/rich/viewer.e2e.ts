/** The media viewer: a reply's diagram or chart opens full screen by click or from the keyboard, where keys zoom, pan, copy and close and Copy source copies its source; a remote Markdown image is never fetched, and an inline one opens in the viewer (RICH-009, RICH-017, RICH-018, RICH-020, RICH-022). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const FLOWCHART = "flowchart LR\n  Idea[Idea] --> Model{Useful model}\n  Model -->|yes| Explain[Explain clearly]\n  Model -->|no| Prose[Use concise prose]\n";
const CHART = JSON.stringify({ width: "container", height: 160, data: { values: [{ format: "Prose", score: 48 }, { format: "Chart", score: 91 }] }, mark: "bar", encoding: { x: { field: "format", type: "nominal" }, y: { field: "score", type: "quantitative" } } });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b82f6"/></svg>';

async function reply(screen: Screen, hui: Hui, prompt: string) {
  const session = await hui.createSession({ title: "Viewer" });
  await hui.prompt(session, prompt);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}
const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;

async function embeds(screen: Screen, hui: Hui) {
  const transcript = await reply(screen, hui, say(`\`\`\`mermaid\n${FLOWCHART}\`\`\`\n\n\`\`\`chart\n${CHART}\n\`\`\``));
  const diagram = transcript.getByLabel("Mermaid diagram");
  const chart = transcript.getByLabel("Data chart");
  await expect(diagram.getByRole("button", "Open mermaid diagram viewer")).toBeVisible();
  await expect(chart.getByRole("button", "Open chart viewer")).toBeVisible();
  return { diagram, chart };
}

async function fitted(viewer: Locator) {
  const level = viewer.getByRole("button", /^Zoom \d+%\. Fit to screen$/u);
  await expect(level).toBeEnabled();
  const opened = await level.getAttribute("aria-label");
  await level.tap();
  await expect(level).toHaveAttribute("aria-label", opened!);
}

const inside = async (inner: Locator, outer: Locator) => {
  const [a, b] = [(await inner.boundingBox())!, (await outer.boundingBox())!];
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
};

test("Clicking a diagram or chart, or its Open viewer control, opens the viewer fitted; Close viewer or the backdrop closes it and focuses the embed", { tags: ["RICH-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { diagram, chart } = await embeds(screen, hui);
  const viewer = screen.getByLabel("Mermaid diagram viewer: mermaid-diagram");
  const stage = screen.getByLabel("Mermaid diagram: scroll or pinch to zoom, drag to pan");

  await diagram.getByText("Useful model").tap();
  await expect(viewer).toBeVisible();
  await fitted(viewer);
  for (const label of ["Idea", "Explain clearly", "Use concise prose"]) await expect.poll(() => inside(viewer.getByText(label), stage)).toBe(true);
  await screen.getByRole("button", "Close viewer").tap();
  await expect(viewer).toBeHidden();
  await expect(diagram).toBeFocused();

  await diagram.getByRole("button", "Open mermaid diagram viewer").tap();
  await expect(viewer).toBeVisible();
  await stage.tap({ position: { x: 4, y: 4 } });
  await expect(viewer).toBeHidden();
  await expect(diagram).toBeFocused();

  const chartViewer = screen.getByLabel("Chart viewer: chart");
  await chart.tap();
  await expect(chartViewer).toBeVisible();
  await fitted(chartViewer);
  await screen.getByLabel("Chart: scroll or pinch to zoom, drag to pan").tap({ position: { x: 4, y: 4 } });
  await expect(chartViewer).toBeHidden();
  await expect(chart).toBeFocused();

  await chart.getByRole("button", "Open chart viewer").tap();
  await expect(chartViewer).toBeVisible();
  await screen.getByRole("button", "Close viewer").tap();
  await expect(chartViewer).toBeHidden();
  await expect(chart).toBeFocused();
});

test("Enter or Space on a focused diagram or chart opens the viewer", { tags: ["RICH-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { diagram, chart } = await embeds(screen, hui);
  for (const [embed, viewer] of [[diagram, "Mermaid diagram viewer: mermaid-diagram"], [chart, "Chart viewer: chart"]] as const) {
    for (const key of ["Enter", "Space"]) {
      await embed.focus();
      await embed.press(key);
      await expect(screen.getByLabel(viewer)).toBeVisible();
      await screen.getByRole("button", "Close viewer").tap();
      await expect(screen.getByLabel(viewer)).toBeHidden();
    }
  }
});

test("Copy source copies a diagram's or chart's fenced source and reports Source copied", { tags: ["RICH-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const { diagram, chart } = await embeds(screen, hui);
  for (const [embed, source] of [[diagram, FLOWCHART], [chart, `${CHART}\n`]] as const) {
    await embed.getByRole("button", /^Open (mermaid diagram|chart) viewer$/u).tap();
    await screen.getByRole("button", "Copy source").tap();
    await expect(screen.getByText("Source copied")).toBeVisible();
    await expect.poll(() => hui.copied()).toBe(source);
    await screen.getByRole("button", "Close viewer").tap();
    await expect(screen.getByText("Source copied")).toBeHidden();
  }
});

test("A remote Markdown image is not fetched and links to the original, and an inline data: image opens in the viewer", { tags: ["RICH-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const remote = await hui.intercept("GET", /example\.com/u);
  let fetched = false;
  void remote.arrived().then(() => { fetched = true; });
  const transcript = await reply(screen, hui, say(`A remote image: ![demo](https://example.com/demo.png)\n\nAn inline one: ![swatch](data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")})`));
  await expect(transcript.getByText("External image not loaded: demo")).toBeVisible();
  await expect(transcript.getByText("Open image", { exact: true })).toHaveAttribute("href", "https://example.com/demo.png");
  await transcript.getByRole("button", "Open image: swatch").tap();
  await expect(screen.getByLabel("Image viewer: swatch")).toBeVisible();
  expect(fetched).toBe(false);
});

test("In the viewer + and - zoom, 0 fits, 1 shows actual size, arrows pan, Ctrl+C copies the image and Escape closes it, focusing the embed", { tags: ["RICH-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const { diagram } = await embeds(screen, hui);
  await diagram.focus();
  await diagram.press("Enter");
  const viewer = screen.getByLabel("Mermaid diagram viewer: mermaid-diagram");
  await expect(viewer).toBeVisible();
  const level = viewer.getByRole("button", /^Zoom \d+%\. Fit to screen$/u);
  await expect(level).toBeEnabled();
  const zoom = async () => Number(/\d+/u.exec((await level.getAttribute("aria-label"))!)![0]);
  const fit = await zoom();
  const key = async (name: string) => {
    await hui.keyboard.down(name);
    await hui.keyboard.up(name);
  };

  await key("+");
  await expect.poll(zoom).toBeGreaterThan(fit);
  await key("-");
  await key("-");
  await expect.poll(zoom).toBeLessThan(fit);
  await key("0");
  await expect.poll(zoom).toBe(fit);
  await key("+");
  await expect.poll(zoom).toBeGreaterThan(fit);
  expect(await zoom()).not.toBe(100);
  await key("1");
  await expect.poll(zoom).toBe(100);

  const label = viewer.getByText("Useful model");
  const start = (await label.boundingBox())!;
  const at = async () => (await label.boundingBox())!;
  await key("ArrowLeft");
  await expect.poll(async () => (await at()).x).toBeGreaterThan(start.x);
  await key("ArrowRight");
  await expect.poll(async () => (await at()).x).toBeCloseTo(start.x, 0);
  await key("ArrowUp");
  await expect.poll(async () => (await at()).y).toBeGreaterThan(start.y);
  await key("ArrowDown");
  await expect.poll(async () => (await at()).y).toBeCloseTo(start.y, 0);

  await hui.keyboard.down("Control");
  await key("c");
  await hui.keyboard.up("Control");
  await expect(viewer.getByText("Image copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toMatch(/^image\/png \d+x\d+$/u);

  await key("Escape");
  await expect(viewer).toBeHidden();
  await expect(diagram).toBeFocused();
});
