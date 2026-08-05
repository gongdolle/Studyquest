import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createJsonStore } = require("./store.cjs") as {
  createJsonStore(filePath: string): {
    save(value: object): Promise<{ ok: boolean }>;
    preserveForRecovery(): Promise<{ ok: boolean; backupPath: string | null }>;
  };
};

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomic state recovery", () => {
  it("moves the current state to a unique backup before a user-approved reset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "studyquest-store-"));
    temporaryRoots.push(root);
    const statePath = path.join(root, "state", "studyquest.json");
    const store = createJsonStore(statePath);
    await store.save({ subjects: [{ id: "keep-me" }] });

    const result = await store.preserveForRecovery();

    expect(result.ok).toBe(true);
    expect(result.backupPath).toMatch(/studyquest\.json\.recovery-\d+-[0-9a-f-]+\.bak$/i);
    await expect(readFile(result.backupPath!, "utf8")).resolves.toContain("keep-me");
    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is a safe no-op when no state file exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "studyquest-store-"));
    temporaryRoots.push(root);
    const store = createJsonStore(path.join(root, "state", "studyquest.json"));

    await expect(store.preserveForRecovery()).resolves.toEqual({ ok: true, backupPath: null });
  });
});
