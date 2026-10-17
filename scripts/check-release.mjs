import { appendFile, readFile } from "node:fs/promises";
import { releaseExists } from "./registry-release.mjs";

const packageJson = JSON.parse(await readFile("package.json"));
const pack = JSON.parse(await readFile("pack-result.json"))[0];
await appendFile(process.env.GITHUB_OUTPUT, "exists=" +
  await releaseExists(packageJson.name, packageJson.version, pack.integrity) + "\n");
