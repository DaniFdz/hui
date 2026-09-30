import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModelCatalogReader,
  readPiConfigAt,
  resolvePiAgentDir,
  safeSourceLabel,
} from "./pi-config.ts";

test("PI_CODING_AGENT_DIR is canonical with PI_AGENT_DIR compatibility", () => {
  assert.equal(
    resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/canonical", PI_AGENT_DIR: "/legacy" }, "/home/test"),
    "/canonical",
  );
  assert.equal(resolvePiAgentDir({ PI_AGENT_DIR: "/legacy" }, "/home/test"), "/legacy");
  assert.equal(resolvePiAgentDir({ PI_CONFIG_DIR: "/config" }, "/home/test"), "/config/agent");
  assert.equal(resolvePiAgentDir({}, "/home/test"), "/home/test/.pi/agent");
});

/** A throwaway pi agent directory, so tests never touch the real `~/.pi`. */
async function fixture(settings: unknown, skills: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hui-pi-config-"));
  await writeFile(join(dir, "settings.json"), JSON.stringify(settings), "utf8");
  for (const [name, body] of Object.entries(skills)) {
    const skillDir = join(dir, "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), body, "utf8");
  }
  return dir;
}

test("reads pi's skills, with their frontmatter", async () => {
  const dir = await fixture({}, {
    alpha: "---\nname: alpha\ndescription: Does the alpha thing.\n---\n\n# Alpha\n",
    beta: "---\nname: beta\ndescription: Does the beta thing.\n---\n",
  });
  const snapshot = await readPiConfigAt(dir);
  assert.deepEqual(
    snapshot.skills.map((skill) => skill.name),
    ["alpha", "beta", "create-verification-skill", "git-selective-staging"],
  );
  assert.equal(snapshot.skills[0]?.description, "Does the alpha thing.");
  await rm(dir, { recursive: true, force: true });
});

test("falls back to the directory name when frontmatter is missing or broken", async () => {
  const dir = await fixture({}, { "no-frontmatter": "# Just a heading\n" });
  const snapshot = await readPiConfigAt(dir);
  assert.equal(snapshot.skills.find((skill) => skill.name === "no-frontmatter")?.description, "");
  await rm(dir, { recursive: true, force: true });
});

test("reports shipped definitions separately from configured sources", async () => {
  const dir = await fixture(
    {
      extensions: ["/opt/pi/ext/team-tools.ts"],
      packages: ["npm:@acme/pi-pack", { source: "git:github.com/acme/other" }],
    },
    {},
  );
  const snapshot = await readPiConfigAt(dir);
  const builtin = snapshot.tools.filter((tool) => tool.kind === "builtin").map((t) => t.name);
  assert.deepEqual(builtin, ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"]);
  assert.deepEqual(
    snapshot.tools.filter((tool) => tool.kind === "hui").map((t) => t.name),
    ["progress_card", "terminal", "sessions_spawn", "present_media", "sessions_list", "sessions_history", "sessions_send", "suggest_task", "dismiss_task", "set_stage", "subagents", "browser"],
  );
  assert.deepEqual(snapshot.settings.extensions, ["team-tools.ts"]);
  assert.deepEqual(snapshot.settings.packages, ["@acme/pi-pack", "other"]);
  assert.deepEqual(snapshot.settings.resources.map(({ label, kind }) => ({ label, kind })), [
    { label: "@acme/pi-pack", kind: "package" },
    { label: "other", kind: "package" },
    { label: "team-tools.ts", kind: "extension" },
  ]);
  assert(snapshot.settings.resources.every((resource) => /^[a-f0-9]{24}$/u.test(resource.id)));
  await rm(dir, { recursive: true, force: true });
});

test("reads model defaults and reports providers by name only", async () => {
  const dir = await fixture(
    {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4",
      defaultThinkingLevel: "high",
      enabledModels: ["anthropic/*", "*sonnet*"],
    },
    {},
  );
  await writeFile(
    join(dir, "auth.json"),
    JSON.stringify({ anthropic: { apiKey: "sk-secret-value" }, google: { oauth: true } }),
    "utf8",
  );
  const snapshot = await readPiConfigAt(dir);
  assert.equal(snapshot.model.defaultProvider, "anthropic");
  assert.equal(snapshot.model.defaultModel, "claude-sonnet-4");
  assert.equal(snapshot.model.thinking, "high");
  assert.deepEqual(snapshot.model.enabled, ["anthropic/*", "*sonnet*"]);
  assert.deepEqual(snapshot.model.authenticated, ["anthropic", "google"]);
  // The credential itself must never leave the file.
  assert.doesNotMatch(JSON.stringify(snapshot), /sk-secret-value/);
  await rm(dir, { recursive: true, force: true });
});

test("a fresh install includes HUI defaults without changing PI configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-pi-empty-"));
  const snapshot = await readPiConfigAt(dir);
  assert.equal(snapshot.settings.exists, false);
  assert.deepEqual(snapshot.skills.map((skill) => skill.name), ["create-verification-skill", "git-selective-staging"]);
  for (const skill of snapshot.skills) {
    assert.equal(skill.origin, "hui");
    assert.deepEqual(skill.tags, ["good practices"]);
    assert.equal(skill.preferencePath, `hui:skill:${skill.name}`);
  }
  assert.deepEqual(snapshot.settings.skillRoots, []);
  assert.deepEqual(snapshot.model.authenticated, []);
  assert.deepEqual(snapshot.model.enabled, []);
  // A missing settings file is normal, not a diagnostic worth alarming about.
  assert.deepEqual(snapshot.diagnostics, []);
  await rm(dir, { recursive: true, force: true });
});

test("normalises an invalid thinking level to null", async () => {
  const dir = await fixture({ defaultThinkingLevel: "turbo" }, {});
  const snapshot = await readPiConfigAt(dir);
  assert.equal(snapshot.model.thinking, null);
  await rm(dir, { recursive: true, force: true });
});

test("redacts credentials and signed queries from package labels", () => {
  assert.equal(safeSourceLabel("git+https://user:secret@example.com/acme/tool.git?token=hidden"), "example.com/tool");
  assert.equal(safeSourceLabel("/private/packages/local-extension.ts"), "local-extension.ts");
  assert.equal(safeSourceLabel("npm:@acme/pi-pack?token=hidden"), "@acme/pi-pack");
});

test("model catalog reads are single-flight, cached and always dispose PI", async () => {
  let starts = 0;
  let disposals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = createModelCatalogReader(async () => {
    starts += 1;
    return {
      async listModels() {
        await gate;
        return [{ provider: "test", id: "model", name: "Test Model" }];
      },
      dispose() { disposals += 1; },
    };
  });

  const first = read();
  const second = read();
  assert.equal(starts, 1);
  release();
  assert.deepEqual(await first, await second);
  assert.deepEqual(await read(), {
    catalog: [{ provider: "test", id: "model", name: "Test Model" }],
  });
  assert.equal(starts, 1);
  assert.equal(disposals, 1);
});

test("model catalog invalidation during discovery re-probes instead of publishing stale models", async () => {
  let starts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = createModelCatalogReader(async () => {
    const id = String(++starts);
    return {
      async listModels() { if (id === "1") await gate; return [{ provider: "test", id, name: id, contextWindow: 32000 }]; },
      dispose() {},
    };
  });
  const first = read(); read.invalidate(); const second = read(); release();
  assert.deepEqual(await first, await second);
  assert.equal((await read()).catalog[0]?.id, "2");
  assert.equal((await read()).catalog[0]?.contextWindow, 32000);
  assert.equal(starts, 2);
});
