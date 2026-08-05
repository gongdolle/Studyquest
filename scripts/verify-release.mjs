import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const stage = path.join(root, "release", "StudyQuest");
const archiveRoot = "StudyQuest";
const maxArchiveEntryLength = 180;

async function physicalType(candidate, expected) {
  const stats = await lstat(candidate);
  if (stats.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${candidate}`);
  if (expected === "file" && !stats.isFile()) throw new Error(`Expected release file: ${candidate}`);
  if (expected === "directory" && !stats.isDirectory()) {
    throw new Error(`Expected release directory: ${candidate}`);
  }
}

async function collectFiles(directory, relativeDirectory = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${absolutePath}`);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Release contains an unsupported filesystem entry: ${absolutePath}`);
    }
  }
  return files;
}

for (const relativePath of [
  "StudyQuest.exe",
  "StudyQuest.cmd",
  "README.md",
  "LICENSE",
  "ELECTRON-LICENSE.txt",
  path.join("resources", "app.asar"),
  path.join("resources", "studyquest-schemas", "interview.schema.json"),
  path.join(
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  ),
  path.join(
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex-code-mode-host.exe",
  ),
  path.join(
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex-path",
    "rg.exe",
  ),
  path.join(
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex-resources",
    "codex-command-runner.exe",
  ),
  path.join(
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex-resources",
    "codex-windows-sandbox-setup.exe",
  ),
]) {
  await physicalType(path.join(stage, relativePath), "file");
}
await physicalType(path.join(stage, "data"), "directory");

const [projectLicense, stagedProjectLicense, electronLicense, stagedElectronLicense] = await Promise.all([
  readFile(path.join(root, "LICENSE")),
  readFile(path.join(stage, "LICENSE")),
  readFile(path.join(root, "portable", "StudyQuest-win32-x64", "LICENSE")),
  readFile(path.join(stage, "ELECTRON-LICENSE.txt")),
]);
if (!projectLicense.equals(stagedProjectLicense)) {
  throw new Error("Staged StudyQuest license does not match the project license.");
}
if (!electronLicense.equals(stagedElectronLicense)) {
  throw new Error("Staged Electron runtime license was not preserved.");
}

const files = await collectFiles(stage);
const dataFiles = files.filter((relativePath) => relativePath.startsWith(`data${path.sep}`));
if (dataFiles.length) throw new Error(`Release data directory is not empty: ${dataFiles.join(", ")}`);

const legacyApp = path.join("portable", "StudyQuest-win32-x64", "StudyQuest.exe");
if (files.includes(legacyApp)) throw new Error(`Release still contains the legacy nested app: ${legacyApp}`);

const nestedCodexSegment = [
  "node_modules",
  "@openai",
  "codex",
  "node_modules",
  "@openai",
  "codex-win32",
].join(path.sep).toLowerCase();
const nestedCodexFile = files.find((relativePath) => relativePath.toLowerCase().includes(nestedCodexSegment));
if (nestedCodexFile) throw new Error(`Codex native package is still nested: ${nestedCodexFile}`);

const measured = files
  .map((relativePath) => {
    const archivePath = path.posix.join(archiveRoot, ...relativePath.split(path.sep));
    return { archivePath, length: archivePath.length };
  })
  .sort((left, right) => right.length - left.length);
const longest = measured[0];
if (!longest) throw new Error("Release contains no files.");
if (longest.length > maxArchiveEntryLength) {
  throw new Error(
    `Release ZIP path is too long (${longest.length} > ${maxArchiveEntryLength}): ${longest.archivePath}`,
  );
}

console.log(`Verified ${files.length} release files.`);
console.log(`Longest ZIP entry (${longest.length} chars): ${longest.archivePath}`);
