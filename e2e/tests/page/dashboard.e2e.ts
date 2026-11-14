/** Labs → Dashboard adds the page, whose lanes queue the decisions the sessions in flight wait on and whose activity
 * monitor charts the machines' resource use (PAGE-044, PAGE-045). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Settings = { labs: { dashboard: boolean } };
type Listed = { groups: { sessions: { id: string; status: string; runFailed?: true; failure?: string }[] }[] };
type Opened = { snapshot: { transcript: { kind: string; role?: string; text?: string }[] } };

/** Labs → Dashboard, which PAGE-044 turns on through the switch. */
async function enableDashboard(hui: Hui) {
  const settings = await hui.api<Settings & Record<string, unknown>>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, labs: { ...settings.labs, dashboard: true } });
}

/** One of the queue's five lanes, by the key the view sets on it. */
const lane = (screen: Screen, key: string) => screen.getByTestId(new RegExp(`^dashboard-lane-${key}$`, "u"));

/** The queue's row for a session, found by the title or the question it leads with. */
const row = (screen: Screen, text: string) => screen.getByTestId("dashboard-row").filter({ hasText: text });

/** What the gateway reports for one session, for a state no screen shows yet. */
const listed = async (hui: Hui, id: string) =>
  (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions).find((session) => session.id === id);

/** What a session's transcript holds, from the snapshot the gateway opens it with, for text no dashboard row shows. */
const transcriptOf = async (hui: Hui, id: string) =>
  (await hui.api<Opened>("POST", `/__hui/sessions/${id}/open`)).snapshot.transcript;

