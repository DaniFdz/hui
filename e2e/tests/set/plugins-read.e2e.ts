/**
 * Settings → Plugins says so when nothing is configured, then lists each configured source as “Managed by PI” or
 * “Direct extension”, filters them with “Search plugins”, and reads a package's README rendered or an extension's source
 * as literal code while its row stays visible behind the reader (SET-064).
 *
 * The disposable fixture configures no PI packages or extensions, so this test writes the PI settings it needs into the
 * run's own agent directory and puts them back; nothing outside that temporary directory is touched.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Pi = { agentDir: string; settings: { path: string; resources: { id: string; label: string; kind: string }[] } };

const PACKAGE = "e2e-plugin";
const EXTENSION = "e2e-direct.ts";
/** A package is an ordinary directory with a README; its extension stays unrun because this journey opens no session. */
const PACKAGE_JSON = JSON.stringify({ name: PACKAGE, version: "1.0.0", keywords: ["pi-package"] }, null, 2);
const README = `# ${PACKAGE}\n\nA fixture package for the Plugins page.\n`;
const EXTENSION_SOURCE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n\n/** A direct extension the fixture points PI at, so the page has one to read as source. */\nexport default function e2eDirect(pi: ExtensionAPI) {\n  pi.registerCommand("e2e-direct-command", { description: "A command from the fixture extension", handler: async () => undefined });\n}\n`;

/** Writes a package and a direct extension outside the checkout and points PI's own settings at them. */
const configure = async (hui: Hui) => {
  const root = await mkdtemp(join(tmpdir(), "hui-e2e-plugins-"));
  const pkg = join(root, PACKAGE);
  const extension = join(root, "direct", EXTENSION);
  await mkdir(join(pkg, "extensions"), { recursive: true });
  await mkdir(join(root, "direct"), { recursive: true });
  await writeFile(join(pkg, "package.json"), PACKAGE_JSON);
  await writeFile(join(pkg, "README.md"), README);
  await writeFile(extension, EXTENSION_SOURCE);

  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const original = await readFile(pi.settings.path, "utf8");
  await writeFile(pi.settings.path, JSON.stringify({ ...JSON.parse(original), packages: [pkg], extensions: [extension] }, null, 2));
  return { root, settings: pi.settings.path, original };
};

test("Plugins says nothing is configured, then lists each source as Managed by PI or Direct extension, filters them, and reads a README rendered or an extension's source as literal code", { tags: ["SET-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const row = (label: string) => page.getByRole("article").filter({ hasText: label });
  const reader = screen.getByRole("dialog");

  // The fixture configures nothing: the page says so and offers no filter.
  await hui.open("/settings/plugins");
  await expect(page.getByText("No packages or extensions configured.", { exact: true })).toBeVisible();
  await expect(page.getByText("No extensions", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Search plugins", { exact: true })).toBeHidden();

  const configured = await configure(hui);
  try {
    await hui.reload();
    await expect(page.getByText("2 configured sources", { exact: true })).toBeVisible();
    await expect(page.getByText("No packages or extensions configured.", { exact: true })).toBeHidden();
    const packageRow = row(PACKAGE);
    const extensionRow = row(EXTENSION);
    await expect(packageRow.getByText("Managed by PI · applies on next runtime start", { exact: true })).toBeVisible();
    await expect(extensionRow.getByText("Direct extension · applies on next runtime start", { exact: true })).toBeVisible();

    // Search keeps only the rows that match and hides the sections they leave empty.
    const search = page.getByLabel("Search plugins", { exact: true });
    await search.fill("direct");
    await expect(extensionRow).toBeVisible();
    await expect(packageRow).toBeHidden();
    await search.fill("");
    await expect(packageRow).toBeVisible();
    await expect(extensionRow).toBeVisible();

    // A package reads its README rendered, with its row still visible behind the reader.
    await page.getByRole("button", { name: `Read ${PACKAGE}` }).tap();
    await expect(reader).toBeVisible();
    await expect(reader.getByText("Rendered", { exact: true })).toBeVisible();
    await expect(reader.getByRole("heading", { name: PACKAGE })).toBeVisible();
    await expect(reader.getByText("A fixture package for the Plugins page.")).toBeVisible();
    await expect(packageRow).toBeVisible();
    await screen.getByRole("button", { name: "Close reader" }).tap();
    await expect(reader).toBeHidden();

    // An extension reads as its literal source, which the page never runs to show it.
    await page.getByRole("button", { name: `Read ${EXTENSION}` }).tap();
    await expect(reader).toBeVisible();
    await expect(reader.getByText("Source", { exact: true })).toBeVisible();
    await expect(reader.getByText(/e2e-direct-command/u)).toBeVisible();
    await expect(reader.getByText(/export default function e2eDirect/u)).toBeVisible();
    await expect(extensionRow).toBeVisible();
    await screen.getByRole("button", { name: "Close reader" }).tap();
    await expect(reader).toBeHidden();
    expect((await hui.api<Pi>("GET", "/__hui/pi")).settings.resources.map(({ label, kind }) => ({ label, kind }))).toEqual([
      { label: PACKAGE, kind: "package" },
      { label: EXTENSION, kind: "extension" },
    ]);
  } finally {
    await writeFile(configured.settings, configured.original);
    await rm(configured.root, { recursive: true, force: true });
  }
});
