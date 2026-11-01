/** A bot's explicit memory: what the operator saves by hand, corrects, pins and deletes, kept across a reload (BOT-037, BOT-038, BOT-039). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function openMemory(screen: Screen, hui: Hui, bot: { id: string }) {
  await hui.open(`/bots/${bot.id}`);
  await screen.getByText("Facts, preferences & decisions").tap();
  await expect(screen.getByText(/^\d+ \/ 40 memories$/u)).toBeVisible();
}

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("Memory saves a fact with its kind, source and count, keeps it across a reload and never runs a model", { tags: ["BOT-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Memo");
  await openMemory(screen, hui, bot);
  await expect(screen.getByText("No explicit memories yet. Save only what you want this bot to keep.")).toBeVisible();
  await expect(screen.getByText("0 / 40 memories")).toBeVisible();

  const text = "Reports go out on Fridays 7f3a.";
  const requests = await hui.providerRequests();
  await screen.getByLabel("Kind").selectOption({ label: "Preference" });
  await screen.getByRole("textbox", "Memory").fill(text);
  await screen.getByLabel("Source (optional)").fill("our planning conversation");
  await screen.getByRole("button", "Save memory").tap();

  await expect(screen.getByText("1 / 40 memories")).toBeVisible();
  const listed = (await screen.getByRole("listitem").allTextContents()).join(" ");
  expect(listed).toContain("Preference");
  expect(listed).toContain(text);
  expect(listed).toContain("Manually saved · our planning conversation");
  expect(listed).toMatch(/Created \d/u);
  expect(await hui.stored(text)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^artifacts\//u)]));
  expect(await hui.providerRequests()).toBe(requests);

  await hui.reload();
  await openMemory(screen, hui, bot);
  await expect(screen.getByText(text)).toBeVisible();
  await expect(screen.getByText("1 / 40 memories")).toBeVisible();
});

test("Memory edits a saved memory keeping its source, cancels an edit, and pins it before the ordinary ones", { tags: ["BOT-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Pinner");
  await hui.api("POST", `/__hui/bots/${bot.id}/facts`, { kind: "fact", text: "The release train leaves on Thursday.", source: "a planning conversation" });
  await hui.api("POST", `/__hui/bots/${bot.id}/facts`, { kind: "decision", text: "We ship behind a flag." });
  await openMemory(screen, hui, bot);
  await expect(screen.getByText("2 / 40 memories")).toBeVisible();

  const edited = "The release train leaves on Wednesday.";
  await screen.getByRole("button", "Edit memory").nth(1).tap();
  await expect(screen.getByText("Original source is kept: a planning conversation")).toBeVisible();
  expect(await screen.getByRole("textbox", "Memory").inputValue()).toBe("The release train leaves on Thursday.");
  await screen.getByRole("textbox", "Memory").fill(edited);
  await screen.getByRole("button", "Save changes").tap();
  await expect(screen.getByText(edited)).toBeVisible();
  await expect(screen.getByText(/^Manually saved · a planning conversation/u)).toBeVisible();
  await expect(screen.getByText(/Updated .* · revision 2$/u)).toBeVisible();

  await screen.getByRole("button", "Edit memory").nth(1).tap();
  await screen.getByRole("textbox", "Memory").fill("Never saved.");
  await screen.getByRole("button", "Cancel edit").tap();
  await expect(screen.getByText(edited)).toBeVisible();
  await expect(screen.getByText("Never saved.")).toBeHidden();
  expect(await screen.getByRole("textbox", "Memory").inputValue()).toBe("");

  const card = screen.getByText(edited);
  await screen.getByRole("button", "Pin memory").nth(1).tap();
  await expect(screen.getByText("Pinned")).toBeVisible();
  await expect(screen.getByRole("button", "Unpin memory")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await card.boundingBox())!.y < (await screen.getByText("We ship behind a flag.").boundingBox())!.y).toBe(true);
  expect((await hui.api<{ facts: { text: string; pinned: boolean; source: string }[] }>("GET", `/__hui/bots/${bot.id}/facts`)).facts[0]).
    toEqual(expect.objectContaining({ text: edited, pinned: true, source: "a planning conversation" }));

  await screen.getByRole("button", "Unpin memory").tap();
  await expect(screen.getByText("Pinned")).toBeHidden();
  await expect.poll(async () => (await card.boundingBox())!.y > (await screen.getByText("We ship behind a flag.").boundingBox())!.y).toBe(true);
});

test("Delete memory asks, quotes the memory, keeps it on Cancel and removes it from later turns", { tags: ["BOT-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Forgetful");
  const text = "Prefer the short report ALPHA4411 with BETA5522.";
  await hui.api("POST", `/__hui/bots/${bot.id}/facts`, { kind: "preference", text });
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_CONTEXT_HOLDS ALPHA4411");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Earlier context: ALPHA4411 yes")).toBeVisible();
  await openMemory(screen, hui, bot);
  await expect(screen.getByText("1 / 40 memories")).toBeVisible();

  await screen.getByRole("button", "Delete memory").tap();
  await expect(screen.getByText("Delete this memory?")).toBeVisible();
  await expect.poll(() => screen.getByText(text).count()).toBe(2);
  await expect(screen.getByText("This removes the saved memory from future turns. It cannot be undone. Earlier conversation messages and summaries are not erased.")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(screen.getByText("Delete this memory?")).toBeHidden();
  await expect.poll(() => screen.getByText(text).count()).toBe(1);
  await expect(screen.getByText("1 / 40 memories")).toBeVisible();

  await screen.getByRole("button", "Delete memory").tap();
  await screen.getByRole("button", "Delete saved memory").tap();
  await expect(screen.getByText("0 / 40 memories")).toBeVisible();
  await expect(screen.getByText("No explicit memories yet. Save only what you want this bot to keep.")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ facts: unknown[] }>("GET", `/__hui/bots/${bot.id}/facts`)).facts).toEqual([]);

  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_CONTEXT_HOLDS BETA5522");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Earlier context: BETA5522 no")).toBeVisible();
});