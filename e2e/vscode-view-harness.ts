/**
 * Unshipped E2E harness for the VS Code view until the Work pane (src/lib/work-pane.ts) registers
 * vscodeWorkViewKind: the real HUI conversation on the left (the app itself, in a frame) and the kind's own launcher
 * entry, tab and render() on the right, laid out like a Work pane. Served by the dev server at
 * /e2e/vscode-view-harness.html?session=<id>[&narrow=1]. See e2e/vscode-view.browser.md.
 */
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "../src/styles/tokens.css";
import "../src/styles/app.css";
import "../src/styles/openclaw-reference/components.css";
import "../src/styles/openclaw-shell.css";
import { html, nothing, render } from "lit";
import { loadSettings } from "../src/lib/settings-store.ts";
import { applyThemeMode } from "../src/lib/theme.ts";
import { applyTheme, loadThemes } from "../src/lib/theme-store.ts";
import { installTooltips } from "../src/components/tooltip.ts";
import { onVscodeStatus } from "../src/lib/vscode-store.ts";
import { vscodeWorkViewKind } from "../src/lib/work-views/vscode.ts";

const params = new URLSearchParams(location.search);
const sessionId = params.get("session") ?? "";
const narrow = params.get("narrow") === "1" || matchMedia("(max-width: 1099px)").matches;

const [, settings] = await Promise.all([loadThemes(), loadSettings()]);
applyThemeMode(settings.themeMode, (await applyTheme(settings.theme)) ?? "both");
installTooltips();

const style = document.createElement("style");
style.textContent = `
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-body); }
  .harness { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); height: 100%; }
  .harness--narrow { grid-template-columns: 1fr; }
  .harness__chat { border: 0; width: 100%; height: 100%; border-right: 1px solid var(--border); }
  .harness__pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .harness__tabs { display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 8px; border-bottom: 1px solid var(--border); background: var(--bg); font-size: 12px; }
  .harness__tab { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; white-space: nowrap; padding: 4px 10px; border-radius: var(--radius-md); background: var(--panel); border: 1px solid var(--border); color: var(--text); }
  .harness__tab svg { width: 16px; height: 16px; }
  .harness__note { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .harness__view { flex: 1; display: flex; min-height: 0; }
`;
document.head.append(style);

const ref = await vscodeWorkViewKind.create(sessionId);
function draw() {
  const reason = vscodeWorkViewKind.unavailable?.();
  render(html`<div class="harness ${narrow ? "harness--narrow" : ""}">
    ${narrow ? nothing : html`<iframe class="harness__chat" title="HUI conversation" src=${`/sessions/${encodeURIComponent(sessionId)}`}></iframe>`}
    <section class="harness__pane" aria-label="Work pane">
      <div class="harness__tabs">
        <span class="harness__tab" data-work-view=${vscodeWorkViewKind.key(ref)}>${vscodeWorkViewKind.icon}${vscodeWorkViewKind.title(ref)}</span>
        <span class="harness__note">${reason ? `Launcher: ${reason}` : "Work pane harness"}</span>
      </div>
      <div class="harness__view">${vscodeWorkViewKind.render(ref, { sessionId, visible: true, narrow, close: () => undefined })}</div>
    </section>
  </div>`, document.body);
}
onVscodeStatus(draw);
draw();
