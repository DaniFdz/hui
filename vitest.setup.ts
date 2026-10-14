// Runs in each Vitest worker before its tests. CI preloads Datadog's tracer through NODE_OPTIONS (see test.yml);
// the worker has loaded it by now, so drop it here: the gateways, workers and CLIs the tests spawn are code under
// test, not test runners, and must start as they do for users.
delete process.env["NODE_OPTIONS"];
