const APP_TITLE = "HUI";

/** Keep browser chrome useful without leaking any transcript content. */
export function documentTitle(sessionTitle?: string): string {
  const title = sessionTitle?.trim();
  return title ? `${title} · ${APP_TITLE}` : APP_TITLE;
}
