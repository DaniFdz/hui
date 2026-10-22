/** Settings → Tools: the browser tool turned off and on again, and codemode turned off under a running script (SET-052, SET-055). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown, verb: "CALL" | "HOLD" = "CALL") => `E2E_${verb}:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

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

test("Codemode is on by default; turned off, a running script finishes and the session's next request goes without it", { tags: ["SET-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const codemodeTool = screen.getByRole("switch", "Codemode tool");
  const session = await hui.createSession({ title: "Codemode switch" });

  await hui.open("/settings/tools");
  await expect(codemodeTool).toBeChecked();
  expect((await hui.api<{ codemode: { enabled: boolean } }>("GET", "/__hui/settings")).codemode.enabled).toBe(true);

  await hui.prompt(session, call("codemode", { code: 'await tools.fixture_echo({ text: "held" });\nreturn "script finished";' }, "HOLD"));
  await hui.provider.held();
  await hui.flip(codemodeTool);
  await expect(codemodeTool).toBeChecked({ checked: false });
  await expect.poll(async () => (await hui.api<{ codemode: { enabled: boolean } }>("GET", "/__hui/settings")).codemode.enabled).toBe(false);
  await hui.provider.release();
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("tool answered: Script completed", { exact: false })).toBeVisible();
  await expect(transcript.getByText("script finished", { exact: true })).toBeVisible();

  await screen.getByLabel("Message").fill(call("codemode", { code: 'return "second script";' }));
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("tool answered: <harness> [error] Tool codemode is not available </harness>")).toBeVisible();
  await expect(transcript.getByText(/second script/u)).toHaveCount(0);
});
