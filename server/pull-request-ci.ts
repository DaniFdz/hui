/**
 * Failing CI on the operator's own pull requests, sent to a session (Fix CI).
 *
 * The failing checks come from the head commit's `statusCheckRollup.contexts`:
 * check runs by `conclusion`, commit statuses by `state`. Nothing is persisted;
 * the gateway only remembers in memory which head commit it last sent.
 */
import type { PullRequestFailingCheck } from "../shared/pull-requests.ts";
import { GitHubApiError } from "./github-previews.ts";
import { MAX_MESSAGE_BYTES } from "./pull-request-comments.ts";

export const MAX_FAILING_CHECKS = 30;

/** GraphQL selection inside `statusCheckRollup`; failing ones are kept afterwards. */
export const CHECK_CONTEXTS_FIELDS = `
  contexts(first: 100) { nodes { __typename
    ... on CheckRun { name conclusion detailsUrl }
    ... on StatusContext { context state targetUrl } } }`;

const PULL_REQUEST_CHECKS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid headRefName
    commits(last: 1) { nodes { commit { statusCheckRollup { state ${CHECK_CONTEXTS_FIELDS} } } } } } }
}`;

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const link = (value: unknown) => {
  const url = text(value, 500);
  return /^https:\/\//u.test(url) ? url : "";
};

/** Failing checks of one `statusCheckRollup`, in GitHub's order, at most 30. */
export function parseFailingChecks(rollup: unknown): PullRequestFailingCheck[] {
  const nodes = record(record(rollup)["contexts"])["nodes"];
  if (!Array.isArray(nodes)) return [];
  return nodes.map(record).flatMap((node): PullRequestFailingCheck[] => {
    const run = node["__typename"] === "CheckRun" || "conclusion" in node;
    const state = text(run ? node["conclusion"] : node["state"], 40);
    const name = text(run ? node["name"] : node["context"], 300);
    if (!name || !FAILED.has(state)) return [];
    const url = link(run ? node["detailsUrl"] : node["targetUrl"]);
    return [{ name, state: state.toLowerCase(), ...(url ? { url } : {}) }];
  }).slice(0, MAX_FAILING_CHECKS);
}

export type PullRequestCi = {
  headRefOid: string;
  headRefName: string;
  /** `statusCheckRollup.state`, lower-cased ("" without checks). */
  state: string;
  failing: PullRequestFailingCheck[];
};

/** Reads one pull request's head and failing checks from GitHub again. */
export async function fetchPullRequestCi(gh: (args: readonly string[]) => Promise<unknown>, pr: { repository: string; number: number }): Promise<PullRequestCi> {
  const [owner, name] = pr.repository.split("/");
  const raw = await gh(["api", "graphql", "-f", `query=${PULL_REQUEST_CHECKS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.number}`]);
  const pullRequest = record(record(record(raw)["data"])["repository"])["pullRequest"];
  const headRefOid = text(record(pullRequest)["headRefOid"], 64);
  if (!headRefOid) throw new GitHubApiError("unavailable");
  const commits = record(record(pullRequest)["commits"])["nodes"];
  const rollup = Array.isArray(commits) ? record(record(commits.at(-1))["commit"])["statusCheckRollup"] : undefined;
  return {
    headRefOid,
    headRefName: text(record(pullRequest)["headRefName"], 255),
    state: text(record(rollup)["state"], 40).toLowerCase(),
    failing: parseFailingChecks(rollup),
  };
}

export class NoFailingChecksError extends Error {
  override name = "NoFailingChecksError";
}

/** Throws unless the head commit's checks fail now. */
export function assertFailing(ci: PullRequestCi): void {
  if (!ci.failing.length && ci.state !== "failure" && ci.state !== "error") throw new NoFailingChecksError("No checks are failing on the pull request's head commit.");
}

type PullRequestRef = { repository: string; number: number; url: string; title: string };

/** One bounded prompt listing each failing check with its link; checks that do not fit are counted. */
export function fixCiMessage(pr: PullRequestRef, ci: PullRequestCi, limit = MAX_MESSAGE_BYTES): { text: string; included: number; omitted: number } {
  const header = `CI is failing on ${pr.repository}#${pr.number}${pr.title ? ` (${pr.title.slice(0, 300)})` : ""}: ${pr.url}\n`
    + `Head commit ${ci.headRefOid}${ci.headRefName ? ` on branch ${ci.headRefName}` : ""}.\n\n`;
  const footer = `\nInvestigate each failing check (for example \`gh pr checks ${pr.number} -R ${pr.repository}\` and, for GitHub Actions, \`gh run view <run-id> -R ${pr.repository} --log-failed\`; follow the link for other CI). `
    + "Fix the failures this pull request caused, re-run the ones that look flaky or unrelated, push, and report what you fixed, what you re-ran and what you could not resolve, per the repository's rules.\n";
  const note = (omitted: number) => `${omitted} more failing ${omitted === 1 ? "check is" : "checks are"} not listed to keep this message under ${Math.floor(limit / 1000)} KB; see \`gh pr checks\`.\n`;
  if (!ci.failing.length) {
    return { text: `${header}GitHub reports the checks as failing but did not name them; list them with \`gh pr checks ${pr.number} -R ${pr.repository}\`.\n${footer}`, included: 0, omitted: 0 };
  }
  const reserve = Buffer.byteLength(header + footer + note(ci.failing.length) + "Failing checks:\n");
  let body = "";
  let count = 0;
  for (const check of ci.failing) {
    const next = `${count + 1}. ${check.name} (${check.state.replaceAll("_", " ")})${check.url ? `: ${check.url}` : ""}\n`;
    if (reserve + Buffer.byteLength(body + next) > limit) break;
    body += next;
    count += 1;
  }
  const omitted = ci.failing.length - count;
  return { text: `${header}Failing checks:\n${body}${omitted ? note(omitted) : ""}${footer}`, included: count, omitted };
}
