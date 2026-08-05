import { access, cp, mkdir, rm } from "node:fs/promises";
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
await mkdir(path.join(stage, "portable"), { recursive: true });
await mkdir(path.join(stage, "data"), { recursive: true });

await cp(portableSource, path.join(stage, "portable", "StudyQuest-win32-x64"), {
  recursive: true,
});

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
