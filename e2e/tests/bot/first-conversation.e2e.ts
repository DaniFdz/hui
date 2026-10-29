/** A new bot's first conversation: telling it its name renames it everywhere without a reload, and it writes and rewrites its own SOUL.md, which its later turns follow (BOT-005, BOT-006). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const NAME_QUESTION = "Hi, I'm new here and I don't have a name yet. What would you like to call me?";
const EXPECTATIONS_QUESTION = "Hi, I'm new here. What would you like me to look after for you?";
const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const raw = (text: string) => Buffer.from(text).toString("base64url");

test("Answering its question with a name makes a new bot rename itself in the header, the panel, Settings and the roster, and a later ask changes its name, title and look the same way", { tags: ["BOT-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const header = screen.getByTestId("chat-header");
  await hui.api("POST", "/__hui/bots", { name: "Zeta", soul: "# Who I am\nA fixture bot.\n" });
  await screen.getByRole("tab", "Bots").tap();
  await screen.getByRole("button", "New bot").tap();
  await screen.getByText("New bot", { exact: true, visible: true }).tap();
  await expect(transcript.getByText("New Bot was created")).toBeVisible();
  await expect(transcript.getByText(NAME_QUESTION)).toBeVisible();
  const id = (await hui.url()).split("/").at(-1)!;
  await expect(header.getByText("New Bot", { exact: true })).toBeVisible();
  await expect(screen.getByLabel(/^New Bot,/u)).toBeVisible();

  await screen.getByLabel("Message").fill("E2E_SET_PROFILE Please go by Echo from now on.");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(/^set_profile answered: Saved: you are Echo \(@echo\), Fixture tester/u)).toBeVisible();
  const firstCall = transcript.getByRole("button", /^Used set profile/u);
  if (!(await firstCall.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await expect(firstCall).toBeVisible();

  await expect(header.getByText("Echo", { exact: true })).toBeVisible();
  await expect(header.getByText("Fixture tester · Idle")).toBeVisible();
  await expect(screen.getByLabel("Echo: bot panel")).toBeVisible();
  await expect(screen.getByLabel(/^Echo, Fixture tester,/u)).toBeVisible();
  await screen.getByRole("button", "Edit Echo").tap();
  await expect(screen.getByRole("textbox", "Name")).toHaveValue("Echo");
  await expect(screen.getByText("@echo")).toBeVisible();

  const renamed = `E2E_SET_PROFILE:${json({ name: "Echo Two", title: "Second role", shape: "star" })} Please go by Echo Two, and be a star.`;
  await screen.getByLabel("Message").fill(renamed);
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(/^set_profile answered: Saved: you are Echo Two \(@echo-two\), Second role/u)).toBeVisible();
  await expect(transcript.getByText("Used 1 tool")).toHaveCount(2);
  await expect(header.getByText("Echo Two", { exact: true })).toBeVisible();
  await expect(header.getByText("Second role · Idle")).toBeVisible();
  await expect(screen.getByLabel("Echo Two: bot panel")).toBeVisible();
  await expect(screen.getByLabel(/^Echo Two, Second role,/u)).toBeVisible();
  await expect(screen.getByRole("textbox", "Name")).toHaveValue("Echo Two");
  await expect(screen.getByText("@echo-two")).toBeVisible();
  await expect(screen.getByLabel(/^Look: Star/u)).toBeVisible();
  await expect.poll(async () => (await hui.api<{ bot: { avatar?: { shape?: string } } }>("GET", `/__hui/bots/${id}`)).bot.avatar?.shape).toBe("star");
});

test("A new bot asks what to look after, then writes its own SOUL.md and says so, its later turns follow it, and asked for a change it rewrites it and mentions the change", { tags: ["BOT-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Planner" })).bot;
  const soul = async () => (await hui.api<{ soul: string | null }>("GET", `/__hui/bots/${bot.id}/soul`)).soul;
  expect(await soul()).toBeNull();
  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText(EXPECTATIONS_QUESTION)).toBeVisible();
  await expect(transcript.getByText("Planner was created")).toBeVisible();

  await screen.getByLabel("Message").fill("E2E_WRITE_SOUL Look after my pull requests and write that down.");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("I wrote my SOUL.md. To change it, just tell me.")).toBeVisible();
  const soulCall = transcript.getByRole("button", /^Used write soul/u);
  if (!(await soulCall.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await expect(soulCall).toBeVisible();
  await expect.poll(soul).toBe("# Who I am\nE2E_SOUL_TEXT: a terse fixture bot.");

  await screen.getByLabel("Message").fill("E2E_CONTEXT_HOLDS E2E_SOUL_TEXT what do you look after?");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Earlier context: E2E_SOUL_TEXT yes")).toBeVisible();

  const second = `E2E_WRITE_SOUL:${raw("# Who I am\nE2E_SOUL_V2: I answer in one line.\n")} Answer in one line instead, and write that down.`;
  await screen.getByLabel("Message").fill(second);
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("I rewrote my SOUL.md: from now on I answer in one line.")).toBeVisible();
  await expect.poll(soul).toBe("# Who I am\nE2E_SOUL_V2: I answer in one line.");
  await expect(transcript.getByText("Used 1 tool")).toHaveCount(2);
});