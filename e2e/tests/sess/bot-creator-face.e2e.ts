/**
 * A Chief of Staff starts an ordinary session with create_session. That session's sidebar row shows the chief's own face
 * as a link of its own, which opens the chief's chat while the row's title still opens the session; the open session's
 * header shows a "Started by <chief>" chip that leads to the chief's chat too (SESS-081).
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type ListedSession = { id: string; title: string; group: string; status: string };

test("a session a chief started shows the chief's face in its row and a Started by chip in its header", { tags: ["SESS-081"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = await hui.createChief();
  const title = "Started by the chief";
  const listed = async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions);
  const find = async () => (await listed()).filter((session) => session.title === title);
  try {
    await hui.prompt({ id: chief.sessionId }, call("create_session", {
      prompt: "Report that the chief started you.",
      title,
      cwd: hui.workspace,
      worker: "local",
      worktree: false,
    }));
    await expect.poll(find, { timeout: 30_000 }).toHaveLength(1);
    const [created] = await find();

    // The row's face is a link of its own, named for the chat it opens, beside the title's own link.
    await hui.open("/");
    await hui.sessionList();
    const row = screen.getByTestId("session-row").filter({ hasText: title });
    await hui.expectLinkTo(row, `Open ${chief.name}'s chat`, `/bots/${chief.id}`);
    const face = row.getByRole("link", { name: `Open ${chief.name}'s chat` });
    await expect(face).toBeVisible();
    const sessionLink = row.getByRole("link", { name: new RegExp(`^${title}, status`, "u") });
    await expect(sessionLink).toBeVisible();

    // The face opens the chief's chat, never the session.
    await face.tap();
    await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${chief.id}$`, "u"));
    await expect(screen.getByTestId("chat-header").getByRole("button", { name: `Actions for ${chief.name}` })).toBeVisible();

    // The row's title still opens the session, whose header names the chief that started it. Opening a bot's chat
    // leaves the sidebar on its Bots tab, so the Agents list comes back first.
    await hui.open("/");
    await hui.sessionList();
    await screen.getByRole("tab", "Agents").tap();
    await screen.getByTestId("session-row").filter({ hasText: title }).getByRole("link", { name: new RegExp(`^${title}, status`, "u") }).tap();
    await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${created!.id}$`, "u"));
    await hui.expectLinkTo(screen.getByTestId("chat-header"), `Started by ${chief.name}`, `/bots/${chief.id}`);
    const chip = screen.getByTestId("chat-pane-creator");
    await expect(chip).toBeVisible();
    expect(await hui.textOf(chip)).toBe(`Started by ${chief.name}`);
    await chip.tap();
    await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${chief.id}$`, "u"));
  } finally {
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  }
});
