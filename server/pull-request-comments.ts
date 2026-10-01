/**
 * Review comments on the operator's own pull requests, sent to a session.
 *
 * "New" means unresolved, current review threads whose latest comment is by
 * someone else, plus `COMMENTED`/`CHANGES_REQUESTED` reviews with a body by
 * someone else, created after the last send to that session. The send time is
 * the only thing persisted (`SessionRecord.pullRequestComments`), and only once
 * the session accepted the message.
 */
import { GitHubApiError } from "./github-previews.ts";

export type ReviewComment = {
  author: string;
  body: string;
  createdAt: string;
  url: string;
  path?: string;
  line?: number;
  /** Top-level reviews only. */
  state?: "COMMENTED" | "CHANGES_REQUESTED";
};

export type CommentsSent = { url: string; sentAt: string };

/** GraphQL selection for a `PullRequest` node; bounded so a search stays cheap. */
export const REVIEW_COMMENTS_FIELDS = `
  reviewThreads(last: 50) { nodes { isResolved isOutdated path line originalLine
    comments(last: 20) { nodes { author { login } body createdAt url } } } }
  reviews(last: 50, states: [COMMENTED, CHANGES_REQUESTED]) { nodes { author { login } body state submittedAt url } }`;

const PULL_REQUEST_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { author { login } ${REVIEW_COMMENTS_FIELDS} } }
}`;

const MAX_BODY = 4_000;
export const MAX_MESSAGE_BYTES = 20_000;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nodes = (value: unknown): Record<string, unknown>[] => {
  const list = record(value)["nodes"];
  return Array.isArray(list) ? list.map(record) : [];
};
const text = (value: unknown, limit = 500) => typeof value === "string" ? value.slice(0, limit) : "";
const login = (value: unknown) => text(record(value)["login"], 60).trim();
const time = (value: unknown) => {
  const raw = text(value, 40);
  return Number.isFinite(Date.parse(raw)) ? raw : "";
};
const after = (createdAt: string, sentAt?: string) => !sentAt || Date.parse(createdAt) > Date.parse(sentAt);

/** Candidate comments of one `PullRequest` node for the operator `me`, oldest first. */
export function parseReviewComments(pullRequest: unknown, me: string): ReviewComment[] {
  const data = record(pullRequest);
  const mine = (author: string) => author.toLowerCase() === me.toLowerCase();
  const found: ReviewComment[] = [];
  for (const thread of nodes(data["reviewThreads"])) {
    if (thread["isResolved"] === true || thread["isOutdated"] === true) continue;
    const comments = nodes(thread["comments"]);
    const latest = login(comments.at(-1)?.["author"]);
    if (!latest || mine(latest)) continue;
    const path = text(thread["path"], 300);
    const line = [thread["line"], thread["originalLine"]].find((value): value is number => Number.isInteger(value));
    for (const comment of comments) {
      const author = login(comment["author"]);
      const createdAt = time(comment["createdAt"]);
      const body = text(comment["body"], MAX_BODY).trim();
      if (!author || mine(author) || !createdAt || !body) continue;
      found.push({ author, body, createdAt, url: text(comment["url"]), ...(path ? { path } : {}), ...(line !== undefined ? { line } : {}) });
    }
  }
  for (const review of nodes(data["reviews"])) {
    const author = login(review["author"]);
    const state = review["state"];
    const createdAt = time(review["submittedAt"]);
    const body = text(review["body"], MAX_BODY).trim();
    if (!author || mine(author) || !createdAt || !body || (state !== "COMMENTED" && state !== "CHANGES_REQUESTED")) continue;
    found.push({ author, body, createdAt, url: text(review["url"]), state });
  }
  return found.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function newReviewComments(comments: readonly ReviewComment[], sentAt?: string): ReviewComment[] {
  return comments.filter((comment) => after(comment.createdAt, sentAt));
}

export function sentAtFor(session: { pullRequestComments?: readonly CommentsSent[] }, url: string): string | undefined {
  const key = url.toLowerCase();
  return session.pullRequestComments?.find((entry) => entry.url === key)?.sentAt;
}

/** The session's send list with `url` set to `sentAt`. */
export function recordCommentsSent(session: { pullRequestComments?: readonly CommentsSent[] }, url: string, sentAt: string): CommentsSent[] {
  const key = url.toLowerCase();
  return [...(session.pullRequestComments ?? []).filter((entry) => entry.url !== key), { url: key, sentAt }];
}

type PullRequestRef = { repository: string; number: number; url: string; title: string };

function entry(comment: ReviewComment, index: number): string {
  const where = comment.path ? `on ${comment.path}${comment.line !== undefined ? `:${comment.line}` : ""}` : comment.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed";
  const quoted = comment.body.split("\n").map((line) => `   > ${line}`).join("\n");
  return `${index + 1}. @${comment.author} ${where} (${comment.createdAt})\n   ${comment.url}\n${quoted}\n`;
}

/** One bounded prompt, oldest comment first; the newest ones are dropped to fit. */
export function reviewCommentsMessage(pr: PullRequestRef, comments: readonly ReviewComment[], limit = MAX_MESSAGE_BYTES): {
  text: string; included: ReviewComment[]; omitted: number;
} {
  const sorted = comments.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const header = `New review comments on ${pr.repository}#${pr.number}${pr.title ? ` (${pr.title.slice(0, 300)})` : ""}: ${pr.url}\n\n`
    + "Address each comment, reply on or resolve each thread per the repository's rules, push, and report what you changed.\n\n";
  const note = (omitted: number) => `\n${omitted} newer ${omitted === 1 ? "comment was" : "comments were"} not included to keep this message under ${Math.floor(limit / 1000)} KB; read ${omitted === 1 ? "it" : "them"} on the pull request.\n`;
  const reserve = Buffer.byteLength(note(sorted.length));
  let body = "";
  let count = 0;
  for (const comment of sorted) {
    const next = entry(comment, count);
    if (Buffer.byteLength(header + body + next) + (count + 1 < sorted.length ? reserve : 0) > limit) break;
    body += `${next}\n`;
    count += 1;
  }
  const omitted = sorted.length - count;
  return { text: `${header}${body.trimEnd()}\n${omitted ? note(omitted) : ""}`, included: sorted.slice(0, count), omitted };
}

