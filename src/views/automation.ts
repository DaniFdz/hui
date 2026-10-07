/**
 * The Automation page reached from the navigation. It frames the same scheduler surface Settings shows, so the two
 * cannot drift apart; the scheduler page itself lives in settings-automation.ts.
 */
import { html, type TemplateResult } from "lit";
import { icons } from "../lib/icons.ts";
import { renderAutomationPage, type AutomationProps } from "./settings-automation.ts";

/** The navigation routes use the same real scheduler surface as Settings. */
export function renderAutomationSurface(props: AutomationProps, title: string) {
  const section = (heading: string, description: string, body: TemplateResult) => html`
    <section class="settings-section">
      <header class="settings-section__header"><div class="settings-section__copy">
        <h2 class="settings-section__heading">${heading}</h2>
        <p class="settings-section__desc">${description}</p>
      </div></header>
      <div class="settings-group">${body}</div>
    </section>`;
  return html`
    <header class="content-header content-header--settings content-header--page">
      <div><div class="page-title">${title}</div><div class="page-subtitle">Scheduled tasks and run history.</div></div>
      <button class="btn" @click=${props.onRetryAutomation}>${icons.refresh} Refresh</button>
    </header>
    <div class="settings-page settings-page--wide">${renderAutomationPage(props, section)}</div>`;
}
