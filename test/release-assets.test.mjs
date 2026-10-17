import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assetDigest, github, releaseCommands } from "../scripts/release-assets.mjs";

const files = [{ path: "package.tgz", name: "package.tgz", digest: "sha256:reviewed" }];
test("new releases upload assets before publication without replacing files", async () => {
  assert.deepEqual(await releaseCommands(null, "v1.0.0", files), [
    ["release", "create", "v1.0.0", "package.tgz", "--verify-tag", "--generate-notes"],
  ]);
});
test("an identical immutable release is an idempotent no-op", async () => {
  assert.deepEqual(await releaseCommands({ tag_name: "v1.0.0", immutable: true,
    assets: [{ name: "package.tgz", digest: "sha256:reviewed" }] }, "v1.0.0", files), []);
});
test("published mismatches and missing files fail without any mutation", async () => {
  await assert.rejects(releaseCommands({ tag_name: "v1.0.0", assets: [
    { name: "package.tgz", digest: "sha256:changed" }] }, "v1.0.0", files), /differs/);
  await assert.rejects(releaseCommands({ tag_name: "v1.0.0", assets: [] },
    "v1.0.0", files), /missing required assets/);
  await assert.rejects(releaseCommands({ tag_name: "v2.0.0", assets: [] },
    "v1.0.0", files), /Unexpected release tag/);
});
test("interrupted drafts add only missing files then publish", async () => {
  assert.deepEqual(await releaseCommands({ tag_name: "v1.0.0", draft: true, assets: [] },
    "v1.0.0", files), [["release", "upload", "v1.0.0", "package.tgz"],
    ["release", "edit", "v1.0.0", "--draft=false"]]);
  assert.deepEqual(await releaseCommands({ tag_name: "v1.0.0", draft: true,
    assets: [{ name: "package.tgz", digest: "sha256:reviewed" }] }, "v1.0.0", files),
  [["release", "edit", "v1.0.0", "--draft=false"]]);
});
test("legacy assets without digests are downloaded and hashed", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response("archive"));
  assert.equal(await assetDigest({ url: "https://api.github.com/assets/1" }),
    "sha256:" + createHash("sha256").update("archive").digest("hex"));
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(assetDigest({ url: "https://api.github.com/assets/1" }), /HTTP 403/);
});
test("GitHub errors are distinguished from an absent release", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  assert.equal(await github("repos/example/releases/tags/v1"), null);
  context.mock.method(globalThis, "fetch", async () => Response.json({ id: 1 }));
  assert.deepEqual(await github("repos/example/releases/tags/v1"), { id: 1 });
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  await assert.rejects(github("repos/example/releases/tags/v1"), /HTTP 500/);
});
