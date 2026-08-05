'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API_PROVIDERS = new Set(['openai', 'anthropic', 'deepseek']);
const DEFAULT_MODELS = Object.freeze({
  openai: 'gpt-5.6-terra',
  anthropic: 'claude-sonnet-5',
  deepseek: 'deepseek-v4-flash',
});
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SECRET_CHARS = 4_096;

function assertProvider(provider) {
  if (!API_PROVIDERS.has(provider)) throw new TypeError('Unsupported API provider.');
  return provider;
}

function validateModel(provider, value) {
  const model = String(value ?? DEFAULT_MODELS[provider]).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model)) {
    throw new TypeError('Model name is invalid.');
  }
  return model;
}

function validateSecret(value) {
  if (typeof value !== 'string') throw new TypeError('API key must be a string.');
  const secret = value.trim();
  if (secret.length < 8 || secret.length > MAX_SECRET_CHARS || /[\s\u0000-\u001f\u007f]/.test(secret)) {
    throw new TypeError('API key format is invalid.');
  }
  return secret;
}

function emptyVault() {
  return { version: 1, providers: {} };
}

async function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EACCES', 'EPERM', 'EBUSY'].includes(error?.code) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}

class CredentialStore {
  constructor({ filePath, safeStorage }) {
    if (!path.isAbsolute(filePath)) throw new TypeError('CredentialStore requires an absolute path.');
    if (!safeStorage) throw new TypeError('CredentialStore requires Electron safeStorage.');
    this.filePath = path.resolve(filePath);
    this.safeStorage = safeStorage;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async encryptionAvailable() {
    try {
      return Boolean(await this.safeStorage.isAsyncEncryptionAvailable());
    } catch {
      return false;
    }
  }

  async loadRaw() {
    let handle;
    try {
      handle = await fs.promises.open(this.filePath, 'r');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyVault();
      throw error;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES) throw new Error('Credential file is invalid.');
      const parsed = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      if (parsed?.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object') {
        throw new Error('Credential file format is invalid.');
      }
      return parsed;
    } finally {
      await handle.close();
    }
  }

  async writeRaw(vault) {
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const serialized = `${JSON.stringify(vault, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      throw new RangeError('Credential file is too large.');
    }
    let handle;
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await renameWithRetry(temporaryPath, this.filePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async decryptEntry(entry) {
    if (!entry || typeof entry.ciphertext !== 'string' || entry.ciphertext.length > MAX_FILE_BYTES) {
      throw new Error('Stored credential is damaged.');
    }
    const encrypted = Buffer.from(entry.ciphertext, 'base64');
    if (!encrypted.length) throw new Error('Stored credential is damaged.');
    const decrypted = await this.safeStorage.decryptStringAsync(encrypted);
    const secret = typeof decrypted === 'string' ? decrypted : decrypted?.result;
    if (typeof secret !== 'string' || !secret) throw new Error('Stored credential cannot be decrypted.');
    return { secret, shouldReEncrypt: Boolean(decrypted?.shouldReEncrypt) };
  }

  async status() {
    return this.enqueue(async () => {
      const encryptionAvailable = await this.encryptionAvailable();
      let vault;
      try {
        vault = await this.loadRaw();
      } catch {
        vault = emptyVault();
      }
      const providers = {};
      for (const provider of API_PROVIDERS) {
        const entry = vault.providers[provider];
        let model = DEFAULT_MODELS[provider];
        let metadataDamaged = false;
        try {
          model = validateModel(provider, entry?.model);
        } catch {
          metadataDamaged = true;
        }
        const base = {
          configured: Boolean(entry),
          decryptable: false,
          needsReconnect: metadataDamaged,
          model,
          updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : undefined,
          verifiedAt: typeof entry?.verifiedAt === 'string' ? entry.verifiedAt : undefined,
        };
        if (!entry) {
          providers[provider] = base;
          continue;
        }
        if (!encryptionAvailable) {
          providers[provider] = { ...base, needsReconnect: true };
          continue;
        }
        try {
          await this.decryptEntry(entry);
          providers[provider] = metadataDamaged
            ? base
            : { ...base, decryptable: true };
        } catch {
          providers[provider] = { ...base, needsReconnect: true };
        }
      }
      return { encryptionAvailable, providers };
    });
  }

  async set({ provider, apiKey, model }) {
    provider = assertProvider(provider);
    const secret = validateSecret(apiKey);
    const selectedModel = validateModel(provider, model);
    return this.enqueue(async () => {
      if (!(await this.encryptionAvailable())) {
        throw new Error('Windows credential encryption is unavailable. The API key was not saved.');
      }
      const encrypted = await this.safeStorage.encryptStringAsync(secret);
      const vault = await this.loadRaw();
      vault.providers[provider] = {
        ciphertext: Buffer.from(encrypted).toString('base64'),
        model: selectedModel,
        updatedAt: new Date().toISOString(),
      };
      await this.writeRaw(vault);
      return { ok: true, provider, model: selectedModel };
    });
  }

  async get(provider) {
    provider = assertProvider(provider);
    return this.enqueue(async () => {
      if (!(await this.encryptionAvailable())) throw new Error('Credential encryption is unavailable.');
      const vault = await this.loadRaw();
      const entry = vault.providers[provider];
      if (!entry) throw new Error(`${provider} API key is not configured.`);
      const decrypted = await this.decryptEntry(entry);
      if (decrypted.shouldReEncrypt) {
        const encrypted = await this.safeStorage.encryptStringAsync(decrypted.secret);
        entry.ciphertext = Buffer.from(encrypted).toString('base64');
        entry.updatedAt = new Date().toISOString();
        await this.writeRaw(vault);
      }
      return { apiKey: decrypted.secret, model: validateModel(provider, entry.model) };
    });
  }

  async markVerified(provider) {
    provider = assertProvider(provider);
    return this.enqueue(async () => {
      const vault = await this.loadRaw();
      if (!vault.providers[provider]) return { ok: false };
      vault.providers[provider].verifiedAt = new Date().toISOString();
      await this.writeRaw(vault);
      return { ok: true, verifiedAt: vault.providers[provider].verifiedAt };
    });
  }

  async remove(provider) {
    provider = assertProvider(provider);
    return this.enqueue(async () => {
      const vault = await this.loadRaw();
      if (vault.providers[provider]) {
        delete vault.providers[provider];
        await this.writeRaw(vault);
      }
      return { ok: true };
    });
  }
}

module.exports = {
  API_PROVIDERS,
  CredentialStore,
  DEFAULT_MODELS,
  assertProvider,
  validateModel,
  validateSecret,
};
