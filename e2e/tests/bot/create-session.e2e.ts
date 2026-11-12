/** An agent creates an ordinary top-level session in a group, not a child, and its brief arrives tagged from the bot that wrote it (BOT-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type ListedSession = { id: string; title: string; group: string; cwd: string; parentId?: string; status: string };

test("a Chief of Staff creates an ordinary session in a group, not a child", { tags: ["BOT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = (await hui.api<{ bots: Array<{ id: string; name: string; sessionId: string }> }>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  const source = { id: chief.sessionId };
  const repo = await hui.repository();
  try {
  const group = "Created by an agent";
  await hui.prompt(source, call("create_session", {
    prompt: "Report that an agent created you.",
    cwd: repo.path,
    title: "Created by an agent",
    group,
    worker: "local",
    worktree: true,
    branchName: "e2e/created-by-agent",
  }));

  const find = async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).filter((session) => session.title === "Created by an agent");
  await expect.poll(find, { timeout: 30_000 }).toHaveLength(1);
  const [created] = await find();
  expect(created?.group).toBe(group);
  expect(created?.parentId).toBeUndefined();
  expect(created?.id).not.toBe(source.id);
  expect(created?.cwd).not.toBe(repo.path);
  await hui.open("/");
  await hui.sessionList();
  await expect(screen.getByLabel(/^Created by an agent, status/)).toBeVisible();
  const tools = await hui.api<{ prompt: string }>("GET", `/__hui/sessions/${created!.id}/tools`);
  expect(tools.prompt).toContain("## PR lead");
  expect(tools.prompt).toContain("Run the PR end to end in this one session.");
  expect(tools.prompt).not.toContain("Waiting for the go to start");
  // The brief is the bot's message in the new chat, never the operator's own words.
  await hui.open(`/sessions/${created!.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Report that an agent created you.")).toBeVisible();
  hui.expectLinkTo(transcript, "Chief of Staff", `/bots/${chief.id}`);
  await expect(transcript.getByText(/\[from @/u)).toHaveCount(0);
  await expect(transcript.getByText("You", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");
  } finally {
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  }
});

test("a normal agent cannot create an ordinary session", { tags: ["BOT-073"], platforms: ["web"] }, async ({ hui }) => {
  const normal = await hui.createSession({ title: "Normal agent" });
  await hui.prompt(normal, call("create_session", { prompt: "This must not start.", cwd: hui.workspace, title: "Should not exist" }));
  await expect.poll(async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).find((session) => session.id === normal.id)?.status, { timeout: 30_000 }).toBe("idle");
  const sessions = (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions")).groups.flatMap((entry) => entry.sessions);
  expect(sessions.filter((session) => session.title === "Should not exist")).toHaveLength(0);
  await expect.poll(async () => (await hui.stored("Only a Chief of Staff bot can create an ordinary session")).length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("a chief's session follows its group's New session defaults", { tags: ["BOT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = (await hui.api<{ bots: Array<{ id: string; name: string; sessionId: string }> }>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  const repo = await hui.repository();
  const group = "Agent group defaults";
  await hui.createSession({ title: "Defaults anchor", group });
  await hui.api("PATCH", `/__hui/session-groups/${encodeURIComponent(group)}`, {
    cwd: repo.path, workspaceMode: "worktree", baseRef: "release/1.0",
  });
  try {
    // The chief's own directory and its "no worktree" cannot move the session off the group's defaults.
    await hui.prompt({ id: chief.sessionId }, call("create_session", {
      prompt: "Work in the group's checkout.",
      title: "Agent on group defaults",
      group,
      cwd: hui.workspace,
      worker: "local",
      worktree: false,
      branchName: "e2e-agent-group-defaults",
    }));

    const find = async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
      .groups.flatMap((entry) => entry.sessions).filter((session) => session.title === "Agent on group defaults");
    await expect.poll(find, { timeout: 30_000 }).toHaveLength(1);
    const [created] = await find();
    expect(created?.group).toBe(group);
    expect(created?.cwd).not.toBe(hui.workspace);
    expect(created?.cwd).not.toBe(repo.path);
    expect(repo.git("-C", created!.cwd, "branch", "--show-current")).toBe("feature/e2e-agent-group-defaults");
    expect(repo.git("-C", created!.cwd, "rev-parse", "HEAD")).toBe(repo.git("rev-parse", "release/1.0^{commit}"));

    await hui.open("/");
    await expect(screen.getByLabel(/^Agent on group defaults, status/u)).toBeVisible();
    await hui.open(`/sessions/${created!.id}`);
    await expect(screen.getByTestId("transcript").getByText("Work in the group's checkout.")).toBeVisible();
  } finally {
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  }
});
