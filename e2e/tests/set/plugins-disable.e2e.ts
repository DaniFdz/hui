/**
 * Settings → Plugins turns a configured plugin off for HUI sessions: the switch is kept across reloads, a running session
 * keeps the plugin until it restarts, a session started afterwards loads none of its code or commands while the other
 * plugins' commands remain, PI's own configuration is unchanged, and turning it back on offers it again (SET-063).
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
type Settings = { disabledPlugins: { id: string; name: string; kind: string }[] };

const PACKAGE = "e2e-plugin";
const NOTICE = "The fixture package ran.";
/** A package's extension registers the command and the tool that only an enabled package offers a session. */
const PLUGIN_SOURCE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The fixture package's extension: loaded only while HUI sessions are offered this plugin. */
export default function e2ePlugin(pi: ExtensionAPI) {
  pi.registerCommand("e2e-package-command", {
    description: "Runs only while the fixture package is enabled",
    handler: async (_args, ctx) => { ctx.ui.notify("${NOTICE}", "info"); },
  });
}
`;

/** Writes a package outside the checkout and points PI's own settings at it. */
const configure = async (hui: Hui) => {
  const root = await mkdtemp(join(tmpdir(), "hui-e2e-plugin-"));
  const pkg = join(root, PACKAGE);
  await mkdir(join(pkg, "extensions"), { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: PACKAGE, version: "1.0.0", keywords: ["pi-package"] }, null, 2));
  await writeFile(join(pkg, "extensions", "plugin.ts"), PLUGIN_SOURCE);

  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const original = await readFile(pi.settings.path, "utf8");
  await writeFile(pi.settings.path, JSON.stringify({ ...JSON.parse(original), packages: [pkg] }, null, 2));
  return { root, settings: pi.settings.path, original };
};

test("turning a plugin off keeps it off across reloads, leaves a running session with it, keeps it out of the next session while the other plugins' commands remain, and offers it again when turned back on", { tags: ["SET-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  /** The composer's command menu, read the way the operator reads it: type `/` and look. */
  const offered = async () => {
    await message.fill("/");
    await expect(menu.getByText("$fixture-compact", { exact: true })).toBeVisible();
  };

  const configured = await configure(hui);
  try {
    // A session started now loads the package: its command sits beside the other plugins' commands.
    const loaded = await hui.createSession({ title: "Package loaded" });
    await hui.prompt(loaded, "Hello");
    await hui.open(`/sessions/${loaded.id}`);
    await offered();
    await expect(menu.getByText("$e2e-package-command", { exact: true })).toBeVisible();
    await message.fill("/e2e-package-command");
    await screen.getByRole("button", "Send message").tap();
    await expect(screen.getByText(NOTICE, { exact: true })).toBeVisible();

    // Settings → Plugins turns it off for HUI, and the choice survives a reload.
    await hui.open("/settings/plugins");
    const toggle = page.getByRole("switch", `Enable ${PACKAGE} in HUI`);
    await expect(toggle).toBeChecked();
    const resources = (await hui.api<Pi>("GET", "/__hui/pi")).settings.resources;
    await hui.flip(toggle);
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await hui.api<Settings>("GET", "/__hui/settings")).disabledPlugins.map((plugin) => plugin.name)).toEqual([PACKAGE]);
    await hui.reload();
    await expect(toggle).not.toBeChecked();
    // PI's own configuration is unchanged: the package is still configured, only HUI's list changed.
    expect((await hui.api<Pi>("GET", "/__hui/pi")).settings.resources).toEqual(resources);

    // The session that was already running keeps the plugin until it restarts.
    await hui.open(`/sessions/${loaded.id}`);
    await offered();
    await expect(menu.getByText("$e2e-package-command", { exact: true })).toBeVisible();

    // The next session loads none of it, while the other plugins' commands remain.
    const excluded = await hui.createSession({ title: "Package excluded" });
    await hui.prompt(excluded, "Hello");
    await hui.open(`/sessions/${excluded.id}`);
    await offered();
    await expect(menu.getByText("$e2e-package-command", { exact: true })).toHaveCount(0);

    // Turning it back on offers it to the session started after that.
    await hui.open("/settings/plugins");
    await hui.flip(toggle);
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await hui.api<Settings>("GET", "/__hui/settings")).disabledPlugins).toEqual([]);
    const restored = await hui.createSession({ title: "Package back" });
    await hui.prompt(restored, "Hello");
    await hui.open(`/sessions/${restored.id}`);
    await offered();
    await expect(menu.getByText("$e2e-package-command", { exact: true })).toBeVisible();
  } finally {
    await writeFile(configured.settings, configured.original);
    await rm(configured.root, { recursive: true, force: true });
  }
});
