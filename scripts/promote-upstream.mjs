import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { nextPackageVersion } from "./upstream-release.mjs";

const run = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const branch = process.env.GITHUB_REF_NAME;
assert(/^automation\/upstream-[a-f0-9]{40}$/.test(branch), "Unexpected upstream candidate branch");
const sha = run("rev-parse", "HEAD");
assert.equal(sha, process.env.GITHUB_SHA, "Candidate moved after verification");
run("fetch", "origin", "main");
const candidate = run("ls-remote", "origin", "refs/heads/" + branch);
if (candidate) assert.equal(candidate.split(/\s+/)[0], sha, "Candidate branch changed");
const base = run("rev-parse", "HEAD^");
const changed = run("diff", "--name-only", base, sha).split("\n").sort();
assert(changed.every(path => ["package-lock.json", "package.json", "upstream.json",
  "src/index.ts"].includes(path)) && ["package-lock.json", "package.json", "upstream.json"]
  .every(path => changed.includes(path)), "Unexpected candidate files");
const tag = "v" + JSON.parse(await readFile("package.json")).version;
const oldVersion = JSON.parse(run("show", base + ":package.json")).version;
assert.equal(tag, "v" + nextPackageVersion(oldVersion), "Unexpected candidate package version");
const pin = JSON.parse(await readFile("upstream.json"));
assert.equal(branch.slice("automation/upstream-".length), pin.llvmCommit ?? pin.xedCommit ?? pin.commit,
  "Candidate branch and upstream pin differ");
const remote = run("ls-remote", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}");
if (remote) {
  const refs = remote.split("\n").map(line => line.split(/\s+/));
  assert.equal((refs.find(ref => ref[1].endsWith("^{}")) ?? refs[0])[0], sha,
    "Release tag points elsewhere");
}
const merged = execFileSync("git", ["merge-base", sha, "origin/main"],
  { encoding: "utf8" }).trim() === sha;
if (!merged) {
  assert(candidate, "Candidate branch missing before merge");
  assert.equal(run("rev-parse", "origin/main"), base, "Main changed; rebase and recheck the candidate");
  const existing = JSON.parse(execFileSync("gh", ["pr", "list", "--head", branch,
    "--state", "open", "--json", "number"], { encoding: "utf8" }));
  if (!existing.length) execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch,
    "--title", "Update upstream for " + tag, "--body",
    "Pinned stable upstream update. Full package CI passed before automatic merge and publication."],
  { stdio: "inherit" });
  execFileSync("gh", ["pr", "merge", branch, "--merge", "--match-head-commit", sha],
    { stdio: "inherit" });
}
if (!remote) {
  run("tag", "-a", tag, sha, "-m", "Release " + tag);
  execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
}
await appendFile(process.env.GITHUB_ENV, "RELEASE_TAG=" + tag + "\n");
