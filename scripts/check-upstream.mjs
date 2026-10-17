import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { github } from "./release-assets.mjs";
import { nextPackageVersion, updatedPin, updateExportedVersion,
  upstreamRelease } from "./upstream-release.mjs";

const pin = JSON.parse(await readFile("upstream.json"));
const release = await upstreamRelease(pin);
if (!release) {
  console.warn("No newer stable upstream release; no build scheduled.");
} else {
  const branch = "automation/upstream-" + release.commit;
  const existing = await github("repos/" + process.env.GITHUB_REPOSITORY +
    "/git/ref/heads/" + branch);
  console.warn("Latest stable upstream: " + release.tag + " (" + release.commit + ")");
  if (existing) console.warn("Candidate already exists; retry it manually after fixing a failed CI.");
  else if (process.env.UPSTREAM_CHECK_ONLY === "true") console.warn("Check only; no changes made.");
  else {
    const next = await updatedPin(pin, release);
    await writeFile("upstream.json", JSON.stringify(next, null, 2) + "\n");
    const wrapper = await readFile("src/index.ts", "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (wrapper) await writeFile("src/index.ts", updateExportedVersion(wrapper, next.llvmVersion));
    const manifest = JSON.parse(await readFile("package.json"));
    manifest.version = nextPackageVersion(manifest.version);
    await writeFile("package.json", JSON.stringify(manifest, null, 2) + "\n");
    const lock = JSON.parse(await readFile("package-lock.json"));
    lock.version = manifest.version;
    lock.packages[""].version = manifest.version;
    await writeFile("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
    execFileSync("git", ["switch", "-c", branch]);
    execFileSync("git", ["add", "upstream.json", "package.json", "package-lock.json"]);
    if (wrapper) execFileSync("git", ["add", "src/index.ts"]);
    execFileSync("git", ["commit", "-m", "Update upstream to " + release.tag], { stdio: "inherit" });
    execFileSync("git", ["push", "origin", branch], { stdio: "inherit" });
    execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch,
      "--title", "Update upstream to " + release.tag, "--body",
      "Automated stable upstream update. The publish workflow must pass the full CI gate before merge or publication."],
    { stdio: "inherit" });
    await appendFile(process.env.GITHUB_OUTPUT, "branch=" + branch + "\n");
  }
}
