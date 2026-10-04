#!/usr/bin/env node
/** Version for a nightly package built from a `main` commit. It is a
 * prerelease of the next patch, so it sorts after the current stable version
 * and before the next stable one; the commit time orders nightlies and the
 * abbreviated hash names the commit it was built from. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const NIGHTLY_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-nightly\.[1-9]\d{13}\.g[0-9a-f]{7,40}$/u;

export function nightlyVersion(version, committedAt, sha) {
  const stable = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.)(0|[1-9]\d*)$/u.exec(version);
  if (!stable) throw new Error("package.json must hold a stable X.Y.Z version to derive a nightly.");
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error("A nightly needs the full commit SHA.");
  const date = new Date(committedAt);
  if (Number.isNaN(date.getTime())) throw new Error("A nightly needs the commit time.");
  const stamp = date.toISOString().replace(/\.\d{3}Z$/u, "").replace(/\D/gu, "");
  return `${stable[1]}${Number(stable[2]) + 1}-nightly.${stamp}.g${sha.slice(0, 7)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const sha = process.env.GITHUB_SHA || git("rev-parse", "HEAD");
  console.log(nightlyVersion(version, git("log", "-1", "--format=%cI", sha), sha));
}
