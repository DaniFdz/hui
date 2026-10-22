/** A fresh app connects to the gateway whose address is typed on Connect to HUI, remembers it and says a development gateway's version is unverified (IOS-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a fresh app connects to the address typed on Connect to HUI, remembers it and says a development gateway's version is unverified", { tags: ["IOS-001"], platforms: ["ios"] }, async ({ app, screen, hui }) => {
  await hui.createSession({ title: "Listed by the gateway" });
  const row = screen.getByLabel(/^Listed by the gateway, status idle, tool durable, stage investigation/u);
  await app.clearState();
  await screen.getByRole("button", "Connect").tap();
  await expect(screen.getByText("Enter the gateway's address, such as http://127.0.0.1:4000.")).toBeVisible();

  await screen.getByLabel("Gateway URL").fill(hui.gateway);
  await screen.getByRole("button", "Connect").tap();
  await expect(screen.getByText("Development gateway: its version is unverified.")).toBeVisible();
  await expect(row).toBeVisible();

  await app.restart();
  await expect(row).toBeVisible();
});
