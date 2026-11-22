/** Settings → Tagging saves what it reads to decide when to tag it and who may: the overview's Tagging row shows the
 * choice, and its page's Back puts the focus back on that row (BOT-056). Typing @ in a composer suggests the bots the
 * operator may tag, with their titles, and inserts the handle without sending, a sent tag keeps a "Sent to <name>" row
 * in the session's chat, and the bot's chat shows that message as the session's (BOT-057). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Stored = { description?: string; tagging?: string };

const makeBot = async (hui: Hui, name: string, title: string) =>
  (await hui.api<{ bot: { id: string; name: string; handle: string } }>("POST", "/__hui/bots", { name, title, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("Settings → Tagging saves When to tag it on Enter and Who can tag it offers Anyone, Only when @mentioned and Nobody, which the overview's row shows once Back puts the focus on it", { tags: ["BOT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Router", title: "Fixture helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Router");

  const taggingRow = screen.getByRole("button", /^Tagging /u);
  await expect(taggingRow).toHaveText(/Anyone/u);
  await taggingRow.tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Tagging", { exact: true })).toBeFocused();

  const description = panel.getByRole("textbox", "When to tag it");
  await expect(description).toHaveValue("");
  await description.fill("Pull requests that touch the billing service.");
  await description.press("Enter");
  await expect.poll(async () => (await stored()).description).toBe("Pull requests that touch the billing service.");

  const picker = panel.getByLabel(/^Who can tag it: /u);
  await expect(picker).toHaveText(/Anyone/u);
  await picker.tap();
  const listbox = screen.getByRole("listbox", "Who can tag it");
  await expect(listbox.getByRole("option", { name: /^Anyone/u })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /^Only when @mentioned/u })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /^Nobody/u })).toBeVisible();
  await listbox.getByRole("option", { name: /^Only when @mentioned/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("mention");
  await expect(picker).toHaveText(/Only when @mentioned/u);

  await picker.tap();
  await screen.getByRole("listbox", "Who can tag it").getByRole("option", { name: /^Nobody/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("nobody");
  await expect(picker).toHaveText(/Nobody/u);
  await expect(panel.getByText("@router from any chat")).toBeHidden();
  await expect.poll(async () => (await stored()).description).toBe("Pull requests that touch the billing service.");

  await screen.getByRole("button", "Back to Router").tap();
  const back = screen.getByRole("button", /^Tagging /u);
  await expect(back).toHaveText(/Nobody/u);
  await expect(back).toBeFocused();
});

test("typing @ suggests the bots that may be tagged with their titles, never an archived one or one nobody may tag, Enter inserts the handle without sending, and a sent tag keeps Sent to <name> in the session's chat while the bot's chat shows the message as the session's", { tags: ["BOT-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Handing out work" });
  const helper = await makeBot(hui, "Helper", "Fixture helper");
  const retired = await makeBot(hui, "Retired", "Fixture retiree");
  const quiet = await makeBot(hui, "Quiet", "Fixture quiet");
  await hui.api("DELETE", `/__hui/bots/${retired.id}`);
  await hui.api("PATCH", `/__hui/bots/${quiet.id}`, { tagging: "nobody" });

  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("@");
  const menu = screen.getByRole("listbox", "Bots and local paths");
  await expect(menu.getByRole("option", { name: new RegExp(`@${helper.handle}\\b`, "u") })).toBeVisible();
  await expect(menu.getByRole("option", { name: new RegExp(`@${retired.handle}\\b`, "u") })).toHaveCount(0);
  await expect(menu.getByRole("option", { name: new RegExp(`@${quiet.handle}\\b`, "u") })).toHaveCount(0);

  // The bot's title comes with its handle, and Enter inserts the handle without sending anything.
  await message.fill("@hel");
  const option = menu.getByRole("option", { name: new RegExp(`@${helper.handle}\\b`, "u") });
  await expect(option).toBeVisible();
  await expect(option).toHaveText(/Helper · Fixture helper/u);
  await message.press("Enter");
  await expect(message).toHaveValue(`@${helper.handle} `);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(0);

  // Sent, the session hands the bot the work and keeps a row for it.
  const handoff = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "message_bot", input: { to: `@${helper.handle}`, message: "Please check the fixture build." } })).toString("base64url")}`;
  await message.fill(handoff);
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Sent to Helper", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Please check the fixture build.").first()).toBeVisible();

  // The bot's chat shows that message as the session's, under its title.
  await hui.open(`/bots/${helper.id}`);
  const botTranscript = screen.getByTestId("transcript");
  await expect(botTranscript.getByText("Please check the fixture build.").first()).toBeVisible();
  await expect(botTranscript.getByText("Handing out work")).toBeVisible();

  // A bot's own chat never suggests the bot itself.
  await screen.getByLabel("Message").fill("@");
  await expect(screen.getByRole("listbox", "Bots and local paths").getByRole("option", { name: new RegExp(`@${helper.handle}\\b`, "u") })).toHaveCount(0);
  await expect(screen.getByRole("listbox", "Bots and local paths").getByRole("option", { name: /@quiet\b/u })).toHaveCount(0);
});
