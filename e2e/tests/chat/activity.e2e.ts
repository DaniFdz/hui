/** A turn's activity folds between the messages the agent writes, labelled from what it holds, and opens in order (CHAT-023, CHAT-024). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const inOrder = async (...items: Locator[]) => {
  const tops: number[] = [];
  for (const item of items) {
    await expect(item).toBeVisible();
    tops.push((await item.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
};

const call = (verb: "CALL" | "HOLD", calls: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

test("a message written mid-turn keeps its own row with its links, live and after a reload", { tags: ["CHAT-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Mid-turn message" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_MIDTURN_MESSAGE");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  for (const pass of ["live", "reloaded"]) {
    if (pass === "reloaded") await hui.reload();
    await expect(transcript.getByText("What to check")).toBeVisible();
    expect(await transcript.getByText("service dashboard").getAttribute("href")).toBe("https://example.com/dashboard/checkout");
    expect(await transcript.getByText("error logs").getAttribute("href")).toBe("https://example.com/logs?query=status%3Aerror");
    await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible();
    await transcript.getByText("Ran 1 command").tap();
    await expect(transcript.getByRole("button", "Read fixture.txt")).toBeVisible();
  }
});

test("each stretch of activity folds under a label from what it holds and opens in order", { tags: ["CHAT-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Folded activity" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  await message.fill("E2E_THINKING");
  await send.tap();
  await expect(transcript.getByText("Thought it through.")).toBeVisible();
  await transcript.getByText("Reasoning").tap();
  await expect(transcript.getByText("Weighing the fixture.")).toBeVisible();

  await message.fill(call("HOLD", [{ name: "fixture_echo", input: { text: "live" } }]));
  await send.tap();
  await hui.provider.held();
  await expect(transcript.getByText("fixture_echo…")).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();

  await message.fill("E2E_RICH");
  await send.tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await expect(idle).toBeVisible();
  await transcript.getByText("Ran 1 command").last().tap();
  await inOrder(transcript.getByText("Inspecting the fixture."), transcript.getByRole("button", "Read fixture.txt"));

  await message.fill(call("CALL", [
    { name: "read", input: { path: `${hui.workspace}/fixture.txt` } },
    { name: "bash", input: { command: "echo folded" } },
    { name: "edit", input: { path: `${hui.workspace}/missing.txt`, edits: [{ oldText: "before", newText: "after" }] } },
  ]));
  await send.tap();
  await expect(idle).toBeVisible();
  await transcript.getByText("Ran 3 commands, edited 1 file").tap();
  await inOrder(transcript.getByRole("button", "Read fixture.txt").last(), transcript.getByRole("button", "echo folded"), transcript.getByText("edit", { visible: true }));
  await expect(transcript.getByText("Weighing the fixture.")).toBeVisible();
});
