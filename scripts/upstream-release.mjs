import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { github } from "./release-assets.mjs";

export function sourceRepository(pin) {
  if (pin.llvmCommit) return "llvm/llvm-project";
  if (pin.xedCommit) return "intelxed/xed";
  assert.equal(pin.repository, "https://github.com/icedland/iced.git");
  return "icedland/iced";
}

export async function upstreamRelease(pin) {
  const repository = sourceRepository(pin);
  const release = await github("repos/" + repository + "/releases/latest");
  assert(release, "Upstream has no stable GitHub release");
  assert(!release.draft && !release.prerelease, "Upstream release is not stable");
  const pattern = pin.llvmCommit ? /^llvmorg-\d+\.\d+\.\d+$/ : /^v\d+\.\d+\.\d+$/;
  assert(pattern.test(release.tag_name), "Unrecognized stable release tag");
  const commit = await github("repos/" + repository + "/commits/" + release.tag_name);
  assert(commit && /^[a-f0-9]{40}$/.test(commit.sha), "Invalid upstream commit");
  const previous = pin.llvmCommit ?? pin.xedCommit ?? pin.commit;
  if (previous === commit.sha) return null;
  const version = pin.llvmVersion ?? pin.xedVersion;
  if (version) {
    const order = compareVersions(release.tag_name, version);
    if (order < 0) return null;
    assert(order > 0, "Upstream changed an already pinned release tag");
    return { repository, tag: release.tag_name, commit: commit.sha };
  }
  const comparison = await github("repos/" + repository + "/compare/" + previous + "..." + commit.sha);
  assert(comparison, "Cannot compare upstream revisions");
  if (comparison.status === "behind" || comparison.status === "identical") return null;
  assert.equal(comparison.status, "ahead", "Stable release diverges from the pinned revision");
  return { repository, tag: release.tag_name, commit: commit.sha };
}

export function compareVersions(left, right) {
  const parse = value => {
    const numeric = value.replace(/^(llvmorg-|v)/, "");
    assert(/^\d+\.\d+\.\d+$/.test(numeric), "Invalid stable version");
    const parts = numeric.split(".").map(Number);
    assert(parts.every(Number.isSafeInteger), "Version component exceeds integer precision");
    return parts;
  };
  const a = parse(left), b = parse(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export async function downloadHash(url) {
  const response = await fetch(url);
  assert(response.ok, "Upstream download failed: HTTP " + response.status);
  const hash = createHash("sha256");
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest("hex");
}

export async function updatedPin(pin, release) {
  if (pin.llvmCommit) {
    const next = { ...pin, llvmVersion: pin.files ? release.tag : release.tag.slice(8),
      llvmCommit: release.commit };
    if (pin.files) {
      next.files = {};
      for (const path of Object.keys(pin.files)) next.files[path] = await downloadHash(
        "https://raw.githubusercontent.com/llvm/llvm-project/" + release.commit + "/" + path);
    } else next.llvmArchiveSha256 = await downloadHash(
      "https://codeload.github.com/llvm/llvm-project/tar.gz/" + release.commit);
    return next;
  }
  if (pin.xedCommit) return { ...pin, xedVersion: release.tag.slice(1), xedCommit: release.commit };
  return { ...pin, commit: release.commit };
}

export function nextPackageVersion(version) {
  assert(/^\d+\.\d+\.\d+$/.test(version), "Expected a stable npm package version");
  const [major, minor] = version.split(".").map(Number);
  return major === 0 ? "0." + (minor + 1) + ".0" : (major + 1) + ".0.0";
}

export function updateExportedVersion(source, version) {
  const declaration = /export const llvmVersion = ['"][0-9.]+['"];/;
  assert(declaration.test(source), "LLVM version declaration changed");
  return source.replace(declaration, "export const llvmVersion = " + JSON.stringify(version) + ";");
}
