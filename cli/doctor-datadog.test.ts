import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

// HUI's directory resolves at import time: never the operator's own.
const root = await mkdtemp(join(tmpdir(), "hui-doctor-datadog-"));
const config = join(root, "config", "hui");
const pup = join(config, "pup");
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
afterAll(() => rm(root, { recursive: true, force: true }));
const { datadogCheck } = await import("./doctor-datadog.ts");
const { formatDoctorReport, runDoctor } = await import("./doctor.ts");

const doctor = () => runDoctor({ installation: { installationRoot: root, packageRoot: root }, checks: [datadogCheck], gatewayStatus: async () => ({ status: "stopped" }), lock: (operation) => operation() });
const org = (name: string, site = "app.datadoghq.com") => ({ name, site });
const session = { access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 3600, issued_at: 1_760_000_000, scope: "", client_id: "c" };

test("an unconfigured Datadog integration reads only, and creates no file", async () => {
  assert.deepEqual(await doctor(), { ok: true, checks: [{ id: "datadog", title: "Datadog", status: "ok", summary: "no Datadog org is configured", items: [], notes: [] }] });
  assert.equal(existsSync(config), false);
});

test("an org whose session pup keeps outside HUI's own directory is reported, and one it keeps is not", async () => {
  await mkdir(pup, { recursive: true });
  await writeFile(join(config, "datadog.json"), JSON.stringify({ version: 1, orgs: [org("prod"), org("eu", "app.datadoghq.eu")] }));
  await writeFile(join(pup, "tokens_datadoghq_com.json"), JSON.stringify({ prod: session }));
  await writeFile(join(pup, "sessions.json"), JSON.stringify([
    { site: "datadoghq.com", org: "prod", org_uuid: "8dee" },
    { site: "datadoghq.eu", org: "eu", org_uuid: "9eee" },
  ]));

  const report = await doctor();
  assert.equal(report.ok, false, "a sign-in is something left to do, as for any blocked item");
  assert.deepEqual(report.checks[0]!.items, [{
    id: "app.datadoghq.eu/eu",
    label: "eu at app.datadoghq.eu",
    status: "blocked",
    detail: `no pup session in ${pup}`,
  }]);
  assert.equal(report.checks[0]!.summary, "1 org needs a sign-in in Settings → Integrations → Datadog");
  assert.match(report.checks[0]!.notes[0]!, /system keychain/u);
  assert.equal(formatDoctorReport(report), [
    "✗ Datadog: 1 org needs a sign-in in Settings → Integrations → Datadog",
    "    ! eu at app.datadoghq.eu: no pup session in " + pup,
    "  HUI keeps pup's Datadog sessions in its own directory so it can give them to a worker; a session made before that lives in the system keychain and is not read here. Sign in again in Settings → Integrations → Datadog.",
  ].join("\n"));
});

test("every org with its session in HUI's directory needs nothing, and the check never offers a fix", async () => {
  await writeFile(join(pup, "tokens_datadoghq_com.json"), JSON.stringify({ prod: session }));
  await writeFile(join(pup, "tokens_datadoghq_eu.json"), JSON.stringify({ eu: session }));
  const report = await doctor();
  assert.deepEqual(report.checks[0], { id: "datadog", title: "Datadog", status: "ok", summary: "every org has its pup session in HUI's own directory", items: [], notes: [] });
  assert.equal(datadogCheck.fix, undefined, "the sign-in runs in a browser");
});

test("a datadog.json HUI cannot read is reported, never overwritten", async () => {
  await writeFile(join(config, "datadog.json"), JSON.stringify({ version: 9, orgs: [] }));
  const report = await doctor();
  assert.equal(report.ok, false);
  assert.equal(report.checks[0]!.summary, "datadog.json can't be read");
  assert.match(report.checks[0]!.items[0]!.detail!, /datadog\.json is not a Datadog org list/u);
  assert.equal((await readdir(config)).sort().join(","), "datadog.json,pup");
});
