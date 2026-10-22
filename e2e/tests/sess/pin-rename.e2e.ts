/** Pinning, from the row's button or the session menu, keeps a session first in every sidebar sort and on the Sessions page until it is unpinned, and Rename… saves a new title from the session header (SESS-031, SESS-032). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the row's Pin session button pins a session and its Unpin session button unpins it", { tags: ["SESS-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const zuluRow = screen.getByTestId("session-row").filter({ hasText: "Zulu pin" });
  await hui.createSession({ title: "Zulu pin" });

  await hui.open("/");
  await hui.peek(zuluRow);
  await zuluRow.getByRole("button", "Pin session").tap();
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation, pinned")).toBeVisible();
  await zuluRow.getByRole("button", "Unpin session").tap();
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation")).toBeVisible();
});

test("the session menu's Pin session keeps a row first in every sort with a Pinned chip on the Sessions page across a reload, and Unpin session puts it back", { tags: ["SESS-031"] }, async ({ screen, hui }) => {
  const title = /^(Zulu|Alpha|Mike) menu/u;
  const order = async () => (await screen.getByLabel(new RegExp(`${title.source}, status`, "u")).allTextContents()).map((text) => title.exec(text)?.[0]);
  const sortBy = async (choice: string) => {
    await screen.getByRole("button", "Filter & sort").tap();
    await screen.getByText(choice, { exact: true, visible: true }).tap();
  };
  await hui.createSession({ title: "Zulu menu" });
  await hui.createSession({ title: "Alpha menu" });
  await hui.createSession({ title: "Mike menu" });

  await hui.open("/");
  await sortBy("Name");
  await expect.poll(order).toEqual(["Alpha menu", "Mike menu", "Zulu menu"]);
  await hui.sessionMenu("Zulu menu");
  await screen.getByText("Pin session", { visible: true }).tap();
  await expect(screen.getByLabel("Zulu menu, status idle, tool durable, stage investigation, pinned")).toBeVisible();
  await expect.poll(order).toEqual(["Zulu menu", "Alpha menu", "Mike menu"]);
  await sortBy("Created");
  await expect.poll(order).toEqual(["Zulu menu", "Mike menu", "Alpha menu"]);
  for (const choice of ["Stage", "Last updated"]) {
    await sortBy(choice);
    await expect.poll(async () => (await order())[0]).toBe("Zulu menu");
  }
  await hui.open("/sessions");
  await expect(screen.getByText("Pinned", { exact: true, visible: true })).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("Pinned", { exact: true, visible: true })).toBeVisible();
  await hui.open("/");
  await expect(screen.getByLabel("Zulu menu, status idle, tool durable, stage investigation, pinned")).toBeVisible();
  await sortBy("Created");
  await hui.sessionMenu("Zulu menu");
  await screen.getByText("Unpin session", { visible: true }).tap();
  await expect(screen.getByLabel("Zulu menu, status idle, tool durable, stage investigation")).toBeVisible();
  await expect.poll(order).toEqual(["Mike menu", "Alpha menu", "Zulu menu"]);
});

test("Rename… opens the session's title as a Session name field that saves on leaving it, cancels an empty name and keeps the title across a reload", { tags: ["SESS-032"] }, async ({ screen, hui }) => {
  const name = screen.getByLabel("Session name");
  const heading = screen.getByTestId("session-title", { visible: true });
  const row = (title: string) => screen.getByLabel(`${title}, status idle, tool durable, stage investigation`);
  const rename = async (title: string) => {
    await hui.sessionMenu(title);
    await screen.getByText("Rename…", { visible: true }).tap();
    await expect(name).toHaveValue(title);
  };
  const session = await hui.createSession({ title: "Rename me" });
  const other = await hui.createSession({ title: "Somewhere else" });

  await hui.open(`/sessions/${other.id}`);
  await expect(heading).toHaveText("Somewhere else");
  await hui.sessionList();
  await rename("Rename me");
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));
  await name.fill("Renamed on leaving");
  await screen.getByLabel("Message", { visible: true }).tap();
  await expect(heading).toHaveText("Renamed on leaving");
  await hui.sessionList();
  await expect(row("Renamed on leaving")).toBeVisible();

  await hui.open(`/sessions/${session.id}`);
  await rename("Renamed on leaving");
  await name.fill("   ");
  await screen.getByLabel("Message", { visible: true }).tap();
  await expect(name).toBeHidden();
  await expect(heading).toHaveText("Renamed on leaving");

  await hui.reload();
  await expect(heading).toHaveText("Renamed on leaving");
  await hui.sessionList();
  await expect(row("Renamed on leaving")).toBeVisible();
  await expect(row("Rename me")).toBeHidden();
});

test("the Session name field saves on Enter and cancels on Escape or an empty name", { tags: ["SESS-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByLabel("Session name");
  const heading = screen.getByTestId("session-title", { visible: true });
  const row = (title: string) => screen.getByLabel(`${title}, status idle, tool durable, stage investigation`);
  const rename = async (title: string) => {
    await hui.sessionMenu(title);
    await screen.getByText("Rename…", { visible: true }).tap();
    await expect(name).toHaveValue(title);
  };
  const session = await hui.createSession({ title: "Rename me" });

  await hui.open(`/sessions/${session.id}`);
  await rename("Rename me");
  await name.fill("Renamed with Enter");
  await name.press("Enter");
  await expect(heading).toHaveText("Renamed with Enter");
  await expect(row("Renamed with Enter")).toBeVisible();

  await rename("Renamed with Enter");
  await name.fill("Not kept");
  await name.press("Escape");
  await expect(name).toBeHidden();
  await expect(heading).toHaveText("Renamed with Enter");
  await rename("Renamed with Enter");
  await name.fill("   ");
  await name.press("Enter");
  await expect(name).toBeHidden();
  await expect(heading).toHaveText("Renamed with Enter");
});
