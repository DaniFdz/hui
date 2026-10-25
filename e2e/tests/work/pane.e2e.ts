/** The Work pane beside a conversation: its empty state and launchers, its tabs, hiding to the rail, closing the last view, maximizing, the narrow panel selector, what a reload restores and the banner a refused launch shows (WORK-001, 002, 003, 006, 007, 008, 010, 011, 014). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const launchers = ["New terminal", "Browser", "Files", "VS Code", "Diff"];
/** A + menu entry, found by the shortcut only that kind shows. */
const item = (screen: Pick<Locator, "getByText">, key: string) => screen.getByText(new RegExp(`(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)${key}`, "u"));

test("a conversation's Work pane starts at its rail and its empty state lists the launchers and their shortcuts", { tags: ["WORK-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Work pane empty state" });
  const pane = screen.getByLabel("Work pane");
  const show = screen.getByRole("button", "Show Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await expect(show).toBeVisible();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeHidden();
  await expect(pane.getByRole("tab")).toHaveCount(0);

  await show.tap();
  await expect(pane.getByText("Open a view beside this conversation.")).toBeVisible();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeVisible();
  await expect(show).toBeHidden();
  const listed = await pane.getByRole("listitem").allTextContents();
  expect(listed).toHaveLength(launchers.length);
  for (const [index, name] of launchers.entries()) {
    expect(listed[index]).toContain(name);
    expect(listed[index]).toMatch(/(?:⌥|Ctrl\+Alt|Alt\+)/u);
    const launcher = pane.getByRole("button", { name: new RegExp(`^${name}`, "u") });
    expect(await launcher.getAttribute("aria-keyshortcuts")).toBeTruthy();
  }
});

test("the plus menu lists every launcher and its shortcut and adds the chosen view, and a single-view kind shows the view already open", { tags: ["WORK-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Launch a Work view" });
  const pane = screen.getByLabel("Work pane");
  const menu = screen.getByRole("button", "Open Work view");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();

  await menu.tap();
  for (const key of ["T", "B", "F", "C", "D"]) await expect(item(screen, key).first()).toBeVisible();

  await item(screen, "F").first().tap();
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await menu.tap();
  await item(screen, "B").first().tap();
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(3);

  await menu.tap();
  await item(screen, "B").first().tap();
  await expect(pane.getByRole("tab")).toHaveCount(3);
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");

  await menu.tap();
  await item(screen, "C").first().tap();
  await expect(pane.getByRole("tab")).toHaveCount(4);
  await expect(pane.getByRole("tab", "VS Code")).toHaveAttribute("aria-selected", "true");
  await menu.tap();
  await item(screen, "C").first().tap();
  await expect(pane.getByRole("tab")).toHaveCount(4);
  await expect(pane.getByRole("tab", "VS Code")).toHaveAttribute("aria-selected", "true");
});

test("clicking a tab shows its view while the others stay mounted, and a close button removes one tab and shows a neighbour", { tags: ["WORK-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Work view tabs" });
  const pane = screen.getByLabel("Work pane");
  const menu = screen.getByRole("button", "Open Work view");
  const connected = screen.getByText("Shared · Connected");
  const terminal = screen.getByLabel("Shared terminal input");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(connected).toBeVisible();
  await expect(terminal).toBeVisible();

  await menu.tap();
  await item(screen, "F").first().tap();
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await expect(terminal).toBeHidden();
  await expect(connected).toHaveCount(1);
  await expect(connected).toBeHidden();

  await pane.getByRole("tab", "Terminal 1").tap();
  await expect(terminal).toBeVisible();
  await expect(connected).toBeVisible();

  await pane.getByRole("button", "Close Terminal 1").tap();
  await expect(pane.getByRole("tab")).toHaveCount(1);
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await expect(terminal).toHaveCount(0);
});

test("hiding the pane to its rail widens the chat, keeps the views mounted and a rail button reopens the pane on that view", { tags: ["WORK-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Hide the Work pane" });
  const pane = screen.getByLabel("Work pane");
  const transcript = screen.getByTestId("transcript");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();
  const beside = (await transcript.boundingBox())!.width;

  await screen.getByRole("button", "Hide Work pane").tap();
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeHidden();
  await expect.poll(async () => (await transcript.boundingBox())!.width).toBeGreaterThan(beside);
  await expect(pane.getByRole("tab")).toHaveCount(0);
  await expect(screen.getByText("Shared · Connected")).toHaveCount(1);
  await expect(screen.getByText("Shared · Connected")).toBeHidden();

  await screen.getByRole("button", "Show Terminal 1").tap();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeVisible();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByText("Shared · Connected")).toBeVisible();
  await expect.poll(async () => (await transcript.boundingBox())!.width).toBe(beside);
});

