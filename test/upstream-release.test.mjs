import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, downloadHash, nextPackageVersion, sourceRepository, updatedPin,
  updateExportedVersion, upstreamRelease } from "../scripts/upstream-release.mjs";

const before = "1".repeat(40);
const after = "2".repeat(40);
const llvmPin = { llvmVersion: "llvmorg-23.1.3", llvmCommit: before };
function mockRelease(context, status, tag = "llvmorg-24.1.0") {
  context.mock.method(globalThis, "fetch", async url => {
    if (url.endsWith("/releases/latest")) return Response.json({ tag_name: tag });
    if (url.includes("/commits/")) return Response.json({ sha: after });
    assert(url.includes("/compare/" + before + "..." + after));
    return Response.json({ status });
  });
}
test("source pins select the three supported upstream repositories", () => {
  assert.equal(sourceRepository({ llvmCommit: before }), "llvm/llvm-project");
  assert.equal(sourceRepository({ xedCommit: before }), "intelxed/xed");
  assert.equal(sourceRepository({ repository: "https://github.com/icedland/iced.git" }), "icedland/iced");
  assert.throws(() => sourceRepository({ repository: "https://unrelated.example" }));
});
test("stable major LLVM releases on different release branches remain eligible", async context => {
  mockRelease(context, "diverged");
  assert.deepEqual(await upstreamRelease(llvmPin), {
    repository: "llvm/llvm-project", tag: "llvmorg-24.1.0", commit: after,
  });
});
test("newer commit pins are never downgraded to an older stable release", async context => {
  mockRelease(context, "behind", "v1.21.0");
  assert.equal(await upstreamRelease({ repository: "https://github.com/icedland/iced.git",
    commit: before }), null);
  mockRelease(context, "ahead");
  assert.equal(await upstreamRelease({ ...llvmPin, llvmCommit: after }), null);
  mockRelease(context, "ahead", "llvmorg-22.1.8");
  assert.equal(await upstreamRelease(llvmPin), null);
});
test("preview tags, invalid commits and divergent histories stop the update", async context => {
  mockRelease(context, "ahead", "llvmorg-24.1.0-rc1");
  await assert.rejects(upstreamRelease(llvmPin), /stable release tag/);
  mockRelease(context, "diverged", "v1.22.0");
  await assert.rejects(upstreamRelease({ repository: "https://github.com/icedland/iced.git",
    commit: before }), /diverges/);
  context.mock.method(globalThis, "fetch", async () => Response.json({ prerelease: true }));
  await assert.rejects(upstreamRelease(llvmPin), /not stable/);
  context.mock.method(globalThis, "fetch", async url => Response.json(url.endsWith("/latest")
    ? { tag_name: "llvmorg-24.1.0" } : { sha: "not-a-commit" }));
  await assert.rejects(upstreamRelease(llvmPin), /Invalid upstream commit/);
});
test("missing release and failed comparisons do not schedule builds", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  await assert.rejects(upstreamRelease(llvmPin), /no stable GitHub release/);
  context.mock.method(globalThis, "fetch", async url => url.endsWith("/latest")
    ? Response.json({ tag_name: "v1.22.0" }) : url.includes("/commits/")
      ? Response.json({ sha: after }) : new Response(null, { status: 404 }));
  await assert.rejects(upstreamRelease({ repository: "https://github.com/icedland/iced.git",
    commit: before }), /Cannot compare/);
});
test("stable version ordering handles LLVM and calendar versions and rejects retags", async context => {
  assert(compareVersions("llvmorg-24.1.0", "23.1.3") > 0);
  assert(compareVersions("v2026.10.01", "2026.08.23") > 0);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.throws(() => compareVersions("1.0.0-rc1", "1.0.0"), /Invalid stable version/);
  assert.throws(() => compareVersions("99999999999999999.0.0", "1.0.0"), /precision/);
  mockRelease(context, "ahead", "llvmorg-23.1.3");
  await assert.rejects(upstreamRelease(llvmPin), /already pinned release tag/);
});
test("LLVM archives and individual files receive freshly computed checksums", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response("abc"));
  const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const release = { tag: "llvmorg-24.1.0", commit: after };
  assert.deepEqual(await updatedPin({ llvmCommit: before, emscriptenVersion: "4.0.23" }, release),
    { llvmCommit: after, llvmVersion: "24.1.0", emscriptenVersion: "4.0.23",
      llvmArchiveSha256: digest });
  assert.deepEqual(await updatedPin({ llvmCommit: before, files: { "llvm/a.h": "old" } }, release),
    { llvmCommit: after, llvmVersion: "llvmorg-24.1.0", files: { "llvm/a.h": digest } });
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await assert.rejects(downloadHash("https://example.invalid"), /HTTP 503/);
});
test("XED and iced updates preserve independent toolchain pins", async () => {
  assert.deepEqual(await updatedPin({ xedCommit: before, mbuildCommit: "fixed" },
    { tag: "v2026.10.01", commit: after }), {
    xedCommit: after, xedVersion: "2026.10.01", mbuildCommit: "fixed",
  });
  assert.deepEqual(await updatedPin({ commit: before, wasmPackVersion: "0.14.0" },
    { tag: "v1.22.0", commit: after }), { commit: after, wasmPackVersion: "0.14.0" });
});
test("upstream upgrades reserve a new npm compatibility line", () => {
  assert.equal(nextPackageVersion("0.2.7"), "0.3.0");
  assert.equal(nextPackageVersion("1.2.7"), "2.0.0");
  assert.throws(() => nextPackageVersion("0.2.0-rc.1"), /stable npm package version/);
});
test("the ARM exported LLVM version follows its updated source pin", () => {
  assert.equal(updateExportedVersion("export const llvmVersion = '21.1.8';\n", "23.1.3"),
    `export const llvmVersion = "23.1.3";\n`);
  assert.throws(() => updateExportedVersion("changed upstream wrapper", "23.1.3"), /declaration changed/);
});
