// Ported from OpenClaw 2026.9.5 (ec9c1a13), MIT. See README.md in this directory.
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t, asDateTimestampMs, type ProgressCard, type ProgressCardStep, type SessionRunStatus } from "./hui-hovercard-adapter.ts";
import { toSanitizedMarkdownHtml } from "./progress-markdown.ts";
type PresentedProgressStepStatus = ProgressCardStep["status"] | "paused";
const TERMINAL_OUTCOME_LABEL_KEYS: Partial<Record<SessionRunStatus, string>> = {
  done: "sessionProgressCard.outcome.completed", failed: "sessionProgressCard.outcome.failed", killed: "sessionProgressCard.outcome.stopped", timeout: "sessionProgressCard.outcome.failed",
};
function progressCounts(card: ProgressCard): { completed: number; total: number } | null {
  const steps = card.steps;
  if (!steps?.length) {
    return null;
  }
  return {
    completed: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
  };
}

type ProgressCardHeadsUp = {
  completed: number;
  status: PresentedProgressStepStatus;
  step: string;
  total: number;
};

function unfinishedProgressStep(steps: readonly ProgressCardStep[]): ProgressCardStep | undefined {
  return (
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending")
  );
}

function isProgressCardStaleForRun(card: ProgressCard, startedAt?: number): boolean {
  const runStart = asDateTimestampMs(startedAt);
  const cardUpdate = asDateTimestampMs(card.updatedAt);
  return runStart !== undefined && cardUpdate !== undefined && cardUpdate < runStart;
}

export function progressCardHeadsUp(
  card: ProgressCard | null | undefined,
  sessionStatus?: SessionRunStatus,
  startedAt?: number,
  hasActiveRun = true,
): ProgressCardHeadsUp | null {
  const staleForRun = card ? isProgressCardStaleForRun(card, startedAt) : false;
  if (sessionStatus && TERMINAL_OUTCOME_LABEL_KEYS[sessionStatus] && !staleForRun) {
    return null;
  }
  const counts = card ? progressCounts(card) : null;
  if (!counts || !card?.steps) {
    return null;
  }
  const step = unfinishedProgressStep(card.steps);
  if (!step) {
    return null;
  }
  const status =
    step.status === "in_progress" && (staleForRun || !hasActiveRun) ? "paused" : step.status;
  return { ...counts, status, step: step.step };
}

function promoteFirstProgressBar(sanitizedHtml: string): string {
  const template = document.createElement("template");
  template.innerHTML = sanitizedHtml;
  const progress = template.content.querySelector("progress");
  if (!progress) {
    return sanitizedHtml;
  }
  const value = progress.getAttribute("value")?.trim();
  const max = progress.getAttribute("max")?.trim();
  const label =
    progress.getAttribute("aria-label")?.trim() ||
    (value && max
      ? `${t("sessionProgressCard.title")} · ${value}/${max}`
      : t("sessionProgressCard.title"));
  progress.setAttribute("aria-label", label);
  const originalParent = progress.parentElement;
  const wrapper = document.createElement("div");
  wrapper.className = "session-progress-card__progress";
  const visibleLabel = document.createElement("span");
  visibleLabel.className = "session-progress-card__progress-label";
  visibleLabel.textContent = label;
  wrapper.append(visibleLabel, progress);
  if (
    originalParent?.tagName === "P" &&
    originalParent.children.length === 0 &&
    !originalParent.textContent?.trim()
  ) {
    originalParent.remove();
  }
  // Reorder only the already-sanitized tree; generated copy uses textContent so
  // promoting a bar cannot reintroduce authored markup or event handlers.
  template.content.prepend(wrapper);
  return template.innerHTML;
}

export function renderProgressCardMarkdown(
  markdown: string | undefined,
  options: { promoteProgress?: boolean } = {},
) {
  if (!markdown) {
    return nothing;
  }
  const sanitizedHtml = toSanitizedMarkdownHtml(markdown, { progressBars: true });
  return html`<div class="session-progress-card__markdown sidebar-markdown">
    ${unsafeHTML(options.promoteProgress ? promoteFirstProgressBar(sanitizedHtml) : sanitizedHtml)}
  </div>`;
}

