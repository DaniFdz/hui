/** Settings → Tools: the browser tool turned off and on again (SET-052). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("With the browser tool off, new and restarted sessions lose it, running ones are refused and Start is disabled; on offers it again", { tags: ["SET-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const browserTool = screen.getByRole("switch", "Browser tool");
  const unavailable = "The browser tool is not available in this session.";
  const reply = async (session: { id: string }, text: string, expected: string) => {
    await hui.prompt(session, text);
    await hui.open(`/sessions/${session.id}`);
    await expect(transcript.getByText(expected, { exact: false })).toBeVisible();
  };
  const running = await hui.createSession({ title: "Running browser" });
  await reply(running, "Hello before", "Hello before");

  await hui.open("/settings/tools");
  const off = screen.getByText("Off", { exact: true });
  await expect(browserTool).toBeChecked();
  await expect(off).toHaveCount(2);
  await expect(screen.getByText("Stopped", { exact: true })).toBeVisible();
  await hui.flip(browserTool);
  await expect(browserTool).toBeChecked({ checked: false });
  await expect(off).toHaveCount(3);
  await expect(off.first()).toBeVisible();
  await expect(screen.getByRole("button", "Start")).toBeDisabled();

  await reply(running, call("browser", { action: "tabs" }), "tool answered: <harness> [error] The browser tool is turned off in HUI Settings → Tools → Browser.");
  await reply(await hui.createSession({ title: "New without browser" }), "E2E_BROWSER", unavailable);
  await hui.restartGateway();
  await hui.open(`/sessions/${running.id}`);
  await expect(transcript.getByText("Hello before")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_BROWSER restarted");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(unavailable)).toBeVisible();

  await hui.open("/settings/tools");
  await hui.flip(browserTool);
  await expect(browserTool).toBeChecked();
  await expect(off).toHaveCount(2);
  await expect(screen.getByRole("button", "Start")).toBeEnabled();
  await reply(await hui.createSession({ title: "New with browser" }), "E2E_BROWSER", "The headless browser rendered: Hello, HUI agent!");
});
