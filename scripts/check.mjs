import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { extensionFiles } from "./extension.mjs";

const publicRuntimeFiles = extensionFiles;
const privateFragments = ["team-icon.png"];

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageJSON = JSON.parse(await readFile("package.json", "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest.json must use Manifest V3.");
if (manifest.version !== packageJSON.version) {
  throw new Error("manifest.json and package.json versions must match.");
}
if (manifest.host_permissions || manifest.content_scripts) {
  throw new Error("Site access must remain optional and dynamically registered.");
}
if (!manifest.optional_host_permissions?.includes("https://*/*")) {
  throw new Error("manifest.json must declare optional HTTPS host access.");
}

for (const file of extensionFiles.filter((file) => file.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const file of publicRuntimeFiles) {
  const contents = await readFile(file, "utf8");
  for (const fragment of privateFragments) {
    if (contents.includes(fragment)) {
      throw new Error(`${file} contains private or bundled-branding data: ${fragment}`);
    }
  }
}

console.log(`Validated BetterStash v${manifest.version}.`);
