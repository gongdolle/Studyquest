import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const releaseRoot = path.join(root, "release");
const stage = path.join(releaseRoot, "StudyQuest");
const portableSource = path.join(root, "portable", "StudyQuest-win32-x64");

if (path.dirname(stage) !== releaseRoot || path.basename(stage) !== "StudyQuest") {
  throw new Error(`Refusing to clear unexpected release path: ${stage}`);
}

await access(portableSource);
await rm(stage, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });
await cp(portableSource, stage, { recursive: true });

// The Electron runtime and StudyQuest both ship a file named LICENSE. Preserve
// the runtime license before placing the project license beside the executable.
await rename(
  path.join(stage, "LICENSE"),
  path.join(stage, "ELECTRON-LICENSE.txt"),
);
await mkdir(path.join(stage, "data"), { recursive: true });

for (const file of [
  "StudyQuest.cmd",
  "README.md",
  "UNINSTALL.txt",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  ".studyquest-root",
]) {
  await cp(path.join(root, file), path.join(stage, file));
}

await cp(path.join(root, "docs"), path.join(stage, "docs"), { recursive: true });

console.log(stage);
