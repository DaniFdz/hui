import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configuredResourceId } from "../runtimes/resource-policy.ts";
import { buildSyncPlan, mirrorPath } from "./sync.ts";

test("the mirror holds the user's PI resources with remote paths and no secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hui-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const pkg = join(home, "src", "my-package");
  const remoteMirror = "/remote/.local/share/hui-worker/mirror";
  await mkdir(join(agentDir, "skills", "local"), { recursive: true });
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  await mkdir(join(pkg, "node_modules", "dep"), { recursive: true });
  await mkdir(join(pkg, ".git"), { recursive: true });
  await mkdir(join(home, ".agents", "skills", "shared"), { recursive: true });
  await mkdir(join(root, "elsewhere"), { recursive: true });
  await writeFile(join(agentDir, "skills", "local", "SKILL.md"), "local skill");
  await writeFile(join(agentDir, "auth.json"), "{\"p\":{\"type\":\"api_key\",\"key\":\"secret\"}}");
  await writeFile(join(agentDir, "sessions", "transcript.jsonl"), "{}");
  await writeFile(join(agentDir, "models.json"), "{}");
  await writeFile(join(agentDir, "AGENTS.md"), "global context");
  await writeFile(join(pkg, "package.json"), "{\"name\":\"my-package\"}");
  await writeFile(join(pkg, "index.ts"), "export default () => {}");
  await writeFile(join(pkg, "node_modules", "dep", "index.js"), "");
  await writeFile(join(pkg, ".git", "HEAD"), "");
  await writeFile(join(home, ".agents", "skills", "shared", "SKILL.md"), "shared skill");
  await writeFile(join(root, "elsewhere", "prompt.md"), "prompt");
  await writeFile(join(root, "elsewhere", "extension.ts"), "export default () => {}");
  // A symlinked directory loop must not hang the walk.
  await symlink(join(agentDir, "skills"), join(agentDir, "skills", "local", "loop"));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    sessionDir: "~/transcripts",
    packages: ["npm:pi-tool", { source: "../../src/my-package", skills: ["x"] }],
    prompts: [join(root, "elsewhere", "prompt.md")],
    extensions: [join(root, "elsewhere", "extension.ts")],
    skills: ["~/.agents/skills/shared", "!**/draft"],
  }));

  const plan = await buildSyncPlan({ agentDir, home, remoteMirror, extraPaths: ["~/not-there"] });
  const paths = plan.files.map((file) => file.path);
  assert.ok(paths.includes("agent/skills/local/SKILL.md"));
  assert.ok(paths.includes("agent/AGENTS.md"));
  assert.ok(paths.includes("agent/models.json"));
  assert.ok(paths.includes("home/src/my-package/index.ts"));
  assert.ok(paths.includes("home/.agents/skills/shared/SKILL.md"));
  assert.ok(paths.includes(`root${join(root, "elsewhere", "prompt.md")}`));
  for (const path of paths) {
    assert.doesNotMatch(path, /auth\.json$|\/sessions\/|node_modules|\.git\//u, path);
  }
  assert.deepEqual(plan.packageRoots, ["home/src/my-package"]);

  const settings = JSON.parse(plan.files.find((file) => file.path === "agent/settings.json")!.content!.toString());
  assert.equal(settings.sessionDir, undefined);
  assert.deepEqual(settings.packages, ["npm:pi-tool", { source: `${remoteMirror}/home/src/my-package`, skills: ["x"] }]);
  assert.deepEqual(settings.skills, [`${remoteMirror}/home/.agents/skills/shared`, "!**/draft"]);
  assert.deepEqual(settings.extensions, [`${remoteMirror}/root${join(root, "elsewhere", "extension.ts")}`]);
  // HUI's disabled-plugin ids follow the rewritten source.
  assert.equal(plan.pluginIds.get(configuredResourceId("package", "../../src/my-package")), configuredResourceId("package", `${remoteMirror}/home/src/my-package`));
  assert.equal(mirrorPath(join(agentDir, "npm", "x"), { agentDir, home }), "agent/npm/x");
});