test("Labs → Dashboard adds the Dashboard to the sidebar and keeps it across a reload", { tags: ["PAGE-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const navigation = screen.getByTestId("primary-navigation");
  const dashboard = screen.getByTestId("dashboard");
  const toggle = screen.getByRole("switch", "Dashboard");

  await hui.open("/dashboard");
  await expect(navigation.getByText("Usage")).toBeVisible();
  await expect(navigation.getByText("Dashboard")).toBeHidden();
  await expect(dashboard).toBeHidden();

  await hui.open("/labs");
  await expect(toggle).toBeChecked({ checked: false });
  await toggle.tap({ position: { x: 8, y: 8 } });
  await expect(navigation.getByText("Dashboard")).toBeVisible();
  await expect.poll(async () => (await hui.api<Settings>("GET", "/__hui/settings")).labs.dashboard).toBe(true);

  await hui.reload();
  await expect(toggle).toBeChecked();
  await navigation.getByText("Dashboard").tap();
  await expect(dashboard).toBeVisible();
  await expect(screen.getByText("The sessions in flight and the resource use of the machines that run them.")).toBeVisible();

  await hui.open("/labs");
  await toggle.tap({ position: { x: 8, y: 8 } });
  await expect(toggle).toBeChecked({ checked: false });
  await expect(navigation.getByText("Dashboard")).toBeHidden();
});

test("Dashboard queues a parked session and a running one, opens it, and charts the machines", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await enableDashboard(hui);
  const session = await hui.createSession({ title: "Dashboard running" });
  await hui.createSession({ title: "Dashboard parked" });
  await hui.open("/dashboard");

  // A session whose answer nobody waits on is parked, not a decision, and the page counts neither it nor the other
  // empty lanes as needing the operator.
  await expect(lane(screen, "parked").getByText("Dashboard parked")).toBeVisible();
  await expect(screen.getByTestId("dashboard-count")).toContainText("2 of 2 sessions");
  await expect(lane(screen, "answer")).toHaveCount(0);
  await expect(lane(screen, "fix")).toHaveCount(0);
  await expect(lane(screen, "unread")).toHaveCount(0);
  await expect(screen.getByText(/needs you/iu)).toHaveCount(0);
  await expect(screen.getByTestId("dashboard-stats")).toContainText("Parked");

  // A session at work moves to In flight, with its stage and what it is doing.
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await screen.getByTestId("primary-navigation").getByText("Dashboard").tap();
  await expect(lane(screen, "flight").getByText("Dashboard running")).toBeVisible();
  await expect(lane(screen, "flight")).toContainText("Running");
  await expect(lane(screen, "flight")).toContainText("Investigation");
  await expect(lane(screen, "parked").getByText("Dashboard running")).toHaveCount(0);
  await expect(screen.getByTestId("dashboard-count")).toContainText("2 of 2 sessions");

  // This gateway's six cards are beside the queue, not under it, and each reads its own metric.
  const machines = screen.getByTestId("dashboard-machine");
  const gateway = machines.filter({ hasText: "This gateway" });
  await expect(gateway.getByTestId(/^dashboard-metric-/u)).toHaveCount(6);
  await expect(gateway.getByTestId(/^dashboard-metric-cpu$/u)).toContainText(/%/u);
  await expect(gateway.getByTestId(/^dashboard-metric-cpu$/u)).toContainText(/Load [\d.]+ · [\d.]+ · [\d.]+ · \d+ cores/u);
  await expect(gateway.getByTestId(/^dashboard-metric-memory$/u)).toContainText(/ of /u);
  await expect(gateway.getByTestId(/^dashboard-metric-gateway$/u)).toContainText(/CPU of one core/u);
  const sessionsBox = await screen.getByTestId("dashboard-sessions").boundingBox();
  const activityBox = await screen.getByTestId("dashboard-activity").boundingBox();
  expect(sessionsBox !== null && activityBox !== null && activityBox.x >= sessionsBox.x + sessionsBox.width).toBe(true);

  // One chart over every machine the chips show, for the metric and window their switches name.
  await expect(screen.getByLabel("Machines").getByRole("button", "This gateway")).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByLabel("Metric").getByRole("button", "CPU")).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByLabel("Window").getByRole("button", "5m")).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByTestId("dashboard-chart")).toContainText("This gateway");
  // Hovering the plot names the time and every machine's reading at it and lets go when the pointer leaves; the
  // keyboard reads the newest one and Escape lets go.
  const plot = screen.getByTestId("dashboard-chart-plot");
  const tip = screen.getByTestId("dashboard-chart-tip");
  await plot.hover();
  await expect(tip).toContainText("This gateway");
  await expect(screen.getByTestId("dashboard-chart-crosshair")).toBeAttached();
  await screen.getByTestId("dashboard-filters").hover();
  await expect(tip).toBeHidden();
  await plot.focus();
  await plot.press("End");
  await expect(tip).toContainText(/\d+%/u);
  await expect(tip).toContainText("This gateway");
  await plot.press("Escape");
  await expect(tip).toBeHidden();
  await screen.getByLabel("Window").getByRole("button", "15m").tap();
  await expect(screen.getByLabel("Window").getByRole("button", "15m")).toHaveAttribute("aria-pressed", "true");
  await screen.getByLabel("Metric").getByRole("button", "Memory").tap();
  await expect(screen.getByLabel("Metric").getByRole("button", "Memory")).toHaveAttribute("aria-pressed", "true");

  // Every worker's own machine gets the same cards and a line, and one HUI holds no connection to says so.
  const offline = await hui.api<{ worker: { id: string } }>("POST", "/__hui/workers", { name: "Offline box", command: "ssh nowhere" });
  const remote = await hui.addWorker("E2E remote");
  try {
    await hui.open("/dashboard");
    const remoteCards = machines.filter({ hasText: "E2E remote" });
    await expect(remoteCards).toBeVisible();
    await expect(remoteCards.getByTestId(/^dashboard-metric-/u)).toHaveCount(6);
    await expect(remoteCards.getByTestId(/^dashboard-metric-gateway$/u)).toContainText("Host process");
    await expect(remoteCards).toContainText(/sampled \d/u);
    await expect(screen.getByTestId("dashboard-chart")).toContainText("E2E remote");
    await expect(machines.filter({ hasText: "Offline box" })).toContainText("HUI is not connected to this worker");
    await screen.getByLabel("Machines").getByRole("button", "E2E remote").tap();
    await expect(screen.getByLabel("Machines").getByRole("button", "E2E remote")).toHaveAttribute("aria-pressed", "false");
    await expect(machines.filter({ hasText: "E2E remote" })).toBeHidden();
  } finally {
    await hui.api("DELETE", `/__hui/workers/${remote.id}`);
    await hui.api("DELETE", `/__hui/workers/${offline.worker.id}`);
  }

  // A row opens its session from the dashboard, keeping the run it is in.
  await lane(screen, "flight").getByRole("link", "Dashboard running", { exact: true }).tap();
  await expect(screen.getByTestId("transcript").getByText("Replay prefix —", { exact: false })).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});

