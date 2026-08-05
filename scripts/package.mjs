import { cp, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const out = path.join(root, "portable");
const tempRoot = path.join(root, ".tmp", "packager");
const electronCache = path.join(root, ".cache", "electron");

await mkdir(out, { recursive: true });
await mkdir(tempRoot, { recursive: true });
await mkdir(electronCache, { recursive: true });
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
process.env.ELECTRON_CACHE = electronCache;

async function directoryState(candidate) {
  try {
    const stats = await lstat(candidate);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Expected a physical directory: ${candidate}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function rehomeCodexNativePackage({ buildPath, platform, arch }) {
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`Unsupported StudyQuest package target: ${platform}-${arch}`);
  }

  const packageName = "codex-win32-x64";
  const nested = path.join(
    buildPath,
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    packageName,
  );
  const hoisted = path.join(buildPath, "node_modules", "@openai", packageName);
  const [hasNested, hasHoisted] = await Promise.all([
    directoryState(nested),
    directoryState(hoisted),
  ]);

  if (hasNested === hasHoisted) {
    throw new Error(
      `Expected exactly one Codex native package before packaging (nested=${hasNested}, hoisted=${hasHoisted}).`,
    );
  }
  if (hasNested) await rename(nested, hoisted);

  const packageJson = JSON.parse(await readFile(path.join(hoisted, "package.json"), "utf8"));
  if (packageJson.name !== "@openai/codex" || packageJson.version !== "0.146.0-win32-x64") {
    throw new Error("Unexpected Codex native package identity.");
  }

  for (const relativePath of [
    path.join("vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    path.join("vendor", "x86_64-pc-windows-msvc", "bin", "codex-code-mode-host.exe"),
    path.join("vendor", "x86_64-pc-windows-msvc", "codex-path", "rg.exe"),
    path.join(
      "vendor",
      "x86_64-pc-windows-msvc",
      "codex-resources",
      "codex-command-runner.exe",
    ),
    path.join(
      "vendor",
      "x86_64-pc-windows-msvc",
      "codex-resources",
      "codex-windows-sandbox-setup.exe",
    ),
  ]) {
    const stats = await lstat(path.join(hoisted, relativePath));
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Codex native resource is not a physical file: ${relativePath}`);
    }
  }
}

const appPaths = await packager({
  dir: root,
  name: "StudyQuest",
  executableName: "StudyQuest",
  platform: "win32",
  arch: "x64",
  out,
  overwrite: true,
  prune: true,
  afterPrune: [rehomeCodexNativePackage],
  asar: { unpack: "**/{.**,**}/**/*.exe" },
  ignore: [
    /^\/(?:\.cache|\.tmp|\.config|\.npm-global|\.github|data|docs|portable|release|src|scripts)(?:\/|$)/,
    /^\/node_modules\/\.(?:bin|vite[^/]*)(?:\/|$)/,
    /^\/studyquest\.portable\.json$/,
    /^\/(?:tsconfig\.json|vite\.config\.ts)(?:$)/,
    /(?:\.test\.(?:ts|tsx)|\.map)$/,
  ],
});

for (const appPath of appPaths) {
  await mkdir(path.join(appPath, "data"), { recursive: true });
  await cp(
    path.join(root, "schemas"),
    path.join(appPath, "resources", "studyquest-schemas"),
    { recursive: true },
  );
  await writeFile(path.join(appPath, ".studyquest-root"), "portable-root\n", "utf8");
  await writeFile(
    path.join(appPath, "삭제 안내.txt"),
    "StudyQuest는 포터블 앱입니다. 앱을 종료한 뒤 이 폴더를 삭제하면 앱과 앱이 만든 데이터가 함께 제거됩니다. 레지스트리, 시작프로그램, Program Files를 사용하지 않습니다.\r\n",
    "utf8",
  );
  await flipFuses(path.join(appPath, "StudyQuest.exe"), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}

console.log(appPaths.join("\n"));
