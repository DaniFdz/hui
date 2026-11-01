/** A marked chat link hands off to HUI's macOS app; when that app is missing the page keeps the chat and offers the
 * hui:// address, or dismisses the notice (CHAT-083). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test(
  "a marked chat link falls back to Open in HUI when the desktop app is not installed",
  { tags: ["CHAT-083"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const session = await hui.createSession({ title: "App handoff" });
    await hui.spoofUserAgent(MAC);
    const handoff = await hui.intercept("POST", /\/__hui\/app\/open$/u);
    await hui.open(`/sessions/${session.id}?open=app`);
    await handoff.arrived();
    await handoff.reject(
      503,
      "The HUI desktop app is not installed on this machine.",
    );

    const notice = screen.getByText("This chat is also in the HUI app.", {
      exact: true,
    });
    await expect(notice).toBeVisible();
    await expect(screen.getByRole("link", "Open in HUI")).toHaveAttribute(
      "href",
      `hui://sessions/${session.id}`,
    );
    await screen.getByRole("button", "Dismiss notification").tap();
    await expect(notice).toBeHidden();
  },
);
