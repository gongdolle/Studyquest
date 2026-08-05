import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { CredentialStore } = require("./credential-store.cjs") as {
  CredentialStore: new (options: { filePath: string; safeStorage: FakeSafeStorage }) => {
    set(input: { provider: string; apiKey: string; model: string }): Promise<{ ok: boolean }>;
    get(provider: string): Promise<{ apiKey: string; model: string }>;
    status(): Promise<{ encryptionAvailable: boolean; providers: Record<string, { configured: boolean; decryptable: boolean; needsReconnect: boolean }> }>;
    remove(provider: string): Promise<{ ok: boolean }>;
  };
};

interface FakeSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(options: { available?: boolean; decryptFails?: boolean } = {}) {
  const testRoot = path.join(process.cwd(), ".tmp", "tests");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "credentials-"));
  directories.push(directory);
  const safeStorage: FakeSafeStorage = {
    isAsyncEncryptionAvailable: async () => options.available !== false,
    encryptStringAsync: async (value) => Buffer.from(`sealed:${Buffer.from(value).toString("base64")}`),
    decryptStringAsync: async (value) => {
      if (options.decryptFails) throw new Error("another Windows user");
      const encoded = value.toString().replace(/^sealed:/, "");
      return { result: Buffer.from(encoded, "base64").toString(), shouldReEncrypt: false };
    },
  };
  const filePath = path.join(directory, "providers.v1.json");
  return { store: new CredentialStore({ filePath, safeStorage }), filePath };
}

describe("CredentialStore", () => {
  it("stores only ciphertext and never returns a secret in status", async () => {
    const { store, filePath } = await fixture();
    const apiKey = "test-openai-secret-123456789";
    await store.set({ provider: "openai", apiKey, model: "gpt-5.6-terra" });

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain(apiKey);
    expect(raw).toContain("ciphertext");
    expect(await store.get("openai")).toEqual({ apiKey, model: "gpt-5.6-terra" });
    expect(JSON.stringify(await store.status())).not.toContain(apiKey);
  });

  it("refuses persistence when OS encryption is unavailable", async () => {
    const { store, filePath } = await fixture({ available: false });
    await expect(store.set({ provider: "deepseek", apiKey: "test-deepseek-secret", model: "deepseek-v4-flash" }))
      .rejects.toThrow("not saved");
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks copied or damaged encrypted credentials for reconnection", async () => {
    const fixtureValue = await fixture();
    await fixtureValue.store.set({ provider: "anthropic", apiKey: "test-anthropic-secret-12345", model: "claude-sonnet-5" });
    const brokenSafeStorage: FakeSafeStorage = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => Buffer.from(value),
      decryptStringAsync: async () => { throw new Error("DPAPI user mismatch"); },
    };
    const copiedStore = new CredentialStore({ filePath: fixtureValue.filePath, safeStorage: brokenSafeStorage });
    const status = await copiedStore.status();
    expect(status.providers.anthropic).toMatchObject({ configured: true, decryptable: false, needsReconnect: true });
  });

  it("removes a provider without affecting other connections", async () => {
    const { store } = await fixture();
    await store.set({ provider: "openai", apiKey: "test-openai-secret-123", model: "gpt-5.6-terra" });
    await store.set({ provider: "deepseek", apiKey: "test-deepseek-secret-123", model: "deepseek-v4-flash" });
    await store.remove("openai");
    const status = await store.status();
    expect(status.providers.openai.configured).toBe(false);
    expect(status.providers.deepseek.decryptable).toBe(true);
  });
});
