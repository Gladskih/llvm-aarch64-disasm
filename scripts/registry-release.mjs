import assert from "node:assert/strict";

/** Existing versions are immutable: only an identical tested tarball may be reused. */
export async function releaseExists(name, version, integrity) {
  const response = await fetch("https://registry.npmjs.org/" + encodeURIComponent(name) +
    "/" + encodeURIComponent(version));
  if (response.status === 404) return false;
  assert(response.ok, "Registry unavailable: HTTP " + response.status);
  assert.equal((await response.json()).dist.integrity, integrity,
    "An immutable npm version already exists with different contents");
  return true;
}
