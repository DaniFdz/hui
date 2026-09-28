export type AutomationSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number }
  | { kind: "cron"; expression: string; timezone: string };

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type AutomationTask = {
  id: string;
  name: string;
  description: string;
  sessionId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
};

export type AutomationRun = {
  id: string;
  taskId: string;
  taskName: string;
  sessionId: string;
  source: "manual" | "scheduled";
  status: AutomationRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
};

export type AutomationSnapshot = {
  scheduler: { enabled: true; activeRuns: number; nextWakeAt: string | null };
  tasks: AutomationTask[];
  runs: AutomationRun[];
};

export type AutomationTaskInput = {
  name: string;
  description?: string;
  sessionId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled?: boolean;
  timeoutSeconds?: number;
};
