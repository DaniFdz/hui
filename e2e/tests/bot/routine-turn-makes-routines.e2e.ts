/** A routine's own turn may add a routine: only the operator's turns, its routines' turns and HUI's kickoff may make
 * more work, while every turn that came from a trigger, another bot or a session is refused (BOT-007). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A tool call the fixture provider replays: `E2E_CALL:<base64url { name, input }>`. */
const call = (name: string, input: Record<string, unknown>) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a routine's own turn adds the routine it asks for, and its chat shows the tool's answer", { tags: ["BOT-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", {
    name: "Planner",
    title: "Fixture planner",
    soul: "# Who I am\nA fixture bot that schedules its own work.\n",
  })).bot;
  const routines = async () => (await hui.api<{ tasks: { name: string; sessionId: string }[] }>("GET", "/__hui/automation"))
    .tasks.filter((task) => task.sessionId === bot.sessionId).map((task) => task.name);
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);

  // One of its routines runs with a prompt that asks for a second one. Its turn started with that routine's message,
  // which is one of the inputs that may make more work.
  const routine = (await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Daily sweep",
    sessionId: bot.sessionId,
    prompt: call("routines", { action: "add", name: "Weekly review", prompt: "Review the fixture.", every: "1h" }),
    schedule: { kind: "every", everyMs: 60_000 },
  })).task;
  await hui.api("POST", `/__hui/automation/tasks/${routine.id}/run`);

  // The routine exists and the bot said so in its tool call, with no refusal anywhere in the chat.
  await expect.poll(routines).toEqual(["Daily sweep", "Weekly review"]);
  await expect(transcript.getByText(/^tool answered: /u).first()).toBeVisible();
  await expect(transcript.getByText(/Added the routine "Weekly review"/u).first()).toBeVisible();
  await expect(transcript.getByText(/can't make you add or change routines/u)).toHaveCount(0);
});
