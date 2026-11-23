/**
 * Durable's prompt skills: PI's own directories, the paths a host keeps outside them (a worker's mirror of the
 * gateway's `~/.agents/skills`) and HUI's bundled ones, each skill listed once.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

// PI finds a user-agents skills directory under HOME, and HUI's configuration directory is resolved at import time:
// never the operator's own.
const root = await mkdtemp(join(tmpdir(), "hui-durable-prompt-home-"));
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
afterAll(() => rm(root, { recursive: true, force: true }));
const { DurablePrompt } = await import("./durable-prompt.ts");
const { normalizeSettings } = await import("../hui-settings.ts");
const { bundledSkills } = await import("../pi/bundled-skills.ts");
type DurablePrompt = import("./durable-prompt.ts").DurablePrompt;

const settings = normalizeSettings(undefined);
/** The gateway's home skills, as PI discovers them, and one outside every directory it reads. */
const homeSkills = join(root, ".agents", "skills");
const dir = await mkdtemp(join(tmpdir(), "hui-durable-prompt-"));
const agentDir = join(dir, "agent");
const cwd = join(dir, "workspace");
const mirrorSkills = join(dir, "mirror", "home", ".agents", "skills");
await mkdir(agentDir, { recursive: true });
await mkdir(cwd, { recursive: true });
afterAll(() => rm(dir, { recursive: true, force: true }));

async function skill(directory: string, name: string): Promise<void> {
  await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}.\n---\n\n# ${name}\n`);
}

const names = async (prompt: DurablePrompt): Promise<string[]> =>
  (await prompt.loader(cwd)).getSkills().skills.map((entry) => entry.name);

test("a prompt with no host paths lists PI's own home skills and the agent directory's", async () => {
  await skill(homeSkills, "home-user-agents-skill");
  await skill(join(agentDir, "skills"), "agent-dir-skill");
  const prompt = new DurablePrompt(agentDir, async () => settings);
  const listed = await names(prompt);
  assert.ok(listed.includes("home-user-agents-skill"), "a skill under HOME/.agents/skills, as PI finds it");
  assert.ok(listed.includes("agent-dir-skill"), "a skill in the agent directory");
});

test("a host path lists a skill outside the directories PI discovers, read when a loader is built rather than when the prompt is made", async () => {
  await skill(mirrorSkills, "mirror-user-agents-skill");
  const plain = await names(new DurablePrompt(agentDir, async () => settings));
  assert.ok(!plain.includes("mirror-user-agents-skill"));
  const hosted = await names(new DurablePrompt(agentDir, async () => settings, () => [mirrorSkills]));
  assert.ok(hosted.includes("mirror-user-agents-skill"));

  // Read when a loader is built, not when the prompt is made: a worker's daemon outlives its first sync.
  let hostPaths: string[] = [];
  const lazy = new DurablePrompt(agentDir, async () => settings, () => hostPaths);
  assert.deepEqual([...(await names(lazy))].sort(), [...plain].sort());
  hostPaths = [mirrorSkills];
  assert.deepEqual([...(await names(lazy))].sort(), [...hosted].sort());
});

test("a skill under a host path keeps its name against HUI's bundled copy of it", async () => {
  const bundled = bundledSkills[0];
  const hostSkills = join(dir, "host-skills");
  const description = "The host's own copy, not HUI's.";
  await mkdir(join(hostSkills, bundled.name), { recursive: true });
  await writeFile(join(hostSkills, bundled.name, "SKILL.md"), `---\nname: ${bundled.name}\ndescription: ${description}\n---\n\n# ${bundled.name}\n`);
  const listedWith = async (paths: string[] = []) =>
    (await new DurablePrompt(agentDir, async () => settings, () => paths).loader(cwd)).getSkills().skills;
  // HUI's packaged copy, under the same name, is what a prompt with no host path lists.
  const packaged = (await listedWith()).find((skill) => skill.name === bundled.name)?.description;
  assert.ok(packaged && packaged !== description, "the fixture differs from HUI's own copy of that skill");
  // Host paths are listed before HUI's bundled ones, and PI keeps the first skill of a shared name.
  assert.equal((await listedWith([hostSkills])).find((skill) => skill.name === bundled.name)?.description, description);
});

test("a host path PI already discovers adds nothing, and a host with none is exactly today's list", async () => {
  const plain = new Set(await names(new DurablePrompt(agentDir, async () => settings)));
  const listed = await names(new DurablePrompt(agentDir, async () => settings, () => [homeSkills]));
  assert.deepEqual([...listed].sort(), [...plain].sort(), "the same directory home discovery supplies");
  assert.equal(listed.length, new Set(listed).size, "no skill is listed twice");

  const none = await names(new DurablePrompt(agentDir, async () => settings, () => []));
  assert.deepEqual([...none].sort(), [...plain].sort(), "a gateway-local loader carries what it carried before");
});
