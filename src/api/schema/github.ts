/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type GitHubAccount = { "host": string; "login": string; "scopes": Array<string>; "tokenSource"?: string; };

export type GitHubConnection = { "cli": ({ "installed": false; }) | ({ "installed": true; "version": string; }); "status": ("connected") | ("disconnected") | ("invalid") | ("unknown"); "account"?: GitHubAccount; "message"?: string; "login": GitHubLoginState; };

export type GitHubContributionAccount = { "login": string; "createdAt"?: string; "commits": Array<string>; "pullRequests": Array<string>; "error"?: string; };

export type GitHubContributions = { "accounts": Array<GitHubContributionAccount>; };

export type GitHubLoginState = ({ "phase": "idle"; }) | ({ "phase": "starting"; }) | ({ "phase": "pending"; "userCode": string; "verificationUri": string; "expiresAt": number; }) | ({ "phase": "failed"; "message": string; });

export type GitHubPreview = ({ "kind": "repo"; "url": string; "fullName": string; "description"?: string; "stars": number; "forks": number; "language"?: string; "private": boolean; "archived": boolean; }) | ({ "kind": "pull"; "url": string; "repository": string; "number": number; "title": string; "state": PullRequestState; "author"?: string; "additions": number; "deletions": number; "changedFiles": number; "comments": number; "body"?: string; }) | ({ "kind": "issue"; "url": string; "repository": string; "number": number; "title": string; "state": ("open") | ("closed"); "stateReason"?: string; "author"?: string; "comments": number; "labels": Array<string>; "body"?: string; });

export type GitHubPreviewError = ("not_found") | ("signed_out") | ("cli_missing") | ("unavailable");

export type GitHubPreviewResult = { "url": string; "preview"?: GitHubPreview; "error"?: GitHubPreviewError; };

export type PullRequestState = ("open") | ("draft") | ("merged") | ("closed");
