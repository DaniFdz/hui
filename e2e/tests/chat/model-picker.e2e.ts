/** The session's model and thinking pickers: search, switch, memory, refusals, the missing catalog and the model's own effort levels (CHAT-053, CHAT-054). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const MODELS = /\/__hui\/sessions\/[^/]+\/models$/u;
const MODEL = /\/__hui\/sessions\/[^/]+\/model$/u;
const FIXTURE = /^HUI SDK Fixturehui-e2e$/u;
const OPUS = /^Opus fixturehui-e2e$/u;

test("the model picker searches every word, switches without losing the transcript, remembers, and refuses while busy or without a catalog", { tags: ["CHAT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Model picker" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("Which model are you?");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const search = screen.getByLabel("Search models");
  const fixture = screen.getByText(FIXTURE);
  const opus = screen.getByText(OPUS);
  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await expect(search).toBeVisible();
  await search.fill("opus claude");
  await expect(opus).toBeVisible();
  await expect(fixture).toBeHidden();
  await search.fill("sdk opus");
  await expect(opus).toBeHidden();
  await expect(fixture).toBeHidden();
  await search.fill("hui-e2e");
  await expect(opus).toBeVisible();
  await expect(fixture).toBeVisible();
  expect(await hui.disabled(fixture)).toBe(false);

  await search.fill("");
  await opus.tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await hui.reload();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();

  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  const trigger = screen.getByLabel("Model: Opus fixture");
  await trigger.tap();
  expect(await hui.disabled(fixture)).toBe(true);
  expect(await hui.disabled(opus)).toBe(true);
  await trigger.tap();
  await expect(search).toBeHidden();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const refused = await hui.intercept("POST", MODEL);
  await trigger.tap();
  await expect(search).toBeVisible();
  await fixture.tap();
  await refused.arrived();
  await refused.reject(503, "That model is not available.");
  await expect(screen.getByText("That model is not available.")).toBeVisible();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await screen.getByRole("button", "Dismiss notification").tap();

  const empty = await hui.intercept("GET", MODELS);
  await hui.reload();
  await empty.arrived();
  await empty.answer(JSON.stringify({ models: [] }));
  await expect(screen.getByLabel("Model: Opus fixture. No model catalog available")).toBeVisible();
});

test("the thinking picker offers the current model's levels, applies live, persists across a reload and fits the next model", { tags: ["CHAT-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Thinking picker" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("How hard are you thinking?");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const slider = screen.getByLabel("Thinking effort");
  await screen.getByLabel("Thinking: high").tap();
  await expect(slider).toBeVisible();
  await expect(screen.getByText("Faster", { exact: true })).toBeVisible();
  await expect(screen.getByText("Smarter", { exact: true })).toBeVisible();
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Ultra");
  await expect(screen.getByLabel("Thinking: ultra")).toBeVisible();
  await screen.getByLabel("Thinking: ultra").tap();
  await expect(slider).toBeHidden();

  await hui.reload();
  await expect(screen.getByLabel("Thinking: ultra")).toBeVisible();
  await screen.getByLabel("Thinking: ultra").tap();
  await slider.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "Off");
  await screen.getByLabel("Thinking: off").tap();
  await expect(slider).toBeHidden();

  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await screen.getByText(OPUS).tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await expect(screen.getByLabel("Thinking: low")).toBeVisible();

  const worker = await hui.createSession({ title: "Worker effort", tool: "pi" });
  await hui.open(`/sessions/${worker.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const workerTrigger = screen.getByLabel(/^Thinking: /u);
  await expect(workerTrigger).toHaveAttribute("aria-disabled", "false");
  await workerTrigger.tap();
  await slider.press("End");
  await expect(slider).not.toHaveAttribute("aria-valuetext", "Ultra");
});
