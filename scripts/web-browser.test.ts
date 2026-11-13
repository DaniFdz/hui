/** Pins the web fixture to full headless Chromium, whose real fake microphone honors per-attempt permission grants. */
import { createRequire } from "node:module";
import { expect, test, vi } from "vitest";
import { FAKE_MEDIA_ARGS, localChromium } from "../e2e/fixtures/web-browser.ts";

vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  existsSync: () => true,
}));

const playwright = createRequire(import.meta.resolve("@e2e-dev/web"))("playwright-core") as typeof import("playwright-core");

test("the media browser leases full Chromium headlessly, not the unsupported headless shell, without granting permission globally", async () => {
  const executable = "/fixture/full-chromium";
  vi.spyOn(playwright.chromium, "executablePath").mockReturnValue(executable);
  const close = vi.fn(async () => {});
  const launch = vi.spyOn(playwright.chromium, "launchServer").mockResolvedValue({
    close,
    process: () => null,
  } as unknown as Awaited<ReturnType<typeof playwright.chromium.launchServer>>);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1/browser" }))));
  const request = {
    runId: "media-guard", targetName: "web", slot: 0, slots: 1, env: {},
    signal: new AbortController().signal, log: () => {},
  };
  const provider = localChromium({ name: "media guard", args: FAKE_MEDIA_ARGS });
  const lease = await provider.acquire(request);
  try {
    expect(launch).toHaveBeenCalledWith({
      executablePath: executable,
      headless: true,
      args: ["--use-fake-device-for-media-stream", expect.stringMatching(/^--remote-debugging-port=\d+$/u)],
      timeout: expect.any(Number),
    });
    expect(lease.cdpEndpoint).toBe("ws://127.0.0.1/browser");
  } finally {
    await provider.release(lease, request);
  }
  expect(close).toHaveBeenCalledOnce();
});
