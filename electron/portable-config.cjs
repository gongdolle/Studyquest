'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG_FILE_NAME = 'studyquest.portable.json';
const MAX_CONFIG_BYTES = 64 * 1024;
const CLI_IDS = Object.freeze(['codex', 'claude']);
const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'bearer',
  'ciphertext',
  'clientsecret',
  'credential',
  'credentials',
  'encryptedkey',
  'password',
  'refreshtoken',
  'secret',
  'token',
  'accesstoken',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSecretFieldName(value) {
  const normalized = normalizeFieldName(value);
  return (
    SECRET_FIELD_NAMES.has(normalized) ||
    normalized.includes('apikey') ||
    normalized.includes('authorization') ||
    normalized.includes('credential') ||
    normalized.includes('ciphertext') ||
    normalized.includes('privatekey') ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'secret' ||
    normalized.startsWith('secret') ||
    normalized.endsWith('secret') ||
    normalized === 'password' ||
    normalized.endsWith('password')
  );
}

function assertNoSecretFields(value) {
  const stack = [value];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    visited += 1;
    if (visited > 20_000) throw new TypeError('Portable config contains too many values.');
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (isSecretFieldName(key)) {
        throw new TypeError('Secrets cannot be stored in the portable config.');
      }
      stack.push(child);
    }
  }
}

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value.trim())) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  return path.resolve(value.trim());
}

