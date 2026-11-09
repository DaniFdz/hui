/**
 * The icon an extension panel shows in the Work pane tab and rail: a name from the manifest mapped to
 * one of HUI's marks. A missing or unknown name falls back to the package cube, so an older manifest
 * or a name added later never costs the tab its icon.
 */
import type { TemplateResult } from "lit";

import { brandMarks, icons } from "../icons.ts";

export type ExtensionPanelIcon = "package" | "github" | "pull-request";

/** A manifest name to a 16px mark; unknown names get the package icon. */
export function extensionPanelIcon(name: string | undefined): TemplateResult {
  if (name === "github") return brandMarks.github;
  if (name === "pull-request") return brandMarks.pullRequest;
  return icons.package;
}
