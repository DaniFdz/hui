/** An agent's background watchers: the rows above the composer, their opened details, Stop, Restart, Dismiss, and what a gateway restart and a deleted conversation leave behind (AGENT-036 to AGENT-040, AGENT-043, AGENT-044). */
import { readFile, stat } from "node:fs/promises";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const start = (input: { purpose: string; command: string }) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "watcher", input: { action: "start", ...input } })).toString("base64url")}`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pidOf = (path: string) => Number(/^PID (\d+) · /u.exec(path)?.[1]);

test("watchers sit above the composer as one row each and collapse into a summary that keeps only purpose and state on a phone", { tags: ["AGENT-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher rows" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = screen.getByLabel("Background watchers");
  await expect(watchers.getByText("2 watchers")).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for #21532 review signals");
  const [listBox, composerBox] = [(await watchers.boundingBox())!, (await screen.getByLabel("Message").boundingBox())!];
  expect(listBox.y).toBeLessThan(composerBox.y);

  await watchers.getByText("2 watchers").tap();
  const finished = watchers.getByText("Post /merge when approved");
  const running = watchers.getByText("Wait for #21532 review signals");
  await expect(finished).toBeVisible();
  await expect(running).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("posted /merge");
  await expect(watchers.getByText(/^Done · /u)).toBeVisible();
  await expect(watchers.getByText("watching #21532")).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();

  await hui.phoneScreen();
  await expect(watchers.getByText("posted /merge")).toBeHidden();
  await expect(watchers.getByText("watching #21532")).toBeHidden();
  await expect(finished).toBeVisible();
  await expect(running).toBeVisible();
  await expect(watchers.getByText(/^Done · /u)).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
  await hui.wideScreen();
});

test("an opened watcher shows its target, outcome, times, log, path and controls, and says why it failed or died", { tags: ["AGENT-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher details" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = screen.getByLabel("Background watchers");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for #21532 review signals");
  await watchers.getByText("2 watchers").tap();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("posted /merge");
  await watchers.getByText("Post /merge when approved").tap();

  await expect(screen.getByText("Then: post /merge")).toBeVisible();
  await hui.expectLinkTo(watchers, "github.com/ddoghq/web-ui/pull/21532", "https://github.com/ddoghq/web-ui/pull/21532");
  await expect(screen.getByText(/^Started .+ · ended /u)).toBeVisible();
  const log = screen.getByLabel("Watcher log");
  await expect(log.getByText("posted /merge")).toBeVisible();
  const path = screen.getByText(/^PID \d+ · .+\.log$/u);
  await expect(path).toBeVisible();
  await expect(screen.getByRole("button", "Restart")).toBeVisible();
  await expect(screen.getByRole("button", "Dismiss")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();

  await hui.prompt(session, start({ purpose: "Check the deploy", command: "exit 3" }));
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Failed · ");
  await watchers.getByText("Check the deploy").tap();
  await expect(screen.getByText("Exited with status 3.")).toBeVisible();
  await watchers.getByText("Check the deploy").tap();

  await hui.prompt(session, start({ purpose: "Wait for the reboot", command: "kill -9 $$" }));
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for the reboot Dead");
  await watchers.getByText("Wait for the reboot").tap();
  await expect(screen.getByText("The process is gone and recorded no exit status, for example after a restart.")).toBeVisible();
  await watchers.getByText("Wait for the reboot").tap();

  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for a review");
  await watchers.getByText("Wait for a review").tap();
  await expect(screen.getByLabel("Watcher log").getByText("No output yet.")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
});

test("Stop settles a running watcher, updates the summary and offers Restart and Dismiss instead", { tags: ["AGENT-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Stopped watcher" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = screen.getByLabel("Background watchers");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for #21532 review signals");
  await watchers.getByText("2 watchers").tap();
  await watchers.getByText("Wait for #21532 review signals").tap();
  await screen.getByRole("button", "Stop").tap();

  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("None running");
  await expect(watchers.getByText(/^Stopped · /u)).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await expect(screen.getByRole("button", "Restart")).toBeVisible();
  await expect(screen.getByRole("button", "Dismiss")).toBeVisible();

  await hui.reload();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("None running");
  await screen.getByText("2 watchers").tap();
  await expect(watchers.getByText(/^Stopped · /u)).toBeVisible();
});

test("Restart runs a settled watcher's command again under a new process and a fresh start time", { tags: ["AGENT-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Restarted watcher" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Check the deploy", command: "sleep 6; printf 'ran again\\n'" }));

  const watchers = screen.getByLabel("Background watchers");
  await expect(watchers.getByText("Check the deploy")).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Done · ");
  await watchers.getByText("Check the deploy").tap();
  const path = screen.getByText(/^PID \d+ · .+\.log$/u);
  await expect(path).toBeVisible();
  const before = pidOf(String(await path.textContent()));
  await expect(screen.getByText(/^Started \d+[sm] ago/u)).toBeVisible();

  await screen.getByRole("button", "Restart").tap();
  await expect(screen.getByText(/^Started just now/u)).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Running · ");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Done · ");

  const restarted = String(await path.textContent());
  await expect.poll(async () => pidOf(restarted), { timeout: 90_000 }).not.toBe(before);
  await expect.poll(async () => (await readFile(restarted.replace(/^PID \d+ · /u, ""), "utf8")).split("ran again").length - 1, { timeout: 90_000 }).toBe(2);
});

test("Dismiss removes a settled watcher and its log, folding the list back into one row", { tags: ["AGENT-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Dismissed watcher" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = screen.getByLabel("Background watchers");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for #21532 review signals");
  await watchers.getByText("2 watchers").tap();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("posted /merge");
  await watchers.getByText("Post /merge when approved").tap();
  await expect(screen.getByLabel("Watcher log").getByText("posted /merge")).toBeVisible();
  await screen.getByRole("button", "Dismiss").tap();

  await expect(watchers.getByText("Post /merge when approved")).toBeHidden();
  await expect(screen.getByText("2 watchers")).toBeHidden();
  await expect(watchers.getByText("Wait for #21532 review signals")).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
  await expect(screen.getByLabel("Watcher log")).toBeHidden();
});

test("a watcher keeps its real state across a gateway restart and a dead one says why", { tags: ["AGENT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watchers after a restart" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));

  const watchers = screen.getByLabel("Background watchers");
  await expect(watchers.getByText("Wait for a review")).toBeVisible();
  await hui.prompt(session, start({ purpose: "Wait for the reboot", command: "kill -9 $$" }));
  await expect(screen.getByText("2 watchers")).toBeVisible();
  await screen.getByText("2 watchers").tap();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for the reboot Dead");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for a review");

  await hui.restartGateway();
  await hui.reload();
  await hui.open(`/sessions/${session.id}`);

  await expect(screen.getByText("2 watchers")).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("1 running · Wait for a review");
  await screen.getByText("2 watchers").tap();
  await expect(watchers.getByText("Dead", { exact: true })).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
  await watchers.getByText("Wait for the reboot").tap();
  await expect(screen.getByText("The process is gone and recorded no exit status, for example after a restart.")).toBeVisible();
});

test("deleting a conversation stops its running watcher and forgets its log", { tags: ["AGENT-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watchers deleted with the chat" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));

  const watchers = screen.getByLabel("Background watchers");
  await expect(watchers.getByText("Wait for a review")).toBeVisible();
  await watchers.getByText("Wait for a review").tap();
  const path = String(await screen.getByText(/^PID \d+ · .+\.log$/u).textContent());
  const pid = pidOf(path);
  expect(alive(pid)).toBe(true);

  await hui.sessionMenu("Watchers deleted with the chat");
  await screen.getByText("Delete…", { visible: true }).tap();
  await screen.getByRole("button", "Remove from HUI").tap();

  await expect.poll(() => alive(pid), { timeout: 90_000 }).toBe(false);
  await expect.poll(async () => (await stat(path.replace(/^PID \d+ · /u, "")).catch(() => undefined))?.isFile(), { timeout: 90_000 }).toBeUndefined();
});