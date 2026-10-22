/** Home, the sidebar's destinations, pages and sessions opened by their address, unknown and old addresses, Back and Forward, and leaving Settings (SHELL-001 to SHELL-007). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const soul = "# Who I am\nA bot that only answers by address.\n";

test("Home shows the new-session form with no session selected, the four destinations and only Collapse sidebar beside the tabs", { tags: ["SHELL-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Not selected" });
  await hui.open("/");
  await expect(screen.getByTestId("new-session-composer")).toBeVisible();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect(screen.getByLabel(/^Not selected, status idle/u)).toBeVisible();
  await expect(screen.getByTestId("session-title")).toBeHidden();
  await expect(screen.getByLabel("Primary navigation")).toHaveText("Contributions Kanban Sessions Settings");
  const header = screen.getByTestId("sidebar-header");
  await expect(header.getByRole("button")).toHaveAccessibleName("Collapse sidebar");
  await expect(header.getByRole("tab", "Agents")).toBeVisible();
  await expect(header.getByRole("tab", "Bots")).toBeVisible();
  await expect(header).toHaveText("Agents Bots");
  expect(await hui.url()).toMatch(/:\d+\/$/u);
});

test("the sidebar opens Contributions, Kanban and Sessions as the current page, Settings on the page last shown, and a reload keeps each", { tags: ["SHELL-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const heading = screen.getByTestId("page-title");
  const item = (name: string) => screen.getByTestId("nav-item").filter({ hasText: name });
  const settingsTitle = screen.getByTestId("settings-page-title");

  await hui.open("/");
  for (const [name, path] of [["Contributions", "/contributions"], ["Kanban", "/kanban"], ["Sessions", "/sessions"]] as const) {
    await item(name).tap();
    await expect(heading).toHaveText(name);
    await expect(item(name)).toHaveAttribute("aria-current", "page");
    expect(await hui.url()).toMatch(new RegExp(`${path}$`, "u"));
    await hui.reload();
    await expect(heading).toHaveText(name);
    await expect(item(name)).toHaveAttribute("aria-current", "page");
    expect(await hui.url()).toMatch(new RegExp(`${path}$`, "u"));
  }
  await expect(item("Contributions")).toHaveAttribute("aria-current", "false");

  await item("Settings").tap();
  await expect(settingsTitle).toHaveText("Appearance");
  expect(await hui.url()).toMatch(/\/settings\/appearance$/u);
  await screen.getByTestId("settings-page-link").filter({ hasText: "Diagnostics" }).tap();
  await expect(settingsTitle).toHaveText("Diagnostics");
  await screen.getByRole("button", "Exit Settings").tap();
  await expect(heading).toHaveText("Sessions");
  await item("Settings").tap();
  await expect(settingsTitle).toHaveText("Diagnostics");
  await hui.reload();
  await expect(settingsTitle).toHaveText("Diagnostics");
  expect(await hui.url()).toMatch(/\/settings\/diagnostics$/u);
});

test("pages outside the sidebar open by their address and survive a reload, old addresses are rewritten, and unknown ones land on Home", { tags: ["SHELL-003", "SHELL-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const heading = screen.getByTestId("page-title");
  for (const [path, name] of [["/activity", "Activity"], ["/logs", "Logs"], ["/about", "About"], ["/cron", "Automations"], ["/usage", "Usage"], ["/skills", "Skills"]] as const) {
    await hui.open(path);
    await expect(heading).toHaveText(name);
    await hui.reload();
    await expect(heading).toHaveText(name);
    expect(await hui.url()).toMatch(new RegExp(`${path}$`, "u"));
  }

  await hui.open("/worktrees");
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Worktrees");
  await expect.poll(() => hui.url()).toMatch(/\/settings\/worktrees$/u);
  await hui.open("/settings/sessions");
  await expect(heading).toHaveText("Sessions");
  await expect.poll(() => hui.url()).toMatch(/:\d+\/sessions$/u);

  for (const path of ["/agents", "/approvals", "/channels", "/sessions/one/two", "/settings/no-such-page"]) {
    await hui.open(path);
    await expect(screen.getByRole("button", "Start session")).toBeVisible();
    await expect.poll(() => hui.url()).toMatch(/:\d+\/$/u);
    await expect(heading).toBeHidden();
  }
  await hui.open("/kanban");
  await expect(heading).toHaveText("Kanban");
  await hui.open("/agents");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await hui.back();
  await expect.poll(() => hui.url()).toMatch(/\/kanban$/u);
  await expect(heading).toHaveText("Kanban");
});

test("a session's address opens its conversation, also after a reload, a bot's opens its chat on the Bots tab, and a deleted session's lands on Home", { tags: ["SHELL-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const heading = screen.getByTestId("session-title", { visible: true });
  const session = await hui.createSession({ title: "Opened by address" });
  await hui.prompt(session, "Hello by address");
  const gone = await hui.createSession({ title: "Deleted before opening" });
  await hui.api("DELETE", `/__hui/sessions/${gone.id}`);
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Address Bot", title: "Answers by address", soul });

  try {
    await hui.open(`/sessions/${session.id}`);
    await expect(heading).toHaveText("Opened by address");
    await expect(transcript.getByText("Hello by address")).toBeVisible();
    await expect(transcript.getByText("Fixture response.")).toBeVisible();
    await hui.reload();
    await expect(heading).toHaveText("Opened by address");
    await expect(transcript.getByText("Hello by address")).toBeVisible();
    expect(await hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));

    await hui.open(`/bots/${bot.id}`);
    await expect(screen.getByRole("tab", { name: "Bots", selected: true })).toBeVisible();
    await expect(transcript.getByText("Say hi to Address Bot")).toBeVisible();
    expect(await hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));

    await hui.open(`/sessions/${gone.id}`);
    await expect(screen.getByRole("button", "Start session")).toBeVisible();
    await expect.poll(() => hui.url()).toMatch(/:\d+\/$/u);
  } finally {
    await hui.api("DELETE", `/__hui/bots/${bot.id}?permanent=1`);
  }
});

test("Back and Forward return the address and the screen of each page, Settings page and session visited", { tags: ["SHELL-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const heading = screen.getByTestId("page-title");
  const settingsTitle = screen.getByTestId("settings-page-title");
  const sessionTitle = screen.getByTestId("session-title", { visible: true });
  const item = (name: string) => screen.getByTestId("nav-item").filter({ hasText: name });
  const session = await hui.createSession({ title: "Visited in history" });
  await hui.prompt(session, "Remember this visit");

  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await item("Kanban").tap();
  await expect(heading).toHaveText("Kanban");
  await screen.getByLabel(/^Visited in history, status idle/u).tap();
  await expect(sessionTitle).toHaveText("Visited in history");
  await expect(screen.getByTestId("transcript").getByText("Remember this visit")).toBeVisible();
  await item("Settings").tap();
  await expect(settingsTitle).toHaveText("Appearance");
  await screen.getByTestId("settings-page-link").filter({ hasText: "Models" }).tap();
  await expect(settingsTitle).toHaveText("Models");

  const steps: [RegExp, () => Promise<void>][] = [
    [/\/settings\/models$/u, () => expect(settingsTitle).toHaveText("Models")],
    [/\/settings\/appearance$/u, () => expect(settingsTitle).toHaveText("Appearance")],
    [new RegExp(`/sessions/${session.id}$`, "u"), async () => {
      await expect(sessionTitle).toHaveText("Visited in history");
      await expect(screen.getByTestId("transcript").getByText("Remember this visit")).toBeVisible();
      await expect(screen.getByLabel(/^Visited in history, status idle/u)).toHaveAttribute("aria-current", "true");
    }],
    [/\/kanban$/u, async () => {
      await expect(heading).toHaveText("Kanban");
      await expect(item("Kanban")).toHaveAttribute("aria-current", "page");
    }],
    [/:\d+\/$/u, () => expect(screen.getByRole("button", "Start session")).toBeVisible()],
  ];
  for (const [path, shown] of steps.slice(1)) {
    await hui.back();
    await expect.poll(() => hui.url()).toMatch(path);
    await shown();
  }
  for (const [path, shown] of steps.slice(0, -1).reverse()) {
    await hui.forward();
    await expect.poll(() => hui.url()).toMatch(path);
    await shown();
  }
});

test("Exit Settings returns to the page or session it was opened from, or Home after a direct load, and Back does not reopen Settings", { tags: ["SHELL-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const heading = screen.getByTestId("page-title");
  const settingsTitle = screen.getByTestId("settings-page-title");
  const exit = screen.getByRole("button", "Exit Settings");
  const settings = screen.getByTestId("nav-item").filter({ hasText: "Settings" });
  const session = await hui.createSession({ title: "Settings opened here" });

  await hui.open("/kanban");
  await expect(heading).toHaveText("Kanban");
  await hui.open("/activity");
  await expect(heading).toHaveText("Activity");
  await screen.getByLabel(/^Settings opened here, status idle/u).tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Settings opened here");
  await hui.back();
  await expect(heading).toHaveText("Activity");
  await settings.tap();
  await expect(settingsTitle).toHaveText("Appearance");
  await exit.tap();
  await expect(heading).toHaveText("Activity");
  await expect(screen.getByTestId("session-title", { visible: true })).toBeHidden();
  await expect.poll(() => hui.url()).toMatch(/\/activity$/u);
  await hui.back();
  await expect.poll(() => hui.url()).toMatch(/\/activity$/u);
  await hui.back();
  await expect.poll(() => hui.url()).toMatch(/\/kanban$/u);
  await expect(heading).toHaveText("Kanban");
  await expect(settingsTitle).toBeHidden();

  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Settings opened here");
  await settings.tap();
  await expect(settingsTitle).toHaveText("Appearance");
  await exit.tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Settings opened here");
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));

  await hui.open("/settings/models");
  await expect(settingsTitle).toHaveText("Models");
  await exit.tap();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect.poll(() => hui.url()).toMatch(/:\d+\/$/u);
  await hui.back();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Settings opened here");
  await expect(settingsTitle).toBeHidden();
});
