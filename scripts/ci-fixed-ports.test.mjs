/** Guards fixed phone-fixture port reservations on disposable Linux CI runners, without mutating this host's kernel. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

for (const [file, job] of [["mobile.yml", "android-e2e"], ["mobile-webkit-phone.yml", "webkit-phone"]]) {
  const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
  const section = workflow.slice(workflow.indexOf(`\n  ${job}:`));
  const match = section.match(/      - name: Reserve the fixed fixture ports\n        run: \|\n((?:          .*\n)+)/u);
  const script = match?.[1].replace(/^          /gmu, "");

  test(`${job} reserves its fixed ports before services and preserves existing reservations`, () => {
    assert.ok(script, "fixed-port reservation step is missing");
    assert.ok(section.indexOf("- name: Reserve the fixed fixture ports") < section.indexOf("- uses: actions/checkout"));
    for (const existing of ["", "22,20000-20010"]) {
      // Replace both commands in this child shell: this proves argument construction, not a real sysctl change.
      const result = spawnSync("bash", ["-euc", `
        sysctl() { if [ "$1" = -n ]; then printf '%s' "$EXISTING_PORTS"; else printf '%s' "$2"; fi; }
        sudo() { "$@"; }
        ${script}
      `], { encoding: "utf8", env: { ...process.env, EXISTING_PORTS: existing } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `net.ipv4.ip_local_reserved_ports=${existing ? `${existing},` : ""}47400,47500`);
    }
  });
}
