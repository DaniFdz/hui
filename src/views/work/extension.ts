/**
 * The extension-panel kind of Work view: one view per conversation, rendering <hui-extension-panel>. Its launcher opens
 * the first enabled panel; Settings → Extensions opens a specific one. A saved panel restores with the conversation.
 */
import { html } from "lit";

import { loadExtensions } from "../../api/extensions.ts";
import { extensionPanelIcon } from "../../lib/extensions/panel-icons.ts";
import { panelLauncherAvailable } from "../../lib/extensions/panel-availability.ts";
import { icons } from "../../lib/icons.ts";
import "../../components/extension-panel.ts";
import type { WorkViewKind } from "../../lib/work-pane.ts";

export type ExtensionWorkViewRef = { kind: "extension"; id?: string; icon?: string };

export const extensionWorkViewKind: WorkViewKind<ExtensionWorkViewRef> = {
  kind: "extension",
  label: "Extension panel",
  icon: icons.package,
  tabIcon: (ref) => extensionPanelIcon(ref.icon),
  // The first enabled panel, so the launcher and Settings open the same tab for it.
  hidden: () => !panelLauncherAvailable(),
  create: async () => {
    const { extensions } = await loadExtensions();
    const panel = extensions.find((extension) => extension.panel && extension.state === "loaded");
    return { kind: "extension", ...(panel ? { id: panel.id, ...(panel.panel?.icon ? { icon: panel.panel.icon } : {}) } : {}) };
  },
  key: (ref) => `extension:${ref.id ?? "all"}`,
  title: (ref) => ref.id ? `Extension: ${ref.id}` : "Extension panels",
  render: (ref, ctx) => html`<hui-extension-panel
    .extensionId=${ref.id ?? ""}
    .sessionId=${ctx.sessionId}
    .visible=${ctx.visible}
  ></hui-extension-panel>`,
};
