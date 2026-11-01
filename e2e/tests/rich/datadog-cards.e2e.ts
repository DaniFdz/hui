/** Datadog chat cards: one that cannot be previewed keeps its link to Datadog and says why, and a card's graph opens
 * the media viewer with zoom, copy and save before focus returns to the graph (RICH-038, RICH-040). */
import { readFile } from "node:fs/promises";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;
const answer = (previews: unknown[]) => JSON.stringify({ previews });
const PREVIEWS = /\/__hui\/datadog\/previews/u;
const SHOT = new URL("../../fixtures/files/wide-shot.png", import.meta.url);

async function reply(screen: Screen, hui: Hui, markdown: string) {
  const session = await hui.createSession({ title: "Datadog cards" });
  await hui.prompt(session, say(markdown));
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

const dashboard = (id: string) => `https://app.datadoghq.com/dashboard/${id}`;

test("A card that cannot be previewed keeps its link to Datadog and says why", { tags: ["RICH-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reasons = [
    ["aaa-111-bbb", "no_org", "Add a Datadog org for app.datadoghq.com in Settings → Integrations to preview it."],
    ["ccc-222-ddd", "not_found", "Not found in your Datadog orgs for app.datadoghq.com."],
    ["eee-333-fff", "cli_missing", "The Datadog CLI (pup) is required for previews."],
  ] as const;
  const previews = await hui.intercept("GET", PREVIEWS);
  const transcript = await reply(screen, hui, reasons.map(([id]) => dashboard(id)).join(" "));
  await previews.answer(answer(reasons.map(([id, error]) => ({ url: dashboard(id), error }))));
  const cards = transcript.getByLabel("Datadog links").getByRole("listitem");
  await expect(cards).toHaveCount(3);
  for (const [index, [id, , why]] of reasons.entries()) {
    const card = cards.nth(index);
    await expect(card).toHaveAccessibleName(`Datadog: Dashboard ${id}`);
    await expect(card.getByText(why, { exact: true })).toBeVisible();
    await expect(card.getByText(`Dashboard ${id}`, { exact: true })).toHaveAttribute("href", dashboard(id));
  }

  const last = await hui.intercept("GET", PREVIEWS);
  const other = await reply(screen, hui, `See ${dashboard("ggg-444-hhh")} for the rest.`);
  await last.answer(answer([{ url: dashboard("ggg-444-hhh"), error: "unavailable" }]));
  const alone = other.getByLabel("Datadog links").getByRole("listitem");
  await expect(alone).toHaveCount(1);
  await expect(alone).toHaveAccessibleName("Datadog: Dashboard ggg-444-hhh");
  await expect(alone.getByText("Datadog preview unavailable.", { exact: true })).toBeVisible();
  await expect(alone.getByText("Dashboard ggg-444-hhh", { exact: true })).toHaveAttribute("href", dashboard("ggg-444-hhh"));
});

test("Pressing a card's graph opens the media viewer with zoom, copy and save, and closing it returns focus to the graph", { tags: ["RICH-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const url = dashboard("aaa-111-bbb");
  const graph = `data:image/png;base64,${(await readFile(SHOT)).toString("base64")}`;
  const previews = await hui.intercept("GET", PREVIEWS);
  const transcript = await reply(screen, hui, `The graph is in ${url}.`);
  await previews.answer(answer([{
    url,
    preview: { kind: "dashboard", url, title: "Signup funnel", org: "e2e-prod", from: 1_700_000_000_000, to: 1_700_003_600_000, image: graph },
  }]));
  const card = transcript.getByLabel("Datadog links").getByRole("listitem");
  await expect(card).toHaveAccessibleName("Datadog: Signup funnel");
  const open = card.getByRole("button", "Open graph: Signup funnel");
  await expect(open).toBeVisible();
  await open.tap();

  const viewer = screen.getByLabel("Image viewer: Signup funnel");
  await expect(viewer).toBeVisible();
  const level = viewer.getByRole("button", /^Zoom \d+%\. Fit to screen$/u);
  await expect(level).toBeEnabled();
  await expect(viewer.getByRole("button", "Copy image")).toBeEnabled();
  await expect(viewer.getByRole("button", "Save image")).toBeEnabled();
  await viewer.getByRole("button", "Copy image").tap();
  await expect(viewer.getByText("Image copied")).toBeVisible();

  await screen.getByRole("button", "Close viewer").tap();
  await expect(viewer).toBeHidden();
  await expect(open).toBeFocused();
});