test("an Answer row answers a select or a confirm question in place, and opens the session for the rest", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await enableDashboard(hui);
  const choices = await hui.createSession({ title: "Choice asked" });
  const confirmation = await hui.createSession({ title: "Confirm asked" });
  const typed = await hui.createSession({ title: "Typed asked" });
  await writeFile(join(hui.workspace, "ask-queue.json"), JSON.stringify({ questions: [{
    header: "Scope",
    question: "Which scope should the queue answer?",
    options: [{ label: "One lane", description: "Only the lane that waits." }, { label: "Every lane", description: "The whole queue." }],
  }] }));

  await hui.prompt(choices, "/hui-e2e-question select");
  await hui.prompt(confirmation, "/hui-e2e-question confirm");
  await hui.prompt(typed, "E2E_ASK_USER:queue");

  // Every question waiting is one row of the Answer lane, the longest wait first, each led by what it asks.
  await hui.open("/dashboard");
  const answer = lane(screen, "answer");
  await expect(answer.getByTestId("dashboard-row")).toHaveText([
    /HUI E2E choice/u,
    /HUI E2E confirmation/u,
    /Which scope should the queue answer\?/u,
  ]);

  // A select question draws one button per option and answers over the gateway's own question route.
  const choice = row(screen, "HUI E2E choice");
  await expect(choice.getByRole("button", "First option")).toBeVisible();
  await expect(choice.getByRole("button", "Second option")).toBeVisible();
  await expect(choice.getByRole("link", "Open Choice asked", { exact: true })).toBeVisible();
  await choice.getByRole("button", "Second option").tap();
  await expect(row(screen, "HUI E2E choice")).toHaveCount(0);
  await expect(answer.getByTestId("dashboard-row")).toHaveCount(2);

  // A confirm asks Yes or No; a refused answer keeps its row and says why until it is dismissed.
  const confirm = row(screen, "HUI E2E confirmation");
  await expect(confirm.getByRole("button", "Yes")).toBeVisible();
  await expect(confirm.getByRole("button", "No")).toBeVisible();
  const refused = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/question$/u);
  await confirm.getByRole("button", "Yes").tap();
  await refused.arrived();
  await expect(confirm.getByRole("button", "Answering…").first()).toBeDisabled();
  await refused.reject(409, "That question was answered already.");
  await expect(screen.getByTestId("dashboard-action-error")).toContainText("That question was answered already.");
  await expect(confirm.getByRole("button", "Yes")).toBeEnabled();
  await screen.getByTestId("dashboard-action-error").getByRole("button", "Dismiss").tap();
  await expect(screen.getByTestId("dashboard-action-error")).toHaveCount(0);
  await confirm.getByRole("button", "Yes").tap();
  await expect(row(screen, "HUI E2E confirmation")).toHaveCount(0);
  await expect(answer.getByTestId("dashboard-row")).toHaveCount(1);

  // A questionnaire is answered in the chat, so its row only offers the way in.
  const questionnaire = row(screen, "Which scope should the queue answer?");
  await expect(questionnaire.getByRole("link", "Open to answer", { exact: true })).toBeVisible();
  await expect(questionnaire.getByRole("link", "Open Typed asked", { exact: true })).toBeVisible();
  await expect(questionnaire.getByRole("button")).toHaveCount(0);
});

