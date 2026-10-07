/**
 * Browser entry point for progress cards. The parsing lives in `shared/` so the gateway and the UI read a
 * card the same way.
 */
export { parseProgressCard, progressCardFromTranscript, progressCardSummary, type ProgressCard, type ProgressStep, type ProgressStepStatus } from "../../shared/progress-card.ts";
