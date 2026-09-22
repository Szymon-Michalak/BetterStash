import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionFiles, browserManifest } from "./extension.mjs";

const [browser, destination] = process.argv.slice(2);
if (!destination) throw new Error("Usage: node scripts/stage.mjs chrome|safari <destination>");
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = browserManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")), browser);
const directory = resolve(destination);
if (directory === resolve(root)) throw new Error("Stage into a separate directory.");
await mkdir(directory, { recursive: true });
for (const file of extensionFiles) {
  if (file !== "manifest.json") await copyFile(join(root, file), join(directory, file));
}
await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