test("a failed turn waits in Fix with the provider's own reason, and Resume continues it", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await enableDashboard(hui);
  // A failed turn is what the common stop looks like, on the default runtime: Pi Durable cannot continue without a
  // prompt, so the gateway resumes it with HUI's continuation prompt.
  const session = await hui.createSession({ title: "Dashboard failed" });
  await hui.prompt(session, "E2E_FAIL_ONCE");
  // A failed turn settles the session idle with its runtime still there: HUI marks it failed, it is not an error.
  await expect.poll(async () => (await listed(hui, session.id))?.runFailed, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await listed(hui, session.id))?.status).toBe("idle");
  await expect.poll(async () => String((await listed(hui, session.id))?.failure)).toContain("the API key expired");

  await hui.open("/dashboard");
  const failed = row(screen, "Dashboard failed");
  await expect(lane(screen, "fix")).toContainText("Dashboard failed");
  await expect(lane(screen, "fix")).toContainText("the API key expired");
  await expect(failed).toContainText("stopped");
  await expect(lane(screen, "unread").getByText("Dashboard failed")).toHaveCount(0);
  await expect(lane(screen, "parked").getByText("Dashboard failed")).toHaveCount(0);

  // Resume goes to the session's own route, and a refusal stays above the lanes until it is dismissed.
  const resume = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/resume$/u);
  await failed.getByRole("button", "Resume").tap();
  await resume.arrived();
  await expect(failed.getByRole("button", "Resuming…")).toBeDisabled();
  await resume.reject(409, "That session was already continuing.");
  await expect(screen.getByTestId("dashboard-action-error")).toContainText("That session was already continuing.");
  await screen.getByTestId("dashboard-action-error").getByRole("button", "Dismiss").tap();
  await expect(screen.getByTestId("dashboard-action-error")).toHaveCount(0);
  await expect(failed.getByRole("button", "Resume")).toBeEnabled();

  // The second Resume reaches the gateway: the failed turn continues and its answer finishes the run, so the row
  // leaves Fix for the unread answer nobody has read.
  await failed.getByRole("button", "Resume").tap();
  await expect.poll(async () => (await listed(hui, session.id))?.runFailed, { timeout: 30_000 }).toBeUndefined();
  await expect.poll(async () => (await listed(hui, session.id))?.status).toBe("idle");
  await expect(lane(screen, "fix").getByText("Dashboard failed")).toHaveCount(0);
  await expect(lane(screen, "unread")).toContainText("Dashboard failed", { timeout: 30_000 });

  // What the resume sent is the run's last user turn in the session's own transcript. Opening a session answers with
  // its snapshot and reads it, taking the row out of Unread, so this reads once that lane has been checked.
  const said = (await transcriptOf(hui, session.id)).filter((entry) => entry.kind === "message" && entry.role === "user");
  expect(said.at(-1)?.text).toBe("Continue from where you left off.");
});

test("a crashed runtime waits in Fix with no Resume, and its row opens the session to be retried", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await enableDashboard(hui);
  const session = await hui.createSession({ title: "Dashboard crashed", tool: "pi" });
  await hui.prompt(session, "Answer this, then go.");
  await hui.open("/dashboard");
  // With the run finished and nobody reading it, the row is an unread answer and its runtime is still there.
  await expect(lane(screen, "unread")).toContainText("Dashboard crashed");

  // The runtime process exiting is what makes a session an error, and there is nothing left to continue.
  await hui.exitRuntimes();
  await expect(lane(screen, "fix")).toContainText("Dashboard crashed");
  const crashed = row(screen, "Dashboard crashed");
  await expect(crashed).toContainText("The last run failed.");
  await expect(crashed.getByRole("button", "Resume")).toHaveCount(0);
  await expect(crashed.getByRole("link", "Open Dashboard crashed", { exact: true })).toBeVisible();
  await expect(lane(screen, "unread").getByText("Dashboard crashed")).toHaveCount(0);
  await expect.poll(async () => (await listed(hui, session.id))?.status, { timeout: 30_000 }).toBe("error");

  // Opening it is the retry: the session is back in front of the operator, ready for its next message.
  await crashed.getByRole("link", "Open Dashboard crashed", { exact: true }).tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Dashboard crashed");
  await expect(screen.getByLabel("Message")).toBeEnabled();
});

