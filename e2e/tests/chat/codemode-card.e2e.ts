/** A codemode script is one card: the tools it called, its calls filling in live, its output, a failure and a cut output (CHAT-027). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const codemode = (verb: "CALL" | "HOLD", code: string) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify({ name: "codemode", input: { code } })).toString("base64url")}`;

test("a codemode script shows its calls live, then its tools, time, failures and output", { tags: ["CHAT-027"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Codemode" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  const reveal = async (target: Locator) => {
    await hui.scrollTo(transcript, target);
    await expect(target).toBeVisible();
  };

  await message.fill(codemode("HOLD", [
    'await tools.read({ path: "fixture.txt" });',
    'await tools.read({ path: "fixture.txt" });',
    'await tools.read({ path: "missing.txt" }).catch(() => "");',
    'await tools.fixture_echo({ text: "held" });',
    'await tools.bash({ command: "echo script-bash" });',
    'return "script output";',
  ].join("\n")));
  await send.tap();
  await hui.provider.held();
  await reveal(transcript.getByText("Using 1 tool"));
  const script = transcript.getByRole("button", /^Running a codemode script 4 calls/u);
  if (!(await script.isVisible())) await transcript.getByText("Using 1 tool").tap();
  await reveal(script);
  await script.tap();
  await reveal(transcript.getByText("Running · 4 calls, 1 failed so far"));
  await reveal(transcript.getByLabel("Running"));
  await hui.provider.release();
  await expect(idle).toBeVisible();

  await reveal(transcript.getByText(/^Completed in [\d.]+s · 5 calls, 1 failed$/u));
  await reveal(transcript.getByRole("button", /^Ran a codemode script 5 calls/u));
  await reveal(transcript.getByLabel("Script"));
  await reveal(transcript.getByText("Calls · 5"));
  await expect(transcript.getByLabel("Calls").getByLabel("Done")).toHaveCount(4);
  await reveal(transcript.getByLabel("Calls").getByLabel("Failed"));
  await expect(transcript.getByLabel("Calls").getByText(/^(\d+ms|[\d.]+s)$/u)).toHaveCount(5);
  await reveal(transcript.getByText(/^ENOENT: no such file or directory, open '.+missing\.txt'$/u));
  const args = ['{"path":"fixture.txt"}', '{"path":"missing.txt"}', '{"text":"held"}', '{"command":"echo script-bash"}'].map((text) => transcript.getByText(text));
  await expect(args[0]!).toHaveCount(2);
  const tops: number[] = [];
  for (const row of [args[0]!.first(), args[0]!.last(), ...args.slice(1)]) {
    await hui.scrollTo(transcript, row);
    tops.push((await row.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await reveal(transcript.getByLabel("Output").getByText("script output"));
  await expect(transcript.getByRole("button", "Read fixture.txt")).toBeHidden();

  await message.fill(codemode("CALL", 'throw new Error("script broke");'));
  await send.tap();
  await expect(transcript.getByText(/^tool answered: /u).last()).toBeVisible();
  await expect(idle).toBeVisible();
  await reveal(transcript.getByText("Used 1 tool").last());
  const broken = transcript.getByRole("button", /^Ran a codemode script/u).last();
  if (!(await broken.isVisible())) await transcript.getByText("Used 1 tool").last().tap();
  await reveal(broken);
  await broken.tap();
  await expect(transcript.getByText(/^Failed/u)).toBeVisible();
  await expect(transcript.getByLabel("Output").last().getByText("Script error: Error: script broke", { exact: false })).toBeVisible();
});

test("a codemode output PI cut links its full output", { tags: ["CHAT-027"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Codemode full output" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill(codemode("CALL", '// @options: {"max_output_tokens": 50}\nreturn "x".repeat(500);'));
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const script = transcript.getByRole("button", /^Ran a codemode script/u);
  if (!(await script.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, script);
  await script.tap();
  await hui.scrollTo(transcript, transcript.getByText("Full output:"));
  await expect(transcript.getByText("Full output:")).toBeVisible();
});