'use strict';

function createMediaPermissionPolicy({
  isTrusted,
  isTrustedFrame = (details) => details?.isMainFrame === true,
  now = () => Date.now(),
  ttlMs = 15_000,
}) {
  if (typeof isTrusted !== 'function') throw new TypeError('isTrusted must be a function.');
  if (typeof isTrustedFrame !== 'function') throw new TypeError('isTrustedFrame must be a function.');
  let armedUntil = 0;

  return Object.freeze({
    arm() {
      armedUntil = now() + ttlMs;
      return { ok: true, expiresAt: new Date(armedUntil).toISOString() };
    },
    canRequest(webContents, permission, details = {}) {
      if (
        permission !== 'media'
        || now() > armedUntil
        || !isTrusted(webContents)
        || !isTrustedFrame(details)
      ) return false;
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      return mediaTypes.includes('audio') && !mediaTypes.includes('video');
    },
    canCheck(webContents, permission, details = {}) {
      return permission === 'media'
        && now() <= armedUntil
        && isTrusted(webContents)
        && isTrustedFrame(details)
        && details.mediaType === 'audio';
    },
  });
}

module.exports = { createMediaPermissionPolicy };
