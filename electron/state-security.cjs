'use strict';

const FORBIDDEN_STATE_KEYS = new Set([
  'apikey', 'api_key', 'api-key', 'secret', 'clientsecret', 'client_secret',
  'authorization', 'x-api-key', 'ciphertext', 'encryptedkey', 'encrypted_key',
]);

function assertNoCredentialFields(value) {
  const stack = [value];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    visited += 1;
    if (visited > 250_000) throw new TypeError('State contains too many values.');
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/\s+/g, '');
      if (FORBIDDEN_STATE_KEYS.has(normalized)) {
        throw new TypeError('Credentials cannot be stored in learning state.');
      }
      stack.push(child);
    }
  }
}

module.exports = { assertNoCredentialFields };
