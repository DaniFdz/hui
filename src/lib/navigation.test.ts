import assert from "node:assert/strict";
import test from "node:test";
import {
  navigationPath,
  isRoutablePage,
  resolveNavigation,
  ROUTABLE_SETTINGS_PAGES,
  settingsCloseNavigation,
  settingsReturnTarget,
} from "./navigation.ts";
import { HUI_PAGES } from "./pages.ts";

test("home has a stable canonical route", () => {
  assert.deepEqual(resolveNavigation("/"), { target: { kind: "home" }, path: "/" });
});

test("the Kanban board has its own canonical route", () => {
  assert.deepEqual(resolveNavigation("/kanban"), { target: { kind: "kanban" }, path: "/kanban" });
  assert.equal(navigationPath({ kind: "kanban" }), "/kanban");
  assert.deepEqual(resolveNavigation("/kanban/extra"), { target: { kind: "home" }, path: "/" });
});

test("every page is served at its own top-level route", () => {
  assert.equal(new Set(HUI_PAGES.map((page) => page.id)).size, HUI_PAGES.length);
  for (const page of HUI_PAGES) {
    const resolved = resolveNavigation(`/${page.id}`);
    assert.deepEqual(resolved, { target: { kind: "page", page }, path: `/${page.id}` }, page.id);
    assert.equal(navigationPath({ kind: "page", page }), `/${page.id}`);
  }
});

test("page routing survives a structurally equivalent page from an older HMR module", () => {
  const plugins = HUI_PAGES.find((page) => page.id === "plugins");
  assert.ok(plugins);
  assert.equal(isRoutablePage({ ...plugins }), true);
  assert.equal(isRoutablePage({ ...plugins, id: "not-real" }), false);
});

test("the removed capability catalogue and placeholder pages resolve home", () => {
  for (const path of ["/capabilities", "/capabilities/skills", "/chat", "/permissions", "/question", "/secrets", "/agents", "/dashboards"]) {
    assert.deepEqual(resolveNavigation(path), { target: { kind: "home" }, path: "/" }, path);
  }
});

test("only retained settings areas are routable", () => {
  for (const page of ROUTABLE_SETTINGS_PAGES) {
    assert.deepEqual(resolveNavigation(`/settings/${page}`), {
      target: { kind: "settings", page },
      path: `/settings/${page}`,
    });
  }
  assert.deepEqual(resolveNavigation("/settings/channels"), {
    target: { kind: "home" },
    path: "/",
  });
  assert.deepEqual(resolveNavigation("/settings/nodes"), {
    target: { kind: "home" },
    path: "/",
  });
});

test("the old Worktrees page URL opens its Settings page", () => {
  assert.deepEqual(resolveNavigation("/worktrees"), { target: { kind: "settings", page: "worktrees" }, path: "/settings/worktrees" });
});

test("session ids are encoded and decoded without changing identity", () => {
  const target = { kind: "session", id: "session id?#" } as const;
  const path = navigationPath(target);
  assert.equal(path, "/sessions/session%20id%3F%23");
  assert.deepEqual(resolveNavigation(path), { target, path });
});

test("unknown, malformed and overlong routes resolve to canonical home", () => {
  for (const path of [
    "/unknown",
    "/not-real",
    "/skills/extra",
    "/settings/appearance/extra",
    "/sessions/%E0%A4%A",
  ]) {
    assert.deepEqual(resolveNavigation(path), { target: { kind: "home" }, path: "/" }, path);
  }
  assert.equal(resolveNavigation("/sessions/").path, "/sessions", "a trailing slash canonicalizes to the Sessions page");
});

test("Settings returns to its app origin while a direct Settings route falls home", () => {
  const skills = HUI_PAGES.find((page) => page.id === "skills");
  assert.ok(skills);
  assert.deepEqual(settingsReturnTarget({ kind: "page", page: skills }), {
    kind: "page",
    page: skills,
  });
  assert.deepEqual(settingsReturnTarget({ kind: "session", id: "session-1" }), {
    kind: "session",
    id: "session-1",
  });
  assert.deepEqual(settingsReturnTarget({ kind: "settings", page: "models" }), {
    kind: "home",
  });
});

test("closing Settings replaces its history entry instead of pushing the origin again", () => {
  const activity = HUI_PAGES.find((page) => page.id === "activity");
  assert.ok(activity);

  const fromPage = settingsReturnTarget({ kind: "page", page: activity });
  assert.deepEqual(settingsCloseNavigation(fromPage), {
    target: { kind: "page", page: activity },
    replace: true,
  });

  const fromDirectLink = settingsReturnTarget({ kind: "settings", page: "models" });
  assert.deepEqual(settingsCloseNavigation(fromDirectLink), {
    target: { kind: "home" },
    replace: true,
  });
});
