/** The enabled extension pages the shell offers: the extension id, its sidebar title and its named icon. */
import type { ExtensionStatus } from "../../api/schema/extensions.ts";

export type ExtensionPageLink = {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
};

/** Loaded extensions that contribute a page, in registry order. A disabled or failed page is not linked. */
export function extensionPageLinks(extensions: readonly ExtensionStatus[]): ExtensionPageLink[] {
  return extensions.flatMap((extension) => extension.state === "loaded" && extension.page
    ? [{ id: extension.id, title: extension.page.title, ...(extension.page.icon ? { icon: extension.page.icon } : {}) }]
    : []);
}
