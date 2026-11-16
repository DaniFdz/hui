/** An agent's background watchers: the Watchers section of the Run status popover, each row's opened details,
 * Stop, Restart, Dismiss, and what a gateway restart and a deleted conversation leave behind (AGENT-036 to AGENT-040,
 * AGENT-043, AGENT-044). */
import { readFile, stat } from "node:fs/promises";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openRunStatus, openSettledWatchers, openWatchers } from "./run-status.ts";

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

test("watchers live in the Run status popover, one row each, and keep only purpose and state on a phone", { tags: ["AGENT-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher rows" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = await openSettledWatchers(screen, "1 running", "Wait for #21532 review signals");
  await expect(watchers.getByText("1 running", { exact: true })).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for #21532 review signals");
  const [listBox, composerBox] = [(await watchers.boundingBox())!, (await screen.getByLabel("Message").boundingBox())!];
  expect(listBox.y).toBeLessThan(composerBox.y);

  const finished = watchers.getByText("Post /merge when approved");
  const running = watchers.getByText("Wait for #21532 review signals");
  await expect(finished).toBeVisible();
  await expect(running).toBeVisible();
  // The latest output is a wide row's extra; opening the row is where a phone reads it.
  await finished.tap();
  await expect(watchers.getByLabel("Watcher log").getByText("posted /merge")).toBeVisible();
  await finished.tap();
  await expect(watchers.getByText(/^Done · /u)).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();

  await hui.phoneScreen();
  await expect(watchers.getByText("posted /merge")).toBeHidden();
  await expect(finished).toBeVisible();
  await expect(running).toBeVisible();
  await expect(watchers.getByText(/^Done · /u)).toBeVisible();
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
});

test("an opened watcher shows its target, outcome, times, log, path and controls, and says why it failed or died", { tags: ["AGENT-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher details" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = await openSettledWatchers(screen, "Wait for #21532 review signals", "Done · ");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for #21532 review signals");
  await watchers.getByText("Post /merge when approved").tap();

  await expect(watchers.getByText("Then: post /merge")).toBeVisible();
  await hui.expectLinkTo(watchers, "github.com/ddoghq/web-ui/pull/21532", "https://github.com/ddoghq/web-ui/pull/21532");
  await expect(watchers.getByText(/^Started .+ · ended /u)).toBeVisible();
  const log = screen.getByLabel("Watcher log");
  await expect(log.getByText("posted /merge")).toBeVisible();
  const path = watchers.getByText(/^PID \d+ · .+\.log$/u);
  await expect(path).toBeVisible();
  await expect(watchers.getByRole("button", "Restart")).toBeVisible();
  await expect(watchers.getByRole("button", "Dismiss")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();

  await hui.prompt(session, start({ purpose: "Check the deploy", command: "exit 3" }));
  const failed = await openSettledWatchers(screen, "Check the deploy", "Failed · ");
  await expect.poll(async () => hui.textOf(failed), { timeout: 90_000 }).toContain("Failed · ");
  await failed.getByText("Check the deploy").tap();
  await expect(screen.getByText("Exited with status 3.")).toBeVisible();
  await failed.getByText("Check the deploy").tap();

  await hui.prompt(session, start({ purpose: "Wait for the reboot", command: "kill -9 $$" }));
  // The row reads its purpose and state together once the gateway's poll has recorded the death this watcher caused.
  const rebooted = await openSettledWatchers(screen, "Wait for the reboot Dead");
  await expect.poll(async () => hui.textOf(rebooted), { timeout: 90_000 }).toContain("Wait for the reboot Dead");
  await rebooted.getByText("Wait for the reboot").tap();
  await expect(screen.getByText("The process is gone and recorded no exit status, for example after a restart.")).toBeVisible();
  await rebooted.getByText("Wait for the reboot").tap();

  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));
  // The fifth watcher folds the rows; open the list before reading the new row.
  const fifth = await openSettledWatchers(screen, "Watcher details", "Wait for a review");
  const details = fifth.getByText(/^Watcher details/u);
  await expect(details).toBeVisible({ timeout: 90_000 });
  await details.tap();
  await expect.poll(async () => hui.textOf(fifth), { timeout: 90_000 }).toContain("Wait for a review");
  await fifth.getByText("Wait for a review").tap();
  await expect(screen.getByLabel("Watcher log").getByText("No output yet.")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
});

test("Stop settles a running watcher, updates the summary and offers Restart and Dismiss instead", { tags: ["AGENT-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Stopped watcher" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_WATCHER");

  const watchers = await openSettledWatchers(screen, "Wait for #21532 review signals");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for #21532 review signals");
  await watchers.getByText("Wait for #21532 review signals").tap();
  await screen.getByRole("button", "Stop").tap();

  // The quick watcher's exit reaches the gateway's ten-second watcher poll, and that same poll wakes the conversation
  // with HUI's own turn. That turn's start clears an explicit open, so on a phone, where the default is collapsed, the
  // panel closes under the operator — unless the turn's frames land in one render. Its answer in the transcript is the
  // one mark that the turn ran and is over, whichever of the two happened; then read the stopped row over the
  // operator's open again. The row keeps its open across the close.
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible({ timeout: 90_000 });
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const stopped = (await openRunStatus(screen)).getByLabel("Background watchers");
  await expect(stopped.getByText("2 watchers", { exact: true })).toBeVisible();
  await expect(stopped.getByText(/^Stopped · /u)).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await expect(stopped.getByRole("button", "Restart")).toBeVisible();
  await expect(stopped.getByRole("button", "Dismiss")).toBeVisible();

  await hui.reload();
  const reopened = await openWatchers(screen);
  await expect.poll(async () => hui.textOf(reopened), { timeout: 90_000 }).toContain("2 watchers");
  await expect(reopened.getByText(/^Stopped · /u)).toBeVisible();
});

test("Restart runs a settled watcher's command again under a new process and a fresh start time", { tags: ["AGENT-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Restarted watcher" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Check the deploy", command: "sleep 6; printf 'ran again\\n'" }));

  const watchers = await openSettledWatchers(screen, "Check the deploy", "Done · ");
  await expect(watchers.getByText("Check the deploy")).toBeVisible();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Done · ");
  await watchers.getByText("Check the deploy").tap();
  const path = watchers.getByText(/^PID \d+ · .+\.log$/u);
  await expect(path).toBeVisible();
  const before = pidOf(String(await path.textContent()));
  await expect(watchers.getByText(/^Started \d+[sm] ago/u)).toBeVisible();

  await watchers.getByRole("button", "Restart").tap();
  await expect(watchers.getByText(/^Started just now/u)).toBeVisible();
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

  const watchers = await openSettledWatchers(screen, "Wait for #21532 review signals");
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Wait for #21532 review signals");

  // The quick watcher's exit reaches its row on the gateway's ten-second watcher poll, and that same poll wakes the
  // conversation with HUI's own turn, which opens the panel while it streams and closes it when it ends. Wait for the row
  // to read Done, then for that turn to be over, and open Run status again over the settled row.
  await expect.poll(async () => hui.textOf(screen.getByLabel("Run status")), { timeout: 90_000 }).toContain("Done · ");
  const settled = await openSettledWatchers(screen, "Post /merge when approved");
  await settled.getByText("Post /merge when approved").tap();
  await expect(settled.getByLabel("Watcher log").getByText("posted /merge")).toBeVisible();
  await settled.getByRole("button", "Dismiss").tap();

  await expect(settled.getByText("Post /merge when approved")).toBeHidden();
  await expect(settled.getByText(/^1 (running|watcher)$/u, { visible: true })).toBeVisible();
  await expect(settled.getByText("Wait for #21532 review signals")).toBeVisible();
  await expect(settled.getByText(/^Running · /u)).toBeVisible();
  await expect(settled.getByLabel("Watcher log")).toBeHidden();
});

test("a watcher keeps its real state across a gateway restart and a dead one says why", { tags: ["AGENT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watchers after a restart" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));

  const watchers = await openSettledWatchers(screen, "Wait for a review");
  await expect(watchers.getByText("Wait for a review")).toBeVisible();
  await hui.prompt(session, start({ purpose: "Wait for the reboot", command: "kill -9 $$" }));
  // The second turn's run closed the panel it opened by itself; the rows are read through the operator's open again.
  const reboot = await openSettledWatchers(screen, "Wait for the reboot Dead");
  await expect(reboot.getByText("1 running", { exact: true })).toBeVisible();
  await expect.poll(async () => hui.textOf(reboot), { timeout: 90_000 }).toContain("Wait for the reboot Dead");
  await expect.poll(async () => hui.textOf(reboot), { timeout: 90_000 }).toContain("Wait for a review");

  await hui.restartGateway();
  await hui.reload();
  await hui.open(`/sessions/${session.id}`);

  const reopened = await openWatchers(screen);
  await expect(reopened.getByText("1 running", { exact: true })).toBeVisible();
  await expect.poll(async () => hui.textOf(reopened), { timeout: 90_000 }).toContain("Wait for a review");
  await expect(reopened.getByText("Dead", { exact: true })).toBeVisible();
  await expect(reopened.getByText(/^Running · /u)).toBeVisible();
  await reopened.getByText("Wait for the reboot").tap();
  await expect(screen.getByText("The process is gone and recorded no exit status, for example after a restart.")).toBeVisible();
});

test("deleting a conversation stops its running watcher and forgets its log", { tags: ["AGENT-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watchers deleted with the chat" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, start({ purpose: "Wait for a review", command: "sleep 600" }));

  const watchers = await openSettledWatchers(screen, "Wait for a review");
  await expect(watchers.getByText("Wait for a review")).toBeVisible();
  await watchers.getByText("Wait for a review").tap();
  const path = String(await watchers.getByText(/^PID \d+ · .+\.log$/u).textContent());
  const pid = pidOf(path);
  expect(alive(pid)).toBe(true);

  // The sidebar is the drawer on a phone, so the row whose menu this opens is only there once the drawer is open.
  await hui.sessionList();
  await hui.sessionMenu("Watchers deleted with the chat");
  await screen.getByText("Delete…", { visible: true }).tap();
  await screen.getByRole("button", "Remove from HUI").tap();

  await expect.poll(() => alive(pid), { timeout: 90_000 }).toBe(false);
  await expect.poll(async () => (await stat(path.replace(/^PID \d+ · /u, "")).catch(() => undefined))?.isFile(), { timeout: 90_000 }).toBeUndefined();
});