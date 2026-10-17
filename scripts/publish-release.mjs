import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { github, releaseCommands } from "./release-assets.mjs";

const pack = JSON.parse(await readFile("pack-result.json"))[0];
const tag = "v" + JSON.parse(await readFile("package.json")).version;
const paths = [pack.filename, "package.sha256", ...process.argv.slice(2)];
const files = [];
for (const path of paths) files.push({ path, name: basename(path),
  digest: "sha256:" + createHash("sha256").update(await readFile(path)).digest("hex") });
const release = await github("repos/" + process.env.GITHUB_REPOSITORY +
  "/releases/tags/" + encodeURIComponent(tag));
for (const command of await releaseCommands(release, tag, files)) {
  execFileSync("gh", command, { stdio: "inherit" });
}
console.warn("Release assets verified: " + tag);
