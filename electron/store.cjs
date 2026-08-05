'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 80;
const MAX_NODES = 250_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value) {
  let visitedNodes = 0;
  const ancestors = new Set();

  function visit(current, depth) {
    visitedNodes += 1;
    if (visitedNodes > MAX_NODES) {
      throw new TypeError('State contains too many values.');
    }
    if (depth > MAX_DEPTH) {
      throw new TypeError('State is nested too deeply.');
    }

    if (
      current === null ||
      current === undefined ||
      typeof current === 'string' ||
      typeof current === 'boolean'
    ) {
      return;
    }

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new TypeError('State numbers must be finite.');
      }
      return;
    }

    if (typeof current !== 'object') {
      throw new TypeError(`State contains a non-JSON value: ${typeof current}.`);
    }

    if (ancestors.has(current)) {
      throw new TypeError('State must not contain circular references.');
    }
    ancestors.add(current);

    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
    } else {
      if (!isPlainObject(current)) {
        throw new TypeError('State objects must use a plain object prototype.');
      }
      for (const [key, child] of Object.entries(current)) {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new TypeError(`State contains a forbidden key: ${key}.`);
        }
        visit(child, depth + 1);
      }
    }

    ancestors.delete(current);
  }

  visit(value, 0);
}

function serializeState(value, maxBytes) {
  if (!isPlainObject(value)) {
    throw new TypeError('State must be a JSON object.');
  }
  assertJsonValue(value);

  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > maxBytes) {
    throw new RangeError(`State exceeds the ${maxBytes}-byte storage limit.`);
  }
  return serialized;
}

async function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EACCES', 'EPERM', 'EBUSY'].includes(error?.code) || attempt === 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}

class AtomicJsonStore {
  constructor(filePath, options = {}) {
    if (!path.isAbsolute(filePath)) {
      throw new TypeError('AtomicJsonStore requires an absolute file path.');
    }

    this.filePath = path.resolve(filePath);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async load() {
    return this.enqueue(async () => {
      let handle;
      try {
        handle = await fs.promises.open(this.filePath, 'r');
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }

      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw new Error('State path is not a regular file.');
        if (stats.size > this.maxBytes) {
          throw new RangeError(`Stored state exceeds the ${this.maxBytes}-byte limit.`);
        }

        const raw = await handle.readFile({ encoding: 'utf8' });
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          throw new TypeError('Stored state must be a JSON object.');
        }
        assertJsonValue(parsed);
        return parsed;
      } finally {
        await handle.close();
      }
    });
  }

  async save(value) {
    const serialized = serializeState(value, this.maxBytes);

    return this.enqueue(async () => {
      const directory = path.dirname(this.filePath);
      await fs.promises.mkdir(directory, { recursive: true });

      const temporaryPath = path.join(
        directory,
        `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      );

      let handle;
      try {
        handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(serialized, { encoding: 'utf8' });
        await handle.sync();
        await handle.close();
        handle = null;

        await renameWithRetry(temporaryPath, this.filePath);
        return { ok: true };
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await fs.promises.unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    });
  }

  async preserveForRecovery() {
    return this.enqueue(async () => {
      let stats;
      try {
        stats = await fs.promises.lstat(this.filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, backupPath: null };
        throw error;
      }
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('State path is not a physical file and cannot be backed up safely.');
      }
      const backupPath = `${this.filePath}.recovery-${Date.now()}-${crypto.randomUUID()}.bak`;
      await renameWithRetry(this.filePath, backupPath);
      return { ok: true, backupPath };
    });
  }
}

function createJsonStore(filePath, options) {
  return new AtomicJsonStore(filePath, options);
}

module.exports = {
  AtomicJsonStore,
  createJsonStore,
};
