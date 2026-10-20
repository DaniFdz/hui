import assert from "node:assert/strict";
import { test } from "vitest";
import { HuiApp } from "./hui-app.ts";
import type { ComposerController } from "./controllers/composer-controller.ts";
import type { SessionsController } from "./controllers/sessions-controller.ts";
import type { SessionGroup, SessionView } from "./api/sessions.ts";
import type { PanePresentation } from "./components/session-multiplexer.ts";
import type { SessionPane } from "./lib/session/multiplexer.ts";

type Shell = {
  composer: ComposerController;
  sessions: SessionsController;
  renderSessionPane: (pane: SessionPane, state: PanePresentation) => unknown;
};

const shell = () => new HuiApp() as unknown as Shell;

function bindings(template: unknown): Map<string, unknown> {
  const { strings, values } = template as { strings: readonly string[]; values: unknown[] };
  return new Map(values.map((value, i) => [strings[i]!.match(/(\S+)=$/u)![1]!, value]));
}

const pane = { id: "pane-1", sessionId: "s1" };
const presented = { active: true, visible: true, narrow: false, split: true };

test("the shell hands a split pane its registry entry, so the pane opens without its own fetch", () => {
  const app = shell();
  const session = { id: "s1", title: "Build" } as SessionView;
  app.sessions.groups = [{ name: "Frontend", sessions: [session] } as unknown as SessionGroup];
  assert.equal(bindings(app.renderSessionPane(pane, presented)).get(".paneSession"), session);
});

test("the shell marks a split pane's reported draft on its own sidebar", () => {
  const app = shell();
  (bindings(app.renderSessionPane(pane, presented)).get(".onPaneDraftChange") as (sessionId: string, hasDraft: boolean) => void)("s1", true);
  assert.deepEqual([...app.composer.draftSessionIds], ["s1"]);
});
