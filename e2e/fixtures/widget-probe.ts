/** The sandbox probe's parent-origin sentinel cookie: seed and verify real readable data outside the opaque widget. */
import { randomUUID } from "node:crypto";
import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import { test as huiTest } from "./hui.ts";

export const test = huiTest.extend<{ widgetCookies: { expectIntact(): Promise<void> } }>({
  widgetCookies: async (fixtures, use) => {
    const browser = (fixtures as unknown as { browser: Browser }).browser;
    const cookie = `hui_widget_probe_${randomUUID().replaceAll("-", "")}=${randomUUID()}`;
    await fixtures.hui.open("/");
    await browser.evaluate((value) => {
      document.cookie = `${value}; Path=/; SameSite=Strict`;
      return null;
    }, cookie);
    const expectIntact = async () => {
      expect(await browser.evaluate((value) => document.cookie.split("; ").includes(value), cookie)).toBe(true);
    };
    await expectIntact();
    try {
      await use({ expectIntact });
    } finally {
      await browser.evaluate((value) => {
        document.cookie = `${value.split("=")[0]}=; Path=/; Max-Age=0; SameSite=Strict`;
        return null;
      }, cookie);
    }
  },
});
