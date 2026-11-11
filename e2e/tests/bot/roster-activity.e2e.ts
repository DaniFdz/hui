/**
 * The roster says what each bot is doing: a bot with nothing running and nothing unread sleeps, one whose finished turn
 * nobody read reads done and marks the Bots tab while Agents shows, one at work reads working with no badge, one waiting
 * for an answer reads waiting for your answer, one whose worker is gone reads unreachable, and the bot whose chat is open
 * stays awake with no badge, even when a list read arrives after its turn ended (BOT-009).
 *
 * What no fixture reaches is the error mark: a bot's status only becomes `error` when its own runtime fails, and nothing
 * in the suite can fail one on purpose, so that clause is left to the unit tests that render it
 * (`src/lib/bots/roster.test.ts`).
 */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

type Bot = { id: string; sessionId: string; status: string; unread?: boolean };

const makeBot = async (hui: Hui, body: Record<string, unknown>): Promise<Bot> =>
  (await hui.api<{ bot: Bot }>("POST", "/__hui/bots", { soul: "# Who I am\nA terse fixture bot.\n", ...body })).bot;

/** The gateway's own reading of a bot, which the roster renders. */
const read = async (hui: Hui, bot: Bot): Promise<Bot> => (await hui.api<{ bot: Bot }>("GET", `/__hui/bots/${bot.id}`)).bot;

/** A bot's first turn runs by itself once it exists; this waits for it to settle, so what a test reads is the roster's
 * state and not the turn that made the bot. */
const settled = async (hui: Hui, bot: Bot): Promise<void> => {
  await expect.poll(async () => (await read(hui, bot)).status, { timeout: 60_000, message: `bot ${bot.sessionId} never settled after its first turn` }).toBe("idle");
};

test("the roster reads sleeping, done with the Bots tab marked, working, waiting for your answer and unreachable, and the bot whose chat is open stays awake", { tags: ["BOT-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  // Sleeping: its first turn has settled and someone read it.
  const dozer = await makeBot(hui, { name: "Dozer" });
  await hui.open(`/bots/${dozer.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await settled(hui, dozer);
  await expect.poll(async () => (await read(hui, dozer)).unread).toBe(false);

  // At work: its turn is held at the model, so the row says so and carries no badge.
  const busy = await makeBot(hui, { name: "Busy" });
  await settled(hui, busy);
  await hui.open(`/bots/${busy.id}`);
  await screen.getByLabel("Message").fill("E2E_REPLAY hold this turn open");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();

  // A bot waiting for an answer: it asked for the shell the operator turned off.
  const asker = await makeBot(hui, { name: "Asker", disabledTools: ["bash"] });
  await settled(hui, asker);
  await hui.open(`/bots/${asker.id}`);
  await screen.getByLabel("Message").fill("E2E_REQUEST_ACCESS run the fixture suite");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("question-card").getByRole("radiogroup", "Allow access to bash (powerful)?")).toBeVisible();

  // A bot whose worker is gone: its row says it is unreachable, and the roster still answers.
  const worker = await hui.addWorker("Far box");
  const far = await makeBot(hui, { name: "Far", worker: worker.id });
  await settled(hui, far);
  await hui.open("/settings/workers");
  await screen.getByTestId("settings-page").getByRole("button", "Disconnect").tap();
  await expect(screen.getByTestId("settings-page").getByText("Disconnected", { exact: true })).toBeVisible();

  // The roster, with the bot at work still held at the model.
  await hui.open("/");
  await roster(screen, hui);
  await expect(screen.getByLabel("Dozer, sleeping")).toBeVisible();
  await expect(screen.getByLabel(/^Busy, working/u)).toBeVisible();
  await expect(screen.getByLabel("Asker, waiting for your answer")).toBeVisible();
  await expect(screen.getByLabel("Far, on Far box, unreachable")).toBeVisible();

  // Released, the turn nobody read is done, and it marks the Bots tab while Agents shows — which a bot whose chat is
  // open never does. The mark is the tab's own label: "Bots , unread", with the screen reader text beside it.
  await hui.provider.release();
  await expect.poll(async () => (await read(hui, busy)).unread).toBe(true);
  await hui.open("/");
  await hui.sessionList();
  await screen.getByRole("tab", "Agents").tap();
  await expect(screen.getByRole("tab", "Agents")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByRole("tab", /^Bots\s*, unread$/u)).toBeVisible();
  await roster(screen, hui);
  await expect(screen.getByLabel("Busy, done, unread")).toBeVisible();
  await expect(screen.getByRole("tab", /^Bots$/u)).toBeVisible();

  // The bot whose chat is open stays awake: its next turn ends while the chat reads it, and a list read that arrives
  // afterwards still finds it up and with no badge.
  await screen.getByLabel("Busy, done, unread").tap();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_REPLY:V3JpdHRlbiB3aGlsZSB0aGUgY2hhdCB3YXMgb3Blbi4");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Written while the chat was open.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.reload();
  await roster(screen, hui);
  await expect(screen.getByLabel("Busy, idle")).toBeVisible();
  await expect(screen.getByLabel(/^Busy, done/u)).toHaveCount(0);
  await expect(screen.getByRole("tab", /^Bots$/u)).toBeVisible();
});
