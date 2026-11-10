/**
 * The Plugins page removes a package from PI's settings through PI's own removal, asking first with “Remove this package
 * from PI settings?” inline: Cancel keeps it, Remove drops it and reports OK, and a direct extension has no Remove at all
 * (SET-066).
 *
 * The disposable fixture configures no PI packages, so this test writes the PI settings it needs into the run's own agent
 * directory and puts them back; nothing outside that temporary directory is touched.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Pi = { agentDir: string; settings: { path: string; resources: { id: string; label: string; kind: string }[] } };

const PACKAGE = "e2e-plugin";
const EXTENSION = "e2e-direct.ts";
const ASKED = "Remove this package from PI settings?";
const REMOVED = `Removed ${PACKAGE}.`;

/** Writes a package and a direct extension outside the checkout and points PI's own settings at both. */
const configure = async (hui: Hui) => {
  const root = await mkdtemp(join(tmpdir(), "hui-e2e-remove-"));
  const pkg = join(root, PACKAGE);
  const extension = join(root, "direct", EXTENSION);
  await mkdir(join(pkg, "extensions"), { recursive: true });
  await mkdir(join(root, "direct"), { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: PACKAGE, version: "1.0.0", keywords: ["pi-package"] }, null, 2));
  await writeFile(join(pkg, "README.md"), `# ${PACKAGE}\n\nA fixture package for the Plugins page.\n`);
  await writeFile(extension, `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n\nexport default function e2eDirect(pi: ExtensionAPI) {\n  pi.registerCommand("e2e-direct-command", { description: "A command from the fixture extension", handler: async () => undefined });\n}\n`);

  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const original = await readFile(pi.settings.path, "utf8");
  await writeFile(pi.settings.path, JSON.stringify({ ...JSON.parse(original), packages: [pkg], extensions: [extension] }, null, 2));
  return { root, settings: pi.settings.path, original };
};

test("Remove asks before dropping a package from PI's settings, Cancel keeps it, Remove drops it and reports OK, and a direct extension has no Remove", { tags: ["SET-066"], platforms: ["web"] }, async ({ screen, hui }) => {
  const configured = await configure(hui);
  try {
    await hui.open("/plugins");
    await expect(screen.getByText("2 configured sources", { exact: true })).toBeVisible();
    const remove = screen.getByRole("button", { name: `Remove ${PACKAGE}` });
    await expect(remove).toBeVisible();
    // A direct extension is not a package PI installed, so the page offers it no Remove.
    await expect(screen.getByRole("button", { name: /^Remove/u })).toHaveCount(1);
    await expect(screen.getByRole("button", { name: `Remove ${EXTENSION}` })).toHaveCount(0);

    // The question is asked inline, and Cancel keeps the package.
    await remove.tap();
    await expect(screen.getByText(ASKED, { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Cancel", exact: true }).tap();
    await expect(screen.getByText(ASKED, { exact: true })).toBeHidden();
    await expect(remove).toBeVisible();
    await expect(screen.getByText("2 configured sources", { exact: true })).toBeVisible();
    expect((await hui.api<Pi>("GET", "/__hui/pi")).settings.resources.map(({ label }) => label)).toEqual([PACKAGE, EXTENSION]);

    // Confirming removes it through PI: the row reports OK and leaves the list.
    await remove.tap();
    await expect(screen.getByText(ASKED, { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Remove", exact: true }).tap();
    await expect(screen.getByRole("status").filter({ hasText: REMOVED })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText("OK", { exact: true })).toBeVisible();
    await expect(screen.getByText("1 configured source", { exact: true })).toBeVisible();
    await expect(screen.getByText(PACKAGE, { exact: true })).toHaveCount(0);
    await expect(screen.getByText(EXTENSION, { exact: true })).toBeVisible();
    expect((await hui.api<Pi>("GET", "/__hui/pi")).settings.resources.map(({ label, kind }) => ({ label, kind }))).toEqual([
      { label: EXTENSION, kind: "extension" },
    ]);

    // The removal is PI's own: the next visit lists only what is still configured.
    await hui.reload();
    await expect(screen.getByText("1 configured source", { exact: true })).toBeVisible();
    await expect(screen.getByText(PACKAGE, { exact: true })).toHaveCount(0);
  } finally {
    await writeFile(configured.settings, configured.original);
    await rm(configured.root, { recursive: true, force: true });
  }
});
