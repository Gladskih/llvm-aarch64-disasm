import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function github(path) {
  const response = await fetch("https://api.github.com/" + path, {
    headers: { Authorization: "Bearer " + process.env.GH_TOKEN,
      Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  });
  if (response.status === 404) return null;
  assert(response.ok, "GitHub request failed: HTTP " + response.status);
  return response.json();
}

export async function assetDigest(asset) {
  if (asset.digest) return asset.digest;
  const response = await fetch(asset.url, { headers: {
    Authorization: "Bearer " + process.env.GH_TOKEN, Accept: "application/octet-stream",
  } });
  assert(response.ok, "Asset download failed: HTTP " + response.status);
  const hash = createHash("sha256");
  for await (const chunk of response.body) hash.update(chunk);
  return "sha256:" + hash.digest("hex");
}

export async function releaseCommands(release, tag, files) {
  if (!release) return [["release", "create", tag, ...files.map(file => file.path),
    "--verify-tag", "--generate-notes"]];
  assert.equal(release.tag_name, tag, "Unexpected release tag");
  const missing = [];
  for (const file of files) {
    const asset = release.assets.find(candidate => candidate.name === file.name);
    if (asset) assert.equal(await assetDigest(asset), file.digest,
      "Published asset differs: " + file.name);
    else missing.push(file.path);
  }
  if (!release.draft) {
    assert.equal(missing.length, 0, "Published release is missing required assets");
    return [];
  }
  const commands = missing.length ? [["release", "upload", tag, ...missing]] : [];
  return [...commands, ["release", "edit", tag, "--draft=false"]];
}