function resolveExistingPrefix(candidate) {
  let current = candidate;
  const missingSegments = [];
  while (true) {
    try {
      const existing = fs.realpathSync.native?.(current) ?? fs.realpathSync(current);
      return path.resolve(existing, ...missingSegments.reverse());
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current || !['ENOENT', 'ENOTDIR'].includes(error?.code)) return candidate;
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

function isPathRoot(candidate) {
  return path.parse(candidate).root === candidate;
}

function isWithinOrEqual(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function environmentValues(env, names) {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  const values = [];
  for (const [key, value] of Object.entries(env && typeof env === 'object' ? env : {})) {
    if (wanted.has(key.toUpperCase()) && typeof value === 'string' && value.trim()) values.push(value.trim());
  }
  return values;
}

function protectedSystemDirectories(candidate, env) {
  const filesystemRoot = path.parse(candidate).root;
  const directories = [
    path.join(filesystemRoot, 'Windows'),
    path.join(filesystemRoot, 'Program Files'),
    path.join(filesystemRoot, 'Program Files (x86)'),
    path.join(filesystemRoot, 'ProgramData'),
    ...environmentValues(env, ['SystemRoot', 'WINDIR']),
    ...environmentValues(env, ['ProgramFiles', 'ProgramW6432']),
    ...environmentValues(env, ['ProgramFiles(x86)']),
    ...environmentValues(env, ['ProgramData', 'ALLUSERSPROFILE']),
  ];

  return directories
    .filter((directory) => typeof directory === 'string' && path.isAbsolute(directory))
    .map((directory) => path.resolve(directory));
}

function validateDataRoot(value, portableRoot, env) {
  const candidate = requireAbsolutePath(value, 'dataRoot');
  const fallback = defaultDataRoot(portableRoot);
  if (isWithinOrEqual(candidate, fallback) && isWithinOrEqual(fallback, candidate)) return fallback;
  if (isPathRoot(candidate)) throw new TypeError('dataRoot cannot be a filesystem root.');

  const physicalCandidate = resolveExistingPrefix(candidate);
  for (const protectedDirectory of protectedSystemDirectories(candidate, env)) {
    const physicalProtectedDirectory = resolveExistingPrefix(protectedDirectory);
    if (
      isWithinOrEqual(candidate, protectedDirectory) ||
      isWithinOrEqual(physicalCandidate, physicalProtectedDirectory)
    ) {
      throw new TypeError('dataRoot cannot be inside a Windows system directory.');
    }
  }
  return candidate;
}

function validateCliPath(value, id) {
  const candidate = requireAbsolutePath(value, `cliPaths.${id}`);
  if (!/\.(?:exe|com)$/i.test(candidate)) {
    throw new TypeError(`cliPaths.${id} must point to an .exe or .com file.`);
  }
  let stats;
  try {
    stats = fs.statSync(candidate);
  } catch {
    throw new TypeError(`cliPaths.${id} must point to an existing regular file.`);
  }
  if (!stats.isFile()) {
    throw new TypeError(`cliPaths.${id} must point to an existing regular file.`);
  }
  return fs.realpathSync.native?.(candidate) ?? fs.realpathSync(candidate);
}

function defaultDataRoot(portableRoot) {
  const root = requireAbsolutePath(portableRoot, 'portableRoot');
  return path.join(root, 'data');
}

function configPathFor(portableRoot) {
  const root = requireAbsolutePath(portableRoot, 'portableRoot');
  return path.join(root, CONFIG_FILE_NAME);
}

function defaultResult(portableRoot) {
  return {
    dataRoot: defaultDataRoot(portableRoot),
    dataRootIsDefault: true,
    cliPaths: { codex: null, claude: null },
    configPath: configPathFor(portableRoot),
  };
}

function normalizeLoadedConfig(parsed, portableRoot, env) {
  if (!isPlainObject(parsed)) throw new TypeError('Portable config must be a JSON object.');
  assertNoSecretFields(parsed);
  const result = defaultResult(portableRoot);

  if (parsed.dataRoot !== undefined && parsed.dataRoot !== null) {
    try {
      result.dataRoot = validateDataRoot(parsed.dataRoot, portableRoot, env);
      result.dataRootIsDefault = result.dataRoot === defaultDataRoot(portableRoot);
    } catch {
      result.dataRoot = defaultDataRoot(portableRoot);
      result.dataRootIsDefault = true;
    }
  }

  if (isPlainObject(parsed.cliPaths)) {
    for (const id of CLI_IDS) {
      if (parsed.cliPaths[id] === undefined || parsed.cliPaths[id] === null) continue;
      try {
        result.cliPaths[id] = validateCliPath(parsed.cliPaths[id], id);
      } catch {
        result.cliPaths[id] = null;
      }
    }
  }
  return result;
}

function loadPortableConfig(portableRoot, env = process.env) {
  const fallback = defaultResult(portableRoot);
  try {
    const stats = fs.statSync(fallback.configPath);
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) return fallback;
    const parsed = JSON.parse(fs.readFileSync(fallback.configPath, 'utf8'));
    return normalizeLoadedConfig(parsed, portableRoot, env);
  } catch {
    return fallback;
  }
}

function normalizeSaveInput(input, portableRoot, env) {
  if (!isPlainObject(input)) throw new TypeError('Portable config input must be an object.');
  assertNoSecretFields(input);
  const fallback = defaultDataRoot(portableRoot);
  const result = defaultResult(portableRoot);

  if (input.dataRoot !== undefined && input.dataRoot !== null) {
    result.dataRoot = validateDataRoot(input.dataRoot, portableRoot, env);
    result.dataRootIsDefault = result.dataRoot === fallback;
  }

  if (input.cliPaths !== undefined && input.cliPaths !== null) {
    if (!isPlainObject(input.cliPaths)) throw new TypeError('cliPaths must be an object.');
    for (const id of CLI_IDS) {
      if (input.cliPaths[id] !== undefined && input.cliPaths[id] !== null) {
        result.cliPaths[id] = validateCliPath(input.cliPaths[id], id);
      }
    }
  }
  return result;
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

async function atomicWriteConfig(configPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES) {
    throw new RangeError('Portable config is too large.');
  }
  const directory = path.dirname(configPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(configPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await renameWithRetry(temporaryPath, configPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function savePortableConfig(portableRoot, input, env = process.env) {
  const normalized = normalizeSaveInput(input, portableRoot, env);
  const persisted = {
    dataRoot: normalized.dataRootIsDefault ? null : normalized.dataRoot,
    cliPaths: {
      codex: normalized.cliPaths.codex,
      claude: normalized.cliPaths.claude,
    },
  };
  await atomicWriteConfig(normalized.configPath, persisted);
  return normalized;
}

module.exports = {
  loadPortableConfig,
  savePortableConfig,
  defaultDataRoot,
};