test("the filters narrow every lane together, the counts follow them, and a reload clears them", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await enableDashboard(hui);
  const running = await hui.createSession({ title: "Alpha queue", group: "Atlas" });
  const parked = await hui.createSession({ title: "Beta queue" });
  await hui.api("PATCH", `/__hui/sessions/${parked.id}`, { stage: "testing" });
  await hui.prompt(running, "E2E_REPLAY");
  await hui.provider.held();

  await hui.open("/dashboard");
  const filters = screen.getByTestId("dashboard-filters");
  const search = filters.getByLabel("Search sessions");
  const count = screen.getByTestId("dashboard-count");
  await expect(count).toContainText("2 of 2 sessions");
  await expect(lane(screen, "flight").getByText("Alpha queue")).toBeVisible();
  await expect(lane(screen, "parked").getByText("Beta queue")).toBeVisible();

  // The search narrows the lanes and the count follows it.
  await search.fill("alpha");
  await expect(count).toContainText("1 of 2 sessions");
  await expect(row(screen, "Alpha queue")).toBeVisible();
  await expect(row(screen, "Beta queue")).toHaveCount(0);
  await expect(filters.getByRole("button", "Clear", { exact: true })).toBeVisible();

  // The pickers combine with the search: Alpha is in Investigation, so Testing leaves nothing.
  await filters.getByRole("button", "Stage: Every stage").tap();
  await screen.getByTestId("picker-list").getByText("Testing (1)", { exact: true }).tap();
  await expect(count).toContainText("0 of 2 sessions");
  await expect(screen.getByTestId("dashboard-empty")).toContainText("No sessions match these filters.");
  await screen.getByTestId("dashboard-empty").getByRole("button", "Clear filters").tap();
  await expect(count).toContainText("2 of 2 sessions");
  await expect(search).toHaveValue("");

  // A group choice counts the sessions it would show and leaves the rest of the queue out.
  await filters.getByRole("button", "Group: All groups").tap();
  await screen.getByTestId("picker-list").getByText("ATLAS (1)", { exact: true }).tap();
  await expect(count).toContainText("1 of 2 sessions");
  await expect(row(screen, "Alpha queue")).toBeVisible();
  await expect(lane(screen, "parked")).toHaveCount(0);
  await filters.getByRole("button", "Clear", { exact: true }).tap();
  await expect(count).toContainText("2 of 2 sessions");

  // Status narrows to the sessions in flight, and every choice stays on the page it was made on.
  await filters.getByRole("button", "Status: All statuses").tap();
  await screen.getByTestId("picker-list").getByText("Running (1)", { exact: true }).tap();
  await expect(count).toContainText("1 of 2 sessions");
  await expect(lane(screen, "parked")).toHaveCount(0);
  // Leaving the page and coming back keeps the filters, because only a reload clears them.
  await screen.getByTestId("primary-navigation").getByText("Kanban").tap();
  await expect(screen.getByTestId("page-title")).toHaveText("Kanban");
  await screen.getByTestId("primary-navigation").getByText("Dashboard").tap();
  await expect(count).toContainText("1 of 2 sessions");

  // A reload clears them, and the worker choice counts this machine's sessions.
  await hui.reload();
  await expect(count).toContainText("2 of 2 sessions");
  await expect(filters.getByRole("button", "Status: All statuses")).toBeVisible();
  await filters.getByRole("button", "Worker: Every machine").tap();
  await screen.getByTestId("picker-list").getByText("This gateway (2)", { exact: true }).tap();
  await expect(count).toContainText("2 of 2 sessions");
  await hui.provider.release();
  await expect(lane(screen, "unread")).toContainText("Alpha queue");
});
