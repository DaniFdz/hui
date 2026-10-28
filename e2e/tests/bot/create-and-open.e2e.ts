/** New bot makes a bot at once and opens its chat on its own first question, and a bot's chat shows its face, name, title and status, its panel and its menu, invites you when empty and marks the bot read (BOT-004, BOT-010). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const NAME_QUESTION = "Hi, I'm new here and I don't have a name yet. What would you like to call me?";

test("New bot creates a bot at once and opens its chat on its centered note and its first question, lists it first and shows a refusal in the roster", { tags: ["BOT-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const create = screen.getByRole("button", "New bot");
  const item = screen.getByText("New bot", { exact: true, visible: true });
  await hui.api("POST", "/__hui/bots", { name: "Zeta", soul: "# Who I am\nA fixture bot.\n" });
  await screen.getByRole("tab", "Bots").tap();
  await expect(screen.getByLabel(/^Zeta,/u)).toBeVisible();

  const hold = await hui.intercept("POST", /\/__hui\/bots$/u);
  await create.tap();
  await item.tap();
  await hold.arrived();
  await expect(create).toHaveAttribute("aria-busy", "true");
  await expect(screen.getByRole("textbox", "Name")).toHaveCount(0);
  await expect(screen.getByRole("button", "Create bot")).toHaveCount(0);
  await hold.deliver();
  await expect.poll(() => hui.url()).toMatch(/\/bots\/[0-9a-f-]+$/u);
  const created = (await hui.api<{ bots: { id: string; name: string }[] }>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "New Bot")!;
  expect(await hui.url()).toMatch(new RegExp(`/bots/${created.id}$`, "u"));
  const transcript = screen.getByTestId("transcript");
  const note = transcript.getByText("New Bot was created");
  await expect(note).toBeVisible();
  await expect.poll(async () => {
    const box = (await note.boundingBox())!;
    const chat = (await transcript.boundingBox())!;
    return { centered: Math.abs(box.x + box.width / 2 - (chat.x + chat.width / 2)) <= 2, narrower: box.width < chat.width - 100 };
  }).toEqual({ centered: true, narrower: true });
  await expect(transcript.getByText(NAME_QUESTION)).toBeVisible();
  await expect.poll(async () => (await note.boundingBox())!.y < (await transcript.getByText(NAME_QUESTION).boundingBox())!.y).toBe(true);
  await expect.poll(async () => (await hui.api<{ bots: { name: string }[] }>("GET", "/__hui/bots")).bots.length).toBe(2);
  const made = screen.getByLabel(/^New Bot,/u);
  await expect(made).toBeVisible();
  await expect.poll(async () => (await made.boundingBox())!.y < (await screen.getByLabel(/^Zeta,/u).boundingBox())!.y).toBe(true);

  const url = await hui.url();
  const refusal = await hui.intercept("POST", /\/__hui\/bots$/u);
  await create.tap();
  await item.tap();
  await refusal.reject(409, "HUI is not connected to devbox. Connect it in Settings → Workers, then create the bot again.");
  await expect(screen.getByText("HUI is not connected to devbox. Connect it in Settings → Workers, then create the bot again.")).toBeVisible();
  expect(await hui.url()).toBe(url);
});

test("opening a bot's chat shows its name, status, panel and menu, an empty chat invites you, and opening it marks the bot read", { tags: ["BOT-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const row = screen.getByLabel(/^Solo,/u);
  await screen.getByRole("tab", "Bots").tap();
  await expect(row).toBeVisible();
  await row.tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));
  await expect(screen.getByLabel("Solo: bot panel")).toBeVisible();
  await screen.getByRole("button", "Hide the bot panel").tap();
  await expect(screen.getByLabel("Solo: bot panel")).toBeHidden();
  await expect.poll(() => screen.getByText("Solo", { exact: true }).count()).toBe(2);
  await expect.poll(async () => (await hui.faces()).map((face) => face.size)).toEqual(["sm", "md", "lg"]);
  await expect.poll(async () => (await hui.faces()).filter((face) => face.shape !== "")).toHaveLength(3);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByText("Fixture helper · Idle")).toBeVisible();
  await expect(screen.getByText("Say hi to Solo")).toBeVisible();

  const header = screen.getByTestId("chat-header");
  await expect(header.getByText("Solo", { exact: true })).toBeVisible();
  await expect(header.getByText("Fixture helper · Idle")).toBeVisible();
  await expect(header.getByLabel("Session status: Idle")).toBeVisible();
  const menu = header.getByRole("button", "Actions for Solo");
  await expect(menu).toHaveCount(1);
  await menu.tap();
  for (const action of ["Edit bot…", "Archive…", "Delete…"]) await expect(screen.getByText(action, { exact: true, visible: true })).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");

  await screen.getByRole("button", "Show the bot panel").tap();
  await expect(screen.getByLabel("Solo: bot panel")).toBeVisible();

  await hui.open("/");
  await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: "E2E_REPLY:UmVhZHkgd2hlbiB5b3UgYXJlLg" });
  await expect(screen.getByLabel(/^Solo,.*unread$/u)).toBeVisible();
  await screen.getByLabel(/^Solo,.*unread$/u).tap();
  await expect(screen.getByTestId("transcript").getByText("Ready when you are.")).toBeVisible();
  await expect(screen.getByLabel(/unread$/u)).toBeHidden();
});