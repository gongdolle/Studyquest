import { cp, mkdir, writeFile } from "node:fs/promises";
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

const appPaths = await packager({
  dir: root,
  name: "StudyQuest",
  executableName: "StudyQuest",
  platform: "win32",
  arch: "x64",
  out,
  overwrite: true,
  prune: true,
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
