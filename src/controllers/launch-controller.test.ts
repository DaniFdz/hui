import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { GitCheckoutInfo, SessionGroup } from "../api/sessions.ts";
import type { WorkerView } from "../api/workers.ts";
import type { PiSnapshot } from "../lib/pi.ts";
import { LaunchController } from "./launch-controller.ts";

const fake = vi.hoisted(() => ({
  checkouts: [] as { directory: string; worker: string | undefined }[],
  checkout: undefined as unknown as GitCheckoutInfo,
  directories: [] as { input: string; worker: string | undefined; resolve: (directories: string[]) => void }[],
  workers: [] as WorkerView[],
}));
vi.mock("../api/sessions.ts", () => ({
  loadGitCheckout: async (directory: string, worker?: string) => { fake.checkouts.push({ directory, worker }); return fake.checkout; },
}));
vi.mock("../api/working-directories.ts", () => ({
  loadWorkingDirectorySuggestions: (input: string, worker?: string) => new Promise((resolve) => fake.directories.push({ input, worker, resolve })),
}));
vi.mock("../api/workers.ts", () => ({ loadWorkers: async () => fake.workers }));

beforeEach(() => {
  fake.checkouts = [];
  fake.checkout = { available: true, headBranch: "feature/current", defaultBranch: "main", branches: ["main", "release"] } as GitCheckoutInfo;
  fake.directories = [];
  fake.workers = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true) };
const group = { label: "repo", cwd: "/repo", workspaceMode: "worktree", baseRef: "release", sessions: [] } as unknown as SessionGroup;

test("New Session starts from its group's checkout defaults, and choosing a mode keeps the base ref", async () => {
  const launch = new LaunchController(host);
  launch.branchSuggestionsOpen = true;
  launch.open(group);
  assert.deepEqual(launch.defaults, { group: "repo", cwd: "/repo", workspaceMode: "worktree", baseRef: "release" });
  assert.equal(launch.branchSuggestionsOpen, false);
  launch.requestCheckout(" /repo ");
  assert.equal(launch.checkoutLoading, true);
  await settle();
  assert.deepEqual(fake.checkouts, [{ directory: "/repo", worker: undefined }]);
  assert.equal(launch.checkoutLoading, false);
  assert.equal(launch.baseRef, "release");
  assert.equal(launch.worktree, true);
  launch.props().onWorkspaceBranchSuggestionsOpen(true);
  launch.props().onWorkspaceMode(false);
  assert.equal(launch.worktree, false);
  assert.equal(launch.baseRef, "release", "the mode never resets the base ref");
  assert.equal(launch.branchSuggestionsOpen, false);
  launch.requestCheckout("/repo");
  assert.deepEqual(fake.checkouts, [{ directory: "/repo", worker: undefined }], "the same directory is inspected once");
  launch.requestCheckout("/other");
  await settle();
  assert.equal(launch.baseRef, "main", "another directory uses the repository default");
  assert.equal(launch.worktree, false);
  launch.props().onWorkspaceBranch("feature/x");
  launch.resetWorkspace();
  assert.deepEqual([launch.branch, launch.worktree, launch.baseRef], ["", false, ""]);
});

test("folder suggestions say which machine they came from, and a newer request or a worker change drops an older answer", async () => {
  const launch = new LaunchController(host);
  launch.loadDirectorySuggestions("~/", "w1");
  fake.directories[0]!.resolve(["/remote"]);
  await settle();
  assert.deepEqual(launch.directorySuggestions, ["/remote"]);
  assert.equal(launch.directorySuggestionsFrom, "w1");
  launch.loadDirectorySuggestions("~/");
  launch.props().onSelectLaunchWorker!("w2");
  assert.equal(launch.worker, "w2");
  assert.deepEqual(launch.directorySuggestions, []);
  fake.directories[1]!.resolve(["/local"]);
  await settle();
  assert.deepEqual(launch.directorySuggestions, [], "an answer from before the worker change is dropped");
  assert.equal(launch.directorySuggestionsFrom, "w1");
});

test("launch preferences seed once from Settings or PI, and a worker that is gone stops being sticky", async () => {
  const launch = new LaunchController(host);
  const snapshot = { model: { defaultProvider: "pi", defaultModel: "m", thinking: null } } as PiSnapshot;
  launch.seedPreferences(snapshot, "");
  assert.deepEqual([launch.model, launch.thinking], ["pi/m", "medium"]);
  launch.props().onSelectLaunchModel("other", "x");
  launch.seedPreferences(snapshot, "primary/model");
  assert.equal(launch.model, "other/x", "a choice is never replaced");
  launch.worker = "w1";
  fake.workers = [{ id: "w2" } as WorkerView];
  launch.loadWorkers();
  await settle();
  assert.equal(launch.worker, undefined);
  assert.equal(launch.props().launchWorkers, fake.workers);
});

test("switching the machine inspects the same directory there, and drops the answer the other machine gave", async () => {
  const launch = new LaunchController(host);
  fake.workers = [{ id: "w1", name: "Remote" } as WorkerView];
  launch.requestCheckout("/repo");
  await settle();
  assert.deepEqual(fake.checkouts, [{ directory: "/repo", worker: undefined }]);
  launch.props().onSelectLaunchWorker!("w1");
  await settle();
  assert.deepEqual(
    fake.checkouts,
    [{ directory: "/repo", worker: undefined }, { directory: "/repo", worker: "w1" }],
    "the checkout picker answers for the machine the session will run on",
  );
  launch.requestCheckout("/repo");
  assert.equal(fake.checkouts.length, 2, "one machine's answer is reused until the machine or directory changes");
});

test("a group that names a worker opens New Session on it, and one that does not keeps the sticky choice", () => {
  const launch = new LaunchController(host);
  launch.worker = "sticky";
  launch.open({ ...group, worker: "w1" } as unknown as SessionGroup);
  assert.equal(launch.worker, "w1");
  assert.equal(launch.props().launchWorker, "w1");
  launch.open({ ...group, worker: undefined } as unknown as SessionGroup);
  assert.equal(launch.worker, "w1", "a group without a machine leaves the choice alone");
  launch.open();
  assert.equal(launch.worker, "w1");
});