test("closing the last view collapses the pane, restores a maximized pane and returns to the chat on a phone, and the collapse survives a reload", { tags: ["WORK-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Close the last view" });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await screen.getByRole("button", "Maximize Work pane").tap();
  await expect(screen.getByRole("button", "Restore Work pane")).toBeVisible();

  await pane.getByRole("button", "Close Terminal 1").tap();
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeHidden();
  await expect(screen.getByRole("button", "Restore Work pane")).toBeHidden();

  await hui.reload();
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeHidden();
  await screen.getByRole("button", "Show Work pane").tap();
  await expect(screen.getByRole("button", "Maximize Work pane")).toBeVisible();
  await expect(pane.getByText("Open a view beside this conversation.")).toBeVisible();
  for (const name of launchers) await expect(pane.getByRole("button", { name: new RegExp(`^${name}`, "u") })).toBeVisible();
  await screen.getByRole("button", "Hide Work pane").tap();

  await hui.phoneScreen();
  const selector = screen.getByRole("button", { name: /^Active panel/u });
  await selector.tap();
  await screen.getByText("New terminal").first().tap();
  await expect(screen.getByRole("button", "Back to chat")).toBeVisible();
  await expect(pane.getByRole("tab")).toHaveCount(1);
  await expect(pane.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await pane.getByRole("button", { name: /^Close Terminal/u }).tap();
  await expect(screen.getByRole("button", "Back to chat")).toBeHidden();
  await expect(screen.getByLabel("Message")).toBeVisible();
  await expect(selector).toContainText("Chat");
  await hui.wideScreen();
});

test("maximizing fills the content area with the panel selector above it and keeps the chat and its draft, and restoring, choosing the chat or hiding brings it back", { tags: ["WORK-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Maximize the Work pane" });
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const selector = screen.getByRole("button", { name: /^Active panel/u });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await message.fill("A draft beside the work");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  const beside = (await transcript.boundingBox())!.width;
  await message.fill("Kept while maximized");

  await screen.getByRole("button", "Maximize Work pane").tap();
  await expect(screen.getByRole("button", "Restore Work pane")).toBeVisible();
  await expect(selector).toBeVisible();
  await expect(transcript).toBeHidden();
  await expect(message).toBeHidden();
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(beside);

  await screen.getByRole("button", "Restore Work pane").tap();
  await expect(transcript).toBeVisible();
  await expect(selector).toBeHidden();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(message).toHaveValue("Kept while maximized");

  await screen.getByRole("button", "Maximize Work pane").tap();
  await selector.tap();
  await screen.getByText("Chat").last().tap();
  await expect(transcript).toBeVisible();
  await expect(selector).toBeHidden();

  await screen.getByRole("button", "Maximize Work pane").tap();
  await expect(transcript).toBeHidden();
  await screen.getByRole("button", "Hide Work pane").tap();
  await expect(transcript).toBeVisible();
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();
});

