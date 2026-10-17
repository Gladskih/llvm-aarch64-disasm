import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseExists } from "../scripts/registry-release.mjs";

test("a missing registry version can be published", async context => {
  context.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://registry.npmjs.org/example/1.0.0");
    return new Response(null, { status: 404 });
  });
  assert.equal(await releaseExists("example", "1.0.0", "sha512-example"), false);
});

test("an identical published tarball is reused", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    dist: { integrity: "sha512-reviewed" },
  }));
  assert.equal(await releaseExists("example", "1.0.0", "sha512-reviewed"), true);
});

test("a different tarball cannot overwrite an existing version", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    dist: { integrity: "sha512-other" },
  }));
  await assert.rejects(releaseExists("example", "1.0.0", "sha512-reviewed"), /immutable npm version/);
});

test("registry failures are never interpreted as a missing version", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await assert.rejects(releaseExists("example", "1.0.0", "sha512-reviewed"), /HTTP 503/);
  context.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(releaseExists("example", "1.0.0", "sha512-reviewed"), /offline/);
});

test("malformed metadata cannot authorize replacing a published version", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response("broken"));
  await assert.rejects(releaseExists("example", "1.0.0", "sha512-reviewed"));
  context.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(releaseExists("example", "1.0.0", "sha512-reviewed"));
});
