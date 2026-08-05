import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { defaultDataRoot, loadPortableConfig, savePortableConfig } = require("./portable-config.cjs") as {
  defaultDataRoot(portableRoot: string): string;
  loadPortableConfig(portableRoot: string, env?: NodeJS.ProcessEnv): PortableConfig;
  savePortableConfig(
    portableRoot: string,
    input: {
      dataRoot?: string | null;
      cliPaths?: { codex?: string | null; claude?: string | null } | null;
      [key: string]: unknown;
    },
    env?: NodeJS.ProcessEnv,
  ): Promise<PortableConfig>;
};

interface PortableConfig {
  dataRoot: string;
  dataRootIsDefault: boolean;
  cliPaths: { codex: string | null; claude: string | null };
  configPath: string;
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const testRoot = path.join(process.cwd(), ".tmp", "tests");
  await mkdir(testRoot, { recursive: true });
  const portableRoot = await mkdtemp(path.join(testRoot, "portable-config-"));
  directories.push(portableRoot);
  return {
    portableRoot,
    configPath: path.join(portableRoot, "studyquest.portable.json"),
  };
}

async function executable(directory: string, name: string) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, "test executable", "utf8");
  return filePath;
}

describe("portable config", () => {
  it("uses the portable data directory when the config is absent", async () => {
    const { portableRoot, configPath } = await fixture();
    expect(defaultDataRoot(portableRoot)).toBe(path.join(portableRoot, "data"));
    expect(loadPortableConfig(portableRoot, {})).toEqual({
      dataRoot: path.join(portableRoot, "data"),
      dataRootIsDefault: true,
      cliPaths: { codex: null, claude: null },
      configPath,
    });
  });

  it("atomically saves and reloads only normalized allowlisted fields", async () => {
    const { portableRoot, configPath } = await fixture();
    const codex = await executable(portableRoot, "codex.exe");
    const claude = await executable(portableRoot, "claude.com");
    const dataRoot = path.join(portableRoot, "external-data");

    const saved = await savePortableConfig(portableRoot, {
      dataRoot,
      cliPaths: { codex, claude, ignored: "value" } as never,
      theme: "dark",
    }, {});

    expect(saved).toEqual({
      dataRoot,
      dataRootIsDefault: false,
      cliPaths: { codex, claude },
      configPath,
    });
    expect(loadPortableConfig(portableRoot, {})).toEqual(saved);

    const persisted = JSON.parse(await readFile(configPath, "utf8"));
    expect(persisted).toEqual({ dataRoot, cliPaths: { codex, claude } });
    expect(JSON.stringify(persisted)).not.toContain("theme");
    expect(await readdir(portableRoot)).not.toContainEqual(expect.stringMatching(/^\.studyquest\.portable\.json\..+\.tmp$/));
  });

  it("stores null for the movable default data directory", async () => {
    const { portableRoot, configPath } = await fixture();
    const saved = await savePortableConfig(portableRoot, { dataRoot: null, cliPaths: null }, {});
    expect(saved.dataRoot).toBe(path.join(portableRoot, "data"));
    expect(saved.dataRootIsDefault).toBe(true);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      dataRoot: null,
      cliPaths: { codex: null, claude: null },
    });
  });

  it("falls back safely for malformed, oversized, or non-object files", async () => {
    const { portableRoot, configPath } = await fixture();
    const expected = loadPortableConfig(portableRoot, {});

    for (const content of ["not json", "[]", JSON.stringify({ padding: "x".repeat(70 * 1024) })]) {
      await writeFile(configPath, content, "utf8");
      expect(loadPortableConfig(portableRoot, {})).toEqual(expected);
    }
  });

  it("requires an absolute non-system data directory", async () => {
    const { portableRoot } = await fixture();
    const fakeWindows = path.join(portableRoot, "os", "Windows");
    const fakeProgramFiles = path.join(portableRoot, "os", "Program Files");
    const env = { SystemRoot: fakeWindows, ProgramFiles: fakeProgramFiles };

    await expect(savePortableConfig(portableRoot, { dataRoot: "relative-data" }, env))
      .rejects.toThrow("absolute path");
    await expect(savePortableConfig(portableRoot, { dataRoot: path.parse(portableRoot).root }, env))
      .rejects.toThrow("filesystem root");
    await expect(savePortableConfig(portableRoot, { dataRoot: path.join(fakeWindows, "StudyQuest") }, env))
      .rejects.toThrow("system directory");
    await expect(savePortableConfig(portableRoot, { dataRoot: path.join(fakeProgramFiles, "StudyQuest") }, env))
      .rejects.toThrow("system directory");
  });

  it("uses the default data directory when a loaded override is unsafe", async () => {
    const { portableRoot, configPath } = await fixture();
    const fakeWindows = path.join(portableRoot, "os", "Windows");
    await writeFile(configPath, JSON.stringify({ dataRoot: path.join(fakeWindows, "StudyQuest") }), "utf8");

    const loaded = loadPortableConfig(portableRoot, { SystemRoot: fakeWindows });
    expect(loaded.dataRoot).toBe(path.join(portableRoot, "data"));
    expect(loaded.dataRootIsDefault).toBe(true);
  });

  it("accepts only existing regular .exe or .com CLI overrides", async () => {
    const { portableRoot, configPath } = await fixture();
    const commandFile = await executable(portableRoot, "codex.cmd");
    const executableDirectory = path.join(portableRoot, "claude.exe");
    await mkdir(executableDirectory);

    await expect(savePortableConfig(portableRoot, { cliPaths: { codex: "codex.exe" } }, {}))
      .rejects.toThrow("absolute path");
    await expect(savePortableConfig(portableRoot, { cliPaths: { codex: commandFile } }, {}))
      .rejects.toThrow(".exe or .com");
    await expect(savePortableConfig(portableRoot, { cliPaths: { codex: path.join(portableRoot, "missing.exe") } }, {}))
      .rejects.toThrow("existing regular file");
    await expect(savePortableConfig(portableRoot, { cliPaths: { claude: executableDirectory } }, {}))
      .rejects.toThrow("existing regular file");

    await writeFile(configPath, JSON.stringify({
      cliPaths: { codex: commandFile, claude: path.join(portableRoot, "missing.exe") },
    }), "utf8");
    expect(loadPortableConfig(portableRoot, {}).cliPaths).toEqual({ codex: null, claude: null });
  });

  it("ignores harmless unknown fields but refuses secret-bearing config", async () => {
    const { portableRoot, configPath } = await fixture();
    const dataRoot = path.join(portableRoot, "learning-data");
    await writeFile(configPath, JSON.stringify({ dataRoot, futureOption: { enabled: true } }), "utf8");
    expect(loadPortableConfig(portableRoot, {}).dataRoot).toBe(dataRoot);

    await expect(savePortableConfig(portableRoot, {
      dataRoot,
      futureOption: { authToken: "must-not-be-written" },
    }, {})).rejects.toThrow("Secrets cannot be stored");

    await writeFile(configPath, JSON.stringify({ dataRoot, metadata: { access_token: "secret" } }), "utf8");
    const loaded = loadPortableConfig(portableRoot, {});
    expect(loaded.dataRoot).toBe(path.join(portableRoot, "data"));
    expect(loaded.cliPaths).toEqual({ codex: null, claude: null });
  });

  it("rejects a relative portable root", () => {
    expect(() => defaultDataRoot("relative-root")).toThrow("absolute path");
    expect(() => loadPortableConfig("relative-root", {})).toThrow("absolute path");
  });
});
