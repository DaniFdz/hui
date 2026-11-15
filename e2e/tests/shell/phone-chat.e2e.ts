/** A phone's chat spends one header row: the Active panel chooser sits in the header in place of the title, and the
 * Run status popover's plan starts folded to its current step and count (SHELL-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

test(
  "a phone's chat keeps its chooser in the header and starts the plan folded in Run status",
  { tags: ["SHELL-047"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const settings = await hui.api<Settings>("GET", "/__hui/settings");
    await hui.api("PUT", "/__hui/settings", {
      ...settings,
      models: { ...settings.models, utility: "hui-e2e/fixture" },
    });
    const session = await hui.createSession({ title: "Phone chat" });
    await hui.open(`/sessions/${session.id}`);
    await hui.phoneScreen();

    const header = screen.getByTestId("chat-header");
    const picker = screen.getByRole("button", { name: /^Active panel:/u });
    await expect(picker).toBeVisible();
    const [head, chooser] = await Promise.all([
      header.boundingBox(),
      picker.boundingBox(),
    ]);
    expect(chooser!.y).toBeGreaterThanOrEqual(head!.y);
    expect(chooser!.y + chooser!.height).toBeLessThanOrEqual(
      head!.y + head!.height + 1,
    );
    expect(head!.height).toBeLessThan(70);

    await picker.tap();
    const list = screen.getByTestId("picker-list");
    for (const label of [
      "Chat",
      "Work",
      "New terminal",
      "Browser",
      "Files",
      "VS Code",
      "Diff",
    ]) {
      await expect(
        list.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    await list.getByText("Chat", { exact: true }).tap();

    await screen.getByLabel("Message").fill("E2E_PROGRESS");
    await screen.getByRole("button", "Send message").tap();
    const trigger = screen.getByTestId("run-status-trigger");
    await trigger.tap();
    await expect(screen.getByLabel("Run status")).toBeVisible();
    await expect(screen.getByText("1 of 2", { visible: true })).toBeVisible();
    const steps = screen.getByLabel("Task progress steps");
    await expect(steps).toBeHidden();
    await screen.getByText("1 of 2", { visible: true }).tap();
    await expect(steps.getByText("Read fixture")).toBeVisible();
  },
);
