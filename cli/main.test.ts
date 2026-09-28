import assert from "node:assert/strict";
import { test } from "node:test";
import { binding, parseCli } from "./main.ts";

test("CLI parses lifecycle, UI and local update commands without accepting stray flags", () => {
  for (const verb of ["start", "stop", "restart", "status", "logs", "run"]) assert.equal(parseCli(["gateway", verb]).command, `gateway ${verb}`);
  assert.equal(parseCli(["desktop"]).command, "desktop");
  assert.throws(() => parseCli(["desktop", "--system"]));
  assert.equal(parseCli(["install-app"]).command, "install-app");
  assert.throws(() => parseCli(["desktop", "--host", "127.0.0.1"]));
  assert.equal(parseCli(["gateway"]).command, "gateway run");
  assert.equal(parseCli(["ui", "--no-open"]).values["no-open"], true);
  assert.equal(parseCli(["update", "--from", "/tmp/release.tgz"]).values.from, "/tmp/release.tgz");
  assert.equal(parseCli(["update", "--rollback"]).values.rollback, true);
  assert.equal(parseCli(["update", "--check", "--json"]).values.check, true);
  assert.equal(parseCli(["gateway", "start", "--port", "0"]).values.port, "0");
  for (const args of [["gateway", "stop", "--host", "127.0.0.1"], ["gateway", "start", "--port", "-1"], ["gateway", "start", "--port", "65536"],
    ["gateway", "logs", "--lines", "0"], ["update", "--rollback", "--from", "file.tgz"], ["update", "--sha256", "bad"], ["update", "--check", "--rollback"], ["update", "--check", "--from", "file.tgz"], ["ui", "extra"], ["gateway", "status", "extra"], ["typo"]]) {
    assert.throws(() => parseCli(args), Error, args.join(" "));
  }
});

test("production binding is explicit and never a wildcard", () => {
  assert.deepEqual(binding(), { host: "127.0.0.1", allowedHosts: [] });
  assert.equal(binding("localhost").host, "127.0.0.1");
  assert.equal(binding("100.64.0.10").host, "100.64.0.10");
  assert.equal(binding("::1").host, "::1");
  for (const value of ["0.0.0.0", "::", "", "untrusted.example", "127.0.0.1:80"]) assert.throws(() => binding(value));
});


test("gateway environment defaults are validated and explicit flags win", () => {  const env = { HUI_GATEWAY_HOST: "127.0.0.2", HUI_GATEWAY_PORT: "5180" };
  for (const command of ["start", "run", "restart"]) {
    const parsed = parseCli(["gateway", command], env);
    assert.equal(parsed.values.host, "127.0.0.2");
    assert.equal(parsed.values.port, "5180");
  }
  const override = parseCli(["gateway", "start", "--host", "::1", "--port", "0"], env);
  assert.equal(override.values.host, "::1");
  assert.equal(override.values.port, "0");
  for (const port of ["", "-1", "65536", "12.5", "bad"]) {
    assert.throws(() => parseCli(["gateway", "start"], { HUI_GATEWAY_PORT: port }), /--port/);
  }
  for (const args of [["--help"], ["--version"], ["desktop"], ["gateway", "stop"], ["gateway", "status"]]) {
    const parsed = parseCli(args, { HUI_GATEWAY_PORT: "bad" });
    assert.equal(parsed.values.port, undefined);
  }
  assert.equal(parseCli(["gateway", "start"], {}).values.port, undefined);
});

test("--allow-host is repeatable, validated and remembered with the binding", () => {
  const parsed = parseCli(["gateway", "restart", "--allow-host", "laptop.example.ts.net", "--allow-host", "Laptop."], {});
  assert.deepEqual(parsed.values["allow-host"], ["laptop.example.ts.net", "laptop"]);
  for (const command of ["start", "run", "restart"]) {
    assert.equal(parseCli(["gateway", command, "--allow-host", "laptop"], {}).values["allow-host"]?.length, 1);
  }
  // A name that could never arrive in a Host header is refused up front, and
  // only lifecycle commands accept the flag at all.
  for (const name of ["*", "http://laptop", "laptop:4173", "laptop,two"]) {
    assert.throws(() => parseCli(["gateway", "start", "--allow-host", name], {}), /is not a host name/u, name);
  }
  for (const command of ["stop", "status", "logs"]) assert.throws(() => parseCli(["gateway", command, "--allow-host", "laptop"], {}));
});
