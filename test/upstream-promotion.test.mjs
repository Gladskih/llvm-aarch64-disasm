import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const program = fileURLToPath(new URL("../scripts/promote-upstream.mjs", import.meta.url));
const checker = fileURLToPath(new URL("../scripts/check-upstream.mjs", import.meta.url));
const commit = "2".repeat(40);
const branch = "automation/upstream-" + commit;
async function baseRepository(context) {
  const root = await mkdtemp(join(tmpdir(), "upstream-promotion-"));
  context.after(async () => {
    assert.equal(dirname(await realpath(root)), await realpath(tmpdir()));
    await rm(root, { recursive: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--bare", "remote.git");
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }) + "\n");
  await writeFile(join(root, "package-lock.json"),
    JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.1.0" } } }) + "\n");
  await writeFile(join(root, "upstream.json"), JSON.stringify({
    llvmVersion: "llvmorg-23.1.3", llvmCommit: "1".repeat(40), files: { "llvm/foo.h": "old" },
  }));
  git("add", "package.json", "package-lock.json", "upstream.json");
  git("commit", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", join(root, "remote.git"));
  git("push", "-u", "origin", "main");
  return { root, git, base };
}
async function repository(context) {
  const { root, git, base } = await baseRepository(context);
  git("switch", "-c", branch);
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.2.0" }) + "\n");
  await writeFile(join(root, "package-lock.json"), "new lock\n");
  await writeFile(join(root, "upstream.json"), JSON.stringify({ llvmCommit: commit }));
  git("add", "package.json", "package-lock.json", "upstream.json");
  git("commit", "-m", "Update stable source");
  git("push", "-u", "origin", branch);
  return { root, git, base, sha: git("rev-parse", "HEAD") };
}
async function installGithubCLI(fixture) {
  const bin = join(fixture.root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), `#!/usr/bin/env node
    const fs = require("node:fs"), cp = require("node:child_process");
    const args = process.argv.slice(2);
    fs.appendFileSync("calls.log", JSON.stringify(args) + "\\n");
    if (args[1] === "list") process.stdout.write("[]");
    if (args[1] === "merge") cp.execFileSync("git", ["push", "origin", args[2] + ":main"]);
    if (args[1] === "merge" && fs.existsSync("advance-on-merge")) {
      const git = (...values) => cp.execFileSync("git", values, { encoding: "utf8" }).trim();
      const sha = git("rev-parse", args[2]);
      const moved = git("commit-tree", sha + "^{tree}", "-p", sha, "-m", "Manual work after merge");
      git("push", "origin", moved + ":" + args[2]);
    }
  `, { mode: 0o755 });
  return bin;
}
async function promote(fixture) {
  const bin = await installGithubCLI(fixture);
  return spawnSync(process.execPath, [program], { cwd: fixture.root, encoding: "utf8",
    env: { ...process.env, PATH: bin + delimiter + dirname(process.execPath) + delimiter + process.env.PATH,
      GITHUB_SHA: fixture.sha, GITHUB_REF_NAME: branch, GITHUB_ENV: join(fixture.root, "env") } });
}
test("verified candidates merge, tag and retry without rewriting anything", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  const first = await promote(fixture);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(fixture.git("rev-parse", "origin/main"), fixture.sha);
  assert.equal(fixture.git("rev-parse", "v0.2.0^{}"), fixture.sha);
  const calls = await readFile(join(fixture.root, "calls.log"), "utf8");
  assert.equal(fixture.git("ls-remote", "origin", "refs/heads/" + branch), "");
  const second = await promote(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(join(fixture.root, "calls.log"), "utf8"), calls);
  assert((await readFile(join(fixture.root, "env"), "utf8")).includes("RELEASE_TAG=v0.2.0"));
});
async function check(fixture, mode) {
  const bin = await installGithubCLI(fixture);
  const preload = join(fixture.root, "fetch-fixture.mjs");
  await writeFile(preload, `
    globalThis.fetch = async url => {
      if (url.endsWith("/releases/latest")) return Response.json({ tag_name: "llvmorg-24.1.0" });
      if (url.includes("/commits/")) return Response.json({ sha: "${commit}" });
      if (url.includes("/git/ref/heads/")) return process.env.TEST_MODE === "existing"
        ? Response.json({ ref: "candidate" }) : new Response(null, { status: 404 });
      if (url.startsWith("https://raw.githubusercontent.com/llvm/llvm-project/")) {
        if (process.env.TEST_MODE === "check") throw Error("Check-only must not download sources");
        return new Response("abc");
      }
      throw Error("Unexpected test network request: " + url);
    };
  `);
  return spawnSync(process.execPath, [checker], { cwd: fixture.root, encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--import=" + preload, TEST_MODE: mode,
      PATH: bin + delimiter + dirname(process.execPath) + delimiter + process.env.PATH,
      GH_TOKEN: "test-fixture", GITHUB_REPOSITORY: "example/package",
      GITHUB_OUTPUT: join(fixture.root, "outputs"), UPSTREAM_CHECK_ONLY: mode === "check" ? "true" : "false" } });
}
test("upstream checks commit fresh hashes and dispatch only a new candidate", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await baseRepository(context);
  const result = await check(fixture, "update");
  assert.equal(result.status, 0, result.stderr);
  const pin = JSON.parse(await readFile(join(fixture.root, "upstream.json"), "utf8"));
  assert.equal(pin.llvmVersion, "llvmorg-24.1.0");
  assert.equal(pin.files["llvm/foo.h"],
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(JSON.parse(await readFile(join(fixture.root, "package.json"), "utf8")).version, "0.2.0");
  assert.equal(fixture.git("rev-parse", "origin/" + branch), fixture.git("rev-parse", "HEAD"));
  assert.equal(await readFile(join(fixture.root, "outputs"), "utf8"), "branch=" + branch + "\n");
  fixture.git("switch", "main");
  const repeated = await check(fixture, "existing");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stderr, /Candidate already exists/);
  assert.equal(fixture.git("rev-parse", "HEAD"), fixture.base);
});
test("check-only performs no source downloads, commits or dispatches", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await baseRepository(context);
  const result = await check(fixture, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Check only/);
  assert.equal(fixture.git("rev-parse", "HEAD"), fixture.base);
  await assert.rejects(readFile(join(fixture.root, "outputs")), { code: "ENOENT" });
});
test("a stale base stops promotion before any merge or tag", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  fixture.git("switch", "main");
  await writeFile(join(fixture.root, "new-file"), "Concurrent main change");
  fixture.git("add", "new-file");
  fixture.git("commit", "-m", "Concurrent main change");
  fixture.git("push", "origin", "main");
  fixture.git("switch", branch);
  const result = await promote(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Main changed/);
  assert.equal(fixture.git("tag", "--list"), "");
});
test("an existing conflicting tag fails before changing main", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  fixture.git("tag", "v0.2.0", fixture.base);
  fixture.git("push", "origin", "v0.2.0");
  const result = await promote(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag points elsewhere/);
  assert.equal(fixture.git("rev-parse", "origin/main"), fixture.base);
});
test("a remote candidate that moved after CI cannot be published", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  await writeFile(join(fixture.root, "package-lock.json"), "moved after verification");
  fixture.git("add", "package-lock.json");
  fixture.git("commit", "-m", "Unverified change");
  fixture.git("push", "origin", branch);
  fixture.git("checkout", "--detach", fixture.sha);
  const result = await promote(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate branch changed/);
  assert.equal(fixture.git("tag", "--list"), "");
});

test("an unmerged candidate cannot be promoted after its branch is deleted", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  fixture.git("push", "origin", "--delete", branch);
  const result = await promote(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate branch missing before merge/);
  assert.equal(fixture.git("rev-parse", "origin/main"), fixture.base);
  assert.equal(fixture.git("tag", "--list"), "");
});

test("manual work pushed after merge is preserved during candidate cleanup", {
  skip: process.platform === "win32",
}, async context => {
  const fixture = await repository(context);
  await writeFile(join(fixture.root, "advance-on-merge"), "");
  const result = await promote(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate changed after merge/);
  const remote = fixture.git("ls-remote", "origin", "refs/heads/" + branch).split(/\s+/)[0];
  assert.notEqual(remote, fixture.sha);
  assert.equal(fixture.git("rev-parse", remote + "^"), fixture.sha);
  assert.equal(fixture.git("rev-parse", "v0.2.0^{}"), fixture.sha);
});
