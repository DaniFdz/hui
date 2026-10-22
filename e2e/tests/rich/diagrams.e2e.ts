/** A reply's Mermaid diagrams and Vega-Lite charts: each shows its rendering status, then the drawing within the transcript, and a source that cannot be drawn shows why in its place (RICH-010, RICH-011). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const FLOWCHART = "flowchart LR\n  Idea[Idea] --> Model{Useful model}\n  Model -->|yes| Explain[Explain clearly]\n  Model -->|no| Prose[Use concise prose]\n";
const chart = (title: string) => JSON.stringify({ title, width: "container", height: 160, data: { values: [{ format: "Prose", score: 48 }, { format: "Chart", score: 91 }] }, mark: "bar", encoding: { x: { field: "format", type: "nominal" }, y: { field: "score", type: "quantitative" } } });

async function reply(screen: Screen, hui: Hui, markdown: string) {
  const session = await hui.createSession({ title: "Diagrams" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

const within = async (inner: Locator, outer: Locator) => {
  const [a, b] = [(await inner.boundingBox())!, (await outer.boundingBox())!];
  return a.x >= b.x && a.x + a.width <= b.x + b.width;
};

test("A mermaid fence shows Rendering diagram…, then the diagram within the transcript on a phone, drawn again after a reload", { tags: ["RICH-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.phoneScreen();
  const renderer = await hui.intercept("GET", /mermaid/u);
  const transcript = await reply(screen, hui, `Before the diagram.\n\n\`\`\`mermaid\n${FLOWCHART}\`\`\`\n\nAfter the diagram.`);
  await expect(transcript.getByText("Rendering diagram…")).toBeVisible();
  await renderer.deliver();
  const diagram = transcript.getByLabel("Mermaid diagram");
  await expect(diagram.getByText("Useful model")).toBeVisible();
  await expect(transcript.getByText("Rendering diagram…")).toBeHidden();
  expect(await within(diagram, transcript)).toBe(true);
  expect(await hui.overflowX()).toBe(0);

  await hui.reload();
  await expect(diagram.getByText("Use concise prose")).toBeVisible();
  await expect(transcript.getByText("After the diagram.")).toBeVisible();
});

test("Mermaid source that cannot parse shows Diagram could not be rendered with the reason, and the rest of the reply still renders", { tags: ["RICH-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = await reply(screen, hui, "Before the diagram.\n\n```mermaid\nflowchart LR\n  A[Open --> B\n```\n\nAfter the diagram.");
  await expect(transcript.getByLabel("Mermaid diagram").getByText(/^Diagram could not be rendered: \S/u)).toBeVisible();
  await expect(transcript.getByText("Before the diagram.")).toBeVisible();
  await expect(transcript.getByText("After the diagram.")).toBeVisible();
});

test("chart, vega-lite and vegalite fences show Rendering chart…, then charts within the transcript with no editor or actions menu", { tags: ["RICH-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const renderer = await hui.intercept("GET", /vega/u);
  const fences = ["chart", "vega-lite", "vegalite"];
  const transcript = await reply(screen, hui, fences.map((fence) => `\`\`\`${fence}\n${chart(`The ${fence} fence`)}\n\`\`\``).join("\n\n"));
  await expect(transcript.getByText("Rendering chart…")).toHaveCount(3);
  await renderer.deliver();
  const charts = transcript.getByLabel("Data chart");
  await expect(charts.getByRole("button", "Open chart viewer")).toHaveCount(3);
  for (const drawn of await charts.all()) {
    expect((await drawn.boundingBox())!.height).toBeGreaterThanOrEqual(160);
    expect(await within(drawn, transcript)).toBe(true);
  }
  await expect(transcript.getByText("Rendering chart…")).toBeHidden();
  await expect(transcript.getByText("Open in Vega Editor")).toBeHidden();
  await expect(transcript.getByText("View Source")).toBeHidden();
});

test("A chart that loads a url or an href, is too large or is invalid shows Chart could not be rendered with the reason instead", { tags: ["RICH-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const specs = [
    { data: { url: "https://example.com/scores.csv" }, mark: "bar" },
    { data: { values: [{ site: "a" }] }, mark: "bar", encoding: { href: { field: "site" } } },
    { data: { values: [{ padding: "x".repeat(100_000) }] }, mark: "bar" },
  ].map((spec) => JSON.stringify(spec));
  const transcript = await reply(screen, hui, [...specs, "{ not json"].map((spec) => `\`\`\`chart\n${spec}\n\`\`\``).join("\n\n"));
  const failures = transcript.getByLabel("Data chart");
  await expect(failures.getByText("Chart could not be rendered: Charts must use inline data and cannot load external URLs.")).toHaveCount(2);
  await expect(failures.getByText("Chart could not be rendered: Chart specification exceeds 100 KB.")).toBeVisible();
  await expect(failures.getByText(/^Chart could not be rendered: .*JSON/u)).toBeVisible();
  await expect(transcript.getByText("Rendering chart…")).toBeHidden();
});
