/** HUI publishes to the ntfy topic Settings → Notifications saves, and the phone's ntfy app shows it (SET-099). */
import { createServer } from "node:http";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Message = { title?: string; message?: string; priority?: number };

test("a test notification reaches the saved ntfy topic", { tags: ["SET-099"], platforms: ["web"] }, async ({ screen, hui }) => {
  const received: { topic?: string; message?: Message }[] = [];
  const relay = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      let message: Message = {};
      try {
        message = JSON.parse(body) as Message;
      } catch { /* A request that is not HUI's is still answered. */ }
      received.push({ topic: request.url?.replace(/^\//u, ""), message });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  if (!address || typeof address === "string") throw new Error("The stub relay has no address.");
  const server = `http://127.0.0.1:${address.port}`;
  try {
    const page = screen.getByTestId("settings-page");
    const serverField = page.getByLabel("ntfy server", { exact: true });
    const topic = page.getByLabel("ntfy topic", { exact: true });
    const saved = async () => (await hui.api<{ notifications: { ntfy: unknown } }>("GET", "/__hui/settings")).notifications.ntfy;

    await hui.clipboard();
    await hui.open("/settings/notifications");
    await serverField.fill(server);
    await page.getByRole("button", "Generate", { exact: true }).tap();
    await expect.poll(() => topic.inputValue()).toMatch(/^hui-[a-z0-9]+$/u);
    await topic.fill("hui-e2e-topic");
    await page.getByRole("button", "Save", { exact: true }).tap();
    await expect.poll(saved).toEqual({ server, topic: "hui-e2e-topic" });
    await page.getByRole("button", "Copy address", { exact: true }).tap();
    await expect.poll(() => hui.copied()).toBe(`${server}/hui-e2e-topic`);

    await page.getByRole("button", "Send test", { exact: true }).tap();
    await expect.poll(() => received.length).toBe(1);
    expect(received[0]?.topic).toBe("hui-e2e-topic");
    expect(received[0]?.message?.title).toBe("HUI");
    expect(received[0]?.message?.message).toContain("test notification");
    await expect(screen.getByText("Test notification sent. Check the ntfy app on your phone.")).toBeVisible();

    // A blank topic publishes nothing and says so instead of claiming a delivery.
    await topic.fill("");
    await page.getByRole("button", "Send test", { exact: true }).tap();
    await expect.poll(saved).toEqual({ server, topic: "" });
    await expect(screen.getByText("Set an ntfy topic first.")).toBeVisible();
    expect(received.length).toBe(1);
  } finally {
    // Nothing later may publish to this test's relay once it is gone.
    const settings = await hui.api<{ notifications: Record<string, unknown> }>("GET", "/__hui/settings").catch(() => undefined);
    if (settings) {
      await hui.api("PUT", "/__hui/settings", {
        ...settings,
        notifications: { ...settings.notifications, ntfy: { server: "https://ntfy.sh", topic: "" } },
      }).catch(() => undefined);
    }
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
});
