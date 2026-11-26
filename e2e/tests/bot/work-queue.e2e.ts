/**
 * A bot's own work is visible where the bot is (BOT-080, BOT-081): its panel's overview draws Work first among the
 * things the bot does on its own, the sessions its chat started in Needs you, Working and Recent lanes with their
 * counts and the rest behind Show N more, and its roster row counts what it has in flight and lists its own chat and
 * those sessions on request. Both read the same registry the shell already holds; a plain click on a Work row opens
 * that session in the app, and coming back to the bot draws the queue's first rows again.
 */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview, roster } from "./bot-panel.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const question = { questions: [{ header: "Lane", question: "Which lane next?", options: [{ label: "Needs you", description: "Ask me." }, { label: "Working", description: "Keep going." }] }] };
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

type ListedSession = { id: string; title: string; status: string };

test("a bot's panel queues the sessions it started and its roster row counts and lists them", { tags: ["BOT-080", "BOT-081"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = await hui.createChief();
  const ask = join(hui.workspace, "ask-work.json");
  await writeFile(ask, JSON.stringify(question));
  const listed = async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions);
  const find = async (title: string) => (await listed()).find((session) => session.title === title);
  const chiefStatus = async () => (await listed()).find((session) => session.id === chief.sessionId)?.status;
  // A bot's chat answers one brief at a time: a prompt posted while the turn the last brief started is still running is
  // refused rather than queued, and the brief is only in HUI's hands once that turn has settled. The status the app's own
  // row reads is that turn, so each brief is delivered by waiting for the chat to be idle again, never by asking twice.
  const promptChief = async (text: string) => {
    await hui.prompt({ id: chief.sessionId }, text);
    await expect.poll(chiefStatus, { timeout: 30_000 }).toBe("idle");
  };
  const start = async (title: string, prompt: string) => {
    await promptChief(call("create_session", { prompt, title, cwd: hui.workspace, worker: "local", worktree: false }));
    await expect.poll(() => find(title), { timeout: 30_000 }).toBeTruthy();
  };
  try {
    // Nine sessions the chief started: one held running, one waiting for an answer, and seven that finished.
    await start("Work running", "E2E_REPLAY");
    await hui.provider.held();
    await expect.poll(async () => (await find("Work running"))?.status, { timeout: 30_000 }).toBe("running");
    await start("Work waiting", "E2E_ASK_USER:work");
    await expect.poll(async () => (await find("Work waiting"))?.status, { timeout: 30_000 }).toBe("waiting");
    for (let index = 0; index < 7; index += 1) await start(`Work finished ${index}`, "Report that you finished.");
    await expect.poll(async () => (await listed()).filter((session) => session.title.startsWith("Work finished") && session.status === "idle").length, { timeout: 60_000 }).toBe(7);
    const waiting = (await find("Work waiting"))!;

    await hui.open(`/bots/${chief.id}`);
    const panel = await panelOverview(screen, chief.name);
    // The header counts every lane it has, and the lanes read nearest first.
    await expect(panel.getByText("1 needs you · 1 working · 7 recent", { exact: true })).toBeVisible();
    const lane = (label: string) => panel.getByText(label, { exact: true });
    for (const label of ["Needs you", "Working", "Recent"]) await expect(lane(label)).toBeVisible();
    await expect.poll(async () => (await lane("Needs you").boundingBox())!.y).toBeLessThan((await lane("Working").boundingBox())!.y);
    await expect.poll(async () => (await lane("Working").boundingBox())!.y).toBeLessThan((await lane("Recent").boundingBox())!.y);
    const rows = (locator: typeof panel) => locator.getByRole("link", { name: /^Work /u });
    await expect(rows(panel)).toHaveCount(8);
    await expect(panel.getByRole("link", { name: /^Work waiting/u })).toHaveAttribute("href", `/sessions/${waiting.id}`);
    // Each row's dot takes the tone the sidebar's own status glyph gives it: a question or a live turn.
    await expect(panel.getByRole("link", { name: /^Work waiting/u })).toHaveAttribute("data-work-tone", "question");
    await expect(panel.getByRole("link", { name: /^Work running/u })).toHaveAttribute("data-work-tone", "busy");

    // Show more draws the ninth row in place, without leaving the bot.
    const before = await hui.url();
    await panel.getByRole("button", "Show 1 more").tap();
    await expect(panel.getByRole("button", "Show less")).toHaveAttribute("aria-expanded", "true");
    await expect(rows(panel)).toHaveCount(9);
    expect(await hui.url()).toBe(before);

    // A plain click opens the session in the app; returning to the bot's chat draws its first eight rows again.
    await panel.getByRole("link", { name: /^Work waiting/u }).tap();
    await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${escaped(waiting.id)}$`, "u"));
    await roster(screen, hui);
    await screen.getByRole("link", { name: new RegExp(`^${escaped(chief.name)},`, "u") }).tap();
    const returned = await panelOverview(screen, chief.name);
    await expect(rows(returned)).toHaveCount(8);
    await expect(returned.getByRole("button", "Show 1 more")).toBeVisible();
    await expect(returned.getByRole("button", "Show less")).toHaveCount(0);

    // A phone draws the panel as a sheet over the chat, so it closes before the roster's drawer opens underneath it.
    await hideBotPanel(screen);
    // The roster counts the two in flight on its row and never the seven that finished.
    await roster(screen, hui);
    const botRow = (name: string) => screen.getByTestId("bot-row").filter({ hasText: name });
    const badged = botRow(chief.name);
    await expect(badged.getByRole("link", { name: new RegExp(`^${escaped(chief.name)}, .*2 sessions in flight`, "u") })).toBeVisible();
    // The count is painted in the row's top line, not only said in its accessible name, and the time keeps its place.
    await expect(badged.getByTestId("bot-row-inflight")).toHaveText("2");
    await expect(badged.getByTestId("bot-row-time")).toBeVisible();
    const expander = screen.getByRole("button", `Expand sessions of ${chief.name}`);
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expect(screen.getByLabel(`Sessions ${chief.name} started`)).toHaveCount(0);
    await expander.tap();
    await expect(screen.getByRole("button", `Collapse sessions of ${chief.name}`)).toHaveAttribute("aria-expanded", "true");
    const children = screen.getByLabel(`Sessions ${chief.name} started`);
    const chat = children.getByRole("link", { name: new RegExp(`^Chat with ${escaped(chief.name)}`, "u") });
    await expect(chat).toHaveAttribute("href", `/bots/${chief.id}`);
    await expect(children.getByRole("link", { name: /^Work running/u })).toBeVisible();
    await expect(children.getByRole("link", { name: /^Work waiting/u })).toBeVisible();
    await expect(children.getByRole("link", { name: /^Work finished 0 /u })).toBeVisible();
    // Its own chat first, then every session it started, each once.
    await expect(rows(children)).toHaveCount(9);
    await expect.poll(async () => (await chat.boundingBox())!.y)
      .toBeLessThan((await children.getByRole("link", { name: /^Work running/u }).boundingBox())!.y);
    await screen.getByRole("button", `Collapse sessions of ${chief.name}`).tap();
    await expect(screen.getByLabel(`Sessions ${chief.name} started`)).toHaveCount(0);

    // A bot that started nothing carries no count and nothing to open.
    const idle = (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name: "Work idle", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
    const plain = botRow(idle.name);
    await expect(plain.getByRole("link", { name: new RegExp(`^${escaped(idle.name)}, (?!.*in flight)`, "u") })).toBeVisible();
    await expect(plain.getByTestId("bot-row-inflight")).toHaveCount(0);
    await expect(screen.getByRole("button", `Expand sessions of ${idle.name}`)).toHaveCount(0);
    // The badge never widens the row, and the time it shares its line with stays in place.
    const width = async (row: typeof badged) => Math.round((await row.boundingBox())?.width ?? 0);
    await expect.poll(() => width(badged)).toBeGreaterThan(0);
    expect(await width(badged)).toBe(await width(plain));

    // A bot that started nothing says so in its panel, with no lane at all.
    await plain.getByRole("link", { name: new RegExp(`^${escaped(idle.name)},`, "u") }).tap();
    const empty = await panelOverview(screen, idle.name);
    await expect(empty.getByText(`Nothing yet. Sessions ${idle.name} starts show here.`, { exact: true })).toBeVisible();
    await expect(rows(empty)).toHaveCount(0);
    await expect(empty.getByText("Needs you", { exact: true })).toHaveCount(0);
  } finally {
    await rm(ask, { force: true });
    await hui.provider.release().catch(() => undefined);
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  }
});
