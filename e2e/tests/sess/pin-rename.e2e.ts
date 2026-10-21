/** Pinning keeps a session first in every sidebar sort and on the Sessions page until it is unpinned, and Rename… saves a new title from the session header (SESS-031, SESS-032). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a pinned session stays first in every sort, keeps its Pinned chip across a reload, and Unpin session reverses it", { tags: ["SESS-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const order = () => screen.getByLabel(/^(Zulu|Alpha|Mike) pin, status/u).allTextContents();
  const sortBy = async (choice: string) => {
    await screen.getByRole("button", "Filter & sort").tap();
    await screen.getByText(choice, { exact: true }).tap();
  };
  const zulu = await hui.createSession({ title: "Zulu pin" });
  await hui.createSession({ title: "Alpha pin" });
  await hui.createSession({ title: "Mike pin" });

  await hui.open("/");
  await expect.poll(order).toEqual(["Mike pin", "Alpha pin", "Zulu pin"]);
  const zuluRow = screen.getByTestId("session-row").filter({ hasText: "Zulu pin" });
  await hui.peek(zuluRow);
  await zuluRow.getByRole("button", "Pin session").tap();
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation, pinned")).toBeVisible();
  await expect.poll(order).toEqual(["Zulu pin", "Mike pin", "Alpha pin"]);
  for (const [choice, expected] of [["Created", ["Zulu pin", "Mike pin", "Alpha pin"]], ["Name", ["Zulu pin", "Alpha pin", "Mike pin"]], ["Stage", ["Zulu pin", "Mike pin", "Alpha pin"]], ["Last updated", ["Zulu pin", "Mike pin", "Alpha pin"]]] as const) {
    await sortBy(choice);
    await expect.poll(order).toEqual(expected);
  }

  await hui.open("/sessions");
  await expect(screen.getByText("Pinned", { exact: true })).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("Pinned", { exact: true })).toBeVisible();

  await hui.open(`/sessions/${zulu.id}`);
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation, pinned")).toBeVisible();
  await hui.sessionMenu("Zulu pin");
  await screen.getByText("Unpin session", { visible: true }).tap();
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation")).toBeVisible();
  await expect.poll(order).toEqual(["Mike pin", "Alpha pin", "Zulu pin"]);
  await hui.sessionMenu("Zulu pin");
  await screen.getByText("Pin session", { visible: true }).tap();
  await expect(screen.getByLabel("Zulu pin, status idle, tool durable, stage investigation, pinned")).toBeVisible();
});

test("Rename… opens the session's title as a Session name field that saves on Enter or leaving it and cancels on Escape or an empty name", { tags: ["SESS-032"], platforms: ["web"] }, async ({ screen, hui }) => {
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
  await rename("Rename me");
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));
  await name.fill("Renamed with Enter");
  await name.press("Enter");
  await expect(heading).toHaveText("Renamed with Enter");
  await expect(row("Renamed with Enter")).toBeVisible();

  await rename("Renamed with Enter");
  await name.fill("Renamed on leaving");
  await screen.getByLabel("Message", { visible: true }).tap();
  await expect(heading).toHaveText("Renamed on leaving");
  await expect(row("Renamed on leaving")).toBeVisible();

  await rename("Renamed on leaving");
  await name.fill("Not kept");
  await name.press("Escape");
  await expect(name).toBeHidden();
  await expect(heading).toHaveText("Renamed on leaving");
  await rename("Renamed on leaving");
  await name.fill("   ");
  await name.press("Enter");
  await expect(name).toBeHidden();
  await expect(heading).toHaveText("Renamed on leaving");

  await hui.reload();
  await expect(heading).toHaveText("Renamed on leaving");
  await expect(row("Renamed on leaving")).toBeVisible();
  await expect(row("Rename me")).toBeHidden();
});