/** Refetches one pull request's comments with the gateway's `gh` login. */
export async function fetchReviewComments(
  gh: (args: readonly string[]) => Promise<unknown>,
  pr: { repository: string; number: number },
): Promise<ReviewComment[]> {
  const [owner, name] = pr.repository.split("/");
  const raw = await gh(["api", "graphql", "-f", `query=${PULL_REQUEST_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.number}`]);
  const pullRequest = record(record(record(raw)["data"])["repository"])["pullRequest"];
  const me = login(record(pullRequest)["author"]);
  if (!me) throw new GitHubApiError("unavailable");
  return parseReviewComments(pullRequest, me);
}

export class NoNewCommentsError extends Error {
  override name = "NoNewCommentsError";
}

/** Refetch, build, deliver, then persist. Nothing is persisted unless `deliver` resolves. */
export async function sendReviewComments(options: {
  pr: PullRequestRef;
  sentAt?: string;
  fetch: () => Promise<ReviewComment[]>;
  deliver: (text: string) => Promise<"prompt" | "queued">;
  persist: (sentAt: string) => Promise<void>;
}): Promise<{ sent: number; omitted: number; delivery: "prompt" | "queued" }> {
  const fresh = newReviewComments(await options.fetch(), options.sentAt);
  if (!fresh.length) throw new NoNewCommentsError("No new review comments to send.");
  const message = reviewCommentsMessage(options.pr, fresh);
  const delivery = await options.deliver(message.text);
  await options.persist(message.included.at(-1)!.createdAt);
  return { sent: message.included.length, omitted: message.omitted, delivery };
}