test("on a narrow screen the Active panel selector lists the chat, the open views and the launchers, shows the Work destination and keeps the chat's draft on the way back", { tags: ["WORK-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "The narrow panel selector" });
  const pane = screen.getByLabel("Work pane");
  const message = screen.getByLabel("Message");
  const selector = screen.getByRole("button", { name: /^Active panel/u });
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");

  await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await message.fill("Draft kept in the chat");
  await expect(selector).toContainText("Chat");
  await selector.tap();
  await expect(screen.getByText("Chat").last()).toBeVisible();
  await expect(screen.getByText(/^Open$/u)).toHaveCount(5);
  for (const name of launchers) await expect(screen.getByText(name).first()).toBeVisible();
  await screen.getByText("New terminal").first().tap();

  await expect(pane.getByRole("tab")).toHaveCount(1);
  await expect(screen.getByRole("button", "Open Work view")).toBeVisible();
  await expect(screen.getByRole("button", "Back to chat")).toBeVisible();
  await screen.getByRole("button", "Back to chat").tap();
  await expect(message).toHaveValue("Draft kept in the chat");
  await expect(selector).toContainText("Chat");

  await selector.tap();
  await expect(screen.getByText(/^Work$/u)).toHaveCount(1);
  await expect(screen.getByText(/^Open$/u)).toHaveCount(5);
  await screen.getByText("Terminal 1").first().tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("button", "Back to chat").tap();

  await selector.tap();
  await screen.getByText("Browser").first().tap();
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("button", "Back to chat").tap();
  await selector.tap();
  // The Browser's view is open, so its launcher is gone and four launchers remain.
  await expect(screen.getByText(/^Work$/u)).toHaveCount(2);
  await expect(screen.getByText(/^Open$/u)).toHaveCount(4);
  await screen.getByText("VS Code").first().tap();
  await expect(pane.getByRole("tab", "VS Code")).toBeVisible();
  await screen.getByRole("button", "Back to chat").tap();
  await selector.tap();
  await expect(screen.getByText(/^Work$/u)).toHaveCount(3);
  await expect(screen.getByText(/^Open$/u)).toHaveCount(3);
  await screen.getByText("Browser").last().tap();
  await pane.getByRole("button", "Close Browser").tap();
  await expect(pane.getByRole("tab", "VS Code")).toBeVisible();
  await pane.getByRole("button", "Close VS Code").tap();
  await expect(pane.getByRole("tab")).toHaveCount(1);
  await pane.getByRole("button", { name: /^Close Terminal/u }).tap();
  await expect(screen.getByRole("button", "Back to chat")).toBeHidden();

  await hui.api("PUT", "/__hui/settings", { ...settings, ["browser"]: { ...(settings["browser"] as object), enabled: false } });
  await hui.reload();
  await selector.tap();
  await expect(screen.getByText(/The managed browser is off/u).first()).toBeVisible();
  await screen.getByText("Browser").first().tap();
  await expect(screen.getByRole("button", "Back to chat")).toBeHidden();
  await hui.wideScreen();
});

test("a reload restores the pane open, maximized and at its width, with its tabs, their order and the active view, and its terminal reconnects", { tags: ["WORK-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Restore the Work pane" });
  const pane = screen.getByLabel("Work pane");
  const menu = screen.getByRole("button", "Open Work view");
  const resizer = screen.getByLabel("Resize Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();
  await menu.tap();
  await item(screen, "F").first().tap();
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  const before = Number(await resizer.getAttribute("aria-valuenow"));
  await resizer.press("ArrowLeft");
  const width = String(await resizer.getAttribute("aria-valuenow"));
  expect(Number(width)).toBeGreaterThan(before);

  await hui.reload();
  await expect(screen.getByRole("button", "Hide Work pane")).toBeVisible();
  await expect(pane.getByRole("tab")).toHaveText([/^Terminal 1$/u, /^Files$/u]);
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await expect(resizer).toHaveAttribute("aria-valuenow", width);
  await pane.getByRole("tab", "Terminal 1").tap();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();

  await screen.getByRole("button", "Maximize Work pane").tap();
  await hui.reload();
  await expect(screen.getByRole("button", "Restore Work pane")).toBeVisible();
  await expect(pane.getByRole("tab")).toHaveText([/^Terminal 1$/u, /^Files$/u]);
  await pane.getByRole("button", "Close Files").tap();
  await expect(pane.getByRole("tab")).toHaveText([/^Terminal 1$/u]);
  await hui.reload();
  await expect(pane.getByRole("tab")).toHaveText([/^Terminal 1$/u]);
  await expect(screen.getByRole("button", "Restore Work pane")).toBeVisible();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();
});

test("a launch the gateway refuses shows its reason in a banner over the pane and Dismiss removes it", { tags: ["WORK-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "A refused launch" });
  const pane = screen.getByLabel("Work pane");
  const reason = "Terminal limit reached. End an unused terminal first.";
  const refused = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/terminals$/u);

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await refused.arrived();
  await refused.reject(409, reason);
  await expect(pane.getByText(reason)).toBeVisible();
  await expect(pane.getByRole("tab")).toHaveCount(0);
  await expect(pane.getByText("Open a view beside this conversation.")).toBeVisible();

  await screen.getByRole("button", "Dismiss").tap();
  await expect(pane.getByText(reason)).toBeHidden();
  await expect(pane.getByText("Open a view beside this conversation.")).toBeVisible();
});