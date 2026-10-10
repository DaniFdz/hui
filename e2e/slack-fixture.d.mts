/** Types of the fake Slack Web API (slack-fixture.mjs), for Slack triggers' tests. */
export type FakeSlackIdentity = { userId: string; user: string; teamId: string; team: string; url: string; enterpriseId?: string; scopes?: string[]; revoked?: true };

export type FakeSlackMessage = {
  channel: { id: string; name: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_ext_shared?: boolean; is_shared?: boolean };
  ts: string;
  user?: string;
  username?: string;
  text: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  edited?: { user: string; ts: string };
  attachments?: Record<string, unknown>[];
  blocks?: Record<string, unknown>[];
  team?: string;
  user_team?: string;
  permalink?: string;
};

export type FakeSlackState = {
  tokens: Record<string, FakeSlackIdentity>;
  users?: Record<string, Record<string, unknown>>;
  messages: FakeSlackMessage[];
  /** Thread parents that search doesn't return (they don't ping anyone). */
  parents?: FakeSlackMessage[];
  replies?: Record<string, Record<string, unknown>[]>;
  rateLimited?: { method?: string; retryAfter?: number; times?: number };
};

export type FakeSlackLogEntry = { method: string; params: Record<string, string>; status: number; error?: string; at: string };

export type FakeSlack = {
  state: FakeSlackState;
  log: FakeSlackLogEntry[];
  fetch(url: string, init?: RequestInit): Promise<Response>;
  respond(url: string, init?: RequestInit): Response;
};

export function createSlackFake(state: FakeSlackState): FakeSlack;
export function startSlackServer(fake: FakeSlack, options?: { port?: number; state?: () => FakeSlackState; onLog?: (entry: FakeSlackLogEntry | undefined) => void }): Promise<{ origin: string; close(): Promise<void> }>;
