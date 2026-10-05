/** One stretch of work in a session: message times with no gap over 30 minutes. */
export type ActivityBlock = {
  /** Epoch milliseconds of the first and last message in the stretch. */
  start: number;
  end: number;
  /** `provider/model` of the last answer in the stretch. */
  model?: string;
  /** The operator's first message in the stretch. */
  firstMessage?: string;
};

export type ActivitySession = {
  id: string;
  title: string;
  group: string;
  /** The Git repository the session ran in, else its directory's name. */
  project: string;
  archived?: boolean;
  blocks: ActivityBlock[];
};

export type SessionActivity = { sessions: ActivitySession[] };
