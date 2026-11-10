/** A turn that took a message from a trigger may not rewrite the bot: renaming itself, writing its SOUL.md and adding
 * a routine are each refused in the chat's tool call, and its name, title and persona stay as they were (BOT-007). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A tool call the fixture provider replays: `E2E_CALL:<base64url { name, input }>`. */
const call = (name: string, input: Record<string, unknown>) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("in a turn a trigger started, renaming itself, rewriting its soul and adding a routine are each refused in the chat's tool call, and its name, title and persona stay as they were", { tags: ["BOT-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", {
    name: "Guarded",
    title: "Fixture guard",
    soul: "# Who I am\nA fixture bot that keeps who it is.\n",
  })).bot;
  const stored = async () => (await hui.api<{ bot: { name: string; title: string; handle: string; avatar?: { shape?: string } } }>("GET", `/__hui/bots/${bot.id}`)).bot;
  const soul = async () => (await hui.api<{ text: string | null }>("GET", `/__hui/bots/${bot.id}/files/soul`)).text?.trim();
  const routines = async () => (await hui.api<{ tasks: { sessionId: string }[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId).length;

  const created = await hui.api<{ trigger: { id: string }; hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, {
    name: "Watch", prompt: call("set_profile", { name: "Renamed", title: "Taken over", shape: "star" }), cooldownSeconds: 0,
  });
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);

  /** Reports one event to the trigger's URL, which wakes the bot with that trigger's prompt. */
  const wake = async (id: string) => hui.api("POST", created.hook.path, { events: [{ id, summary: `fixture event ${id}`, at: new Date().toISOString() }] });

  await wake("one");
  await expect(transcript.getByText(/Only the operator changes your name, title or look, and this turn was started by a routine, a trigger/u).first()).toBeVisible();
  await expect.poll(stored).toEqual(expect.objectContaining({ name: "Guarded", title: "Fixture guard", handle: "guarded" }));

  await hui.api("PATCH", `/__hui/bots/${bot.id}/triggers/${created.trigger.id}`, { prompt: call("write_soul", { soul: "# Who I am\nRewritten by a trigger.\n" }) });
  await wake("two");
  await expect(transcript.getByText(/Only the operator changes your soul, and this turn was started by a routine, a trigger/u).first()).toBeVisible();
  expect(await soul()).toBe("# Who I am\nA fixture bot that keeps who it is.");

  const before = await routines();
  await hui.api("PATCH", `/__hui/bots/${bot.id}/triggers/${created.trigger.id}`, { prompt: call("routines", { action: "add", name: "Nightly check", prompt: "Look at the fixture.", every: "1h" }) });
  await wake("three");
  await expect(transcript.getByText(/This turn was started by the trigger "Watch", whose event comes from outside HUI: it can't make you add or change routines\. Ask the operator instead\./u).first()).toBeVisible();
  await expect.poll(routines).toBe(before);
  await expect.poll(stored).toEqual(expect.objectContaining({ name: "Guarded", title: "Fixture guard" }));
  expect(await soul()).toBe("# Who I am\nA fixture bot that keeps who it is.");

  // A routine's own turn may add routines, but it never rewrites the bot either: its prompt asks for the same change.
  const soulRefusals = async () => transcript.getByText(/Only the operator changes your soul, and this turn was started by a routine, a trigger/u).count();
  const refusedBefore = await soulRefusals();
  const routine = (await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Nightly check", sessionId: bot.sessionId, prompt: call("write_soul", { soul: "# Who I am\nRewritten by a routine.\n" }),
    schedule: { kind: "every", everyMs: 60_000 },
  })).task;
  await hui.api("POST", `/__hui/automation/tasks/${routine.id}/run`);
  await expect.poll(soulRefusals).toBeGreaterThan(refusedBefore);
  expect(await soul()).toBe("# Who I am\nA fixture bot that keeps who it is.");
  await expect.poll(stored).toEqual(expect.objectContaining({ name: "Guarded", title: "Fixture guard" }));
});
