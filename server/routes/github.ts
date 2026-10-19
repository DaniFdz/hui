/**
 * `/__hui/github…`: the `gh` connection and its device login (`github.ts`), link previews (`github-previews.ts`)
 * and the contributions calendar (`github-contributions.ts`), plus `GET /__hui/session-activity`, the sessions' own
 * days shown beside it. `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { BotService } from "../bot-service.ts";
import { FIRST_YEAR as GITHUB_FIRST_YEAR, type GitHubContributionsReader, latestYear } from "../github-contributions.ts";
import type { GitHubPreviews } from "../github-previews.ts";
import { type GitHubCli, GitHubCliError } from "../github.ts";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { botsOn } from "../hui-settings.ts";
import { activityRange, readSessionActivity } from "../session-activity.ts";
import { readRegistry } from "../sessions.ts";
import { MAX_GITHUB_EMBEDS, parseGitHubUrl } from "../../shared/github-links.ts";

const GITHUB_ROUTE = "/__hui/github";
const GITHUB_LOGIN_ROUTE = `${GITHUB_ROUTE}/login`;
const GITHUB_PREVIEWS_ROUTE = `${GITHUB_ROUTE}/previews`;
const GITHUB_CONTRIBUTIONS_ROUTE = `${GITHUB_ROUTE}/contributions`;
const SESSION_ACTIVITY_ROUTE = "/__hui/session-activity";

export function createGitHubRoutes(deps: {
  githubCli: GitHubCli;
  githubPreviews: GitHubPreviews;
  githubContributions: GitHubContributionsReader;
  bots: BotService;
}) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    const { githubCli, githubPreviews, githubContributions, bots } = deps;

    if (path === GITHUB_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      return { status: 200, body: await githubCli.connection() };
    }

    if (path === GITHUB_PREVIEWS_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      const urls = request.query.getAll("url");
      if (urls.length === 0 || urls.length > MAX_GITHUB_EMBEDS || urls.some((url) => url.length > 500 || !parseGitHubUrl(url))) {
        return { status: 400, body: { error: `Pass 1-${MAX_GITHUB_EMBEDS} github.com repository, pull request or issue URLs.` } };
      }
      return { status: 200, body: { previews: await Promise.all(urls.map((url) => githubPreviews.lookup(url))) } };
    }

    if (path === SESSION_ACTIVITY_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      const range = activityRange(request.query);
      if (!range) return { status: 400, body: { error: "from and to must be epoch milliseconds, to after from and at most 31 days apart." } };
      try {
        // Bots off: their chats' activity stays out of the calendar too (a record whose bot is gone is a session).
        const records = await readRegistry();
        const listed = await botsOn() ? records : records.filter((record) => !record.bot || !bots.identity(record.bot));
        return { status: 200, body: await readSessionActivity(listed, range.from, range.to) };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : "Session activity could not be read." } };
      }
    }

    if (path === GITHUB_CONTRIBUTIONS_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      const params = request.query;
      const year = params.has("year") ? Number(params.get("year")) : undefined;
      if (year !== undefined && !(Number.isInteger(year) && year >= GITHUB_FIRST_YEAR && year <= latestYear())) {
        return { status: 400, body: { error: `year must be ${GITHUB_FIRST_YEAR}-${latestYear()}.` } };
      }
      try {
        return { status: 200, body: await githubContributions.read(year, params.get("refresh") === "1") };
      } catch (error) {
        return { status: 502, body: { error: error instanceof Error ? error.message : "GitHub activity could not be read." } };
      }
    }

    if (path === GITHUB_LOGIN_ROUTE) {
      if (method !== "POST" && method !== "DELETE") return { status: 405, body: { error: "method not allowed" } };
      try {
        const result = method === "POST" ? await githubCli.startLogin() : await githubCli.cancelLogin();
        if (result.status === "connected") githubPreviews.clearFailures();
        return { status: 200, body: result };
      } catch (error) {
        return { status: error instanceof GitHubCliError ? error.status : 500, body: { error: error instanceof Error ? error.message : "Could not sign in to GitHub." } };
      }
    }

    return undefined;
  }

  return { handle };
}
