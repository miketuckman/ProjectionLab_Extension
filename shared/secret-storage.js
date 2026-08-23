/**
 * ProjectionLab API-key storage.
 *
 * The hardened fork keeps the key in chrome.storage.local. loadApiKey performs a
 * one-time migration from the upstream sync-storage location and removes the
 * roaming copy.
 */
(function (global) {
  const KEY = 'plApiKey';

  function requireStorage() {
    if (!global.chrome?.storage?.local || !global.chrome?.storage?.sync) {
      throw new Error('Chrome extension storage is not available.');
    }
    return global.chrome.storage;
  }

  async function loadApiKey() {
    const storage = requireStorage();
    const [local, legacy] = await Promise.all([
      storage.local.get([KEY]),
      storage.sync.get([KEY]),
    ]);
    const localKey = typeof local?.[KEY] === 'string' ? local[KEY] : '';
    const legacyKey = typeof legacy?.[KEY] === 'string' ? legacy[KEY] : '';
    const key = localKey.trim() ? localKey : legacyKey;
    if (!localKey.trim() && key.trim()) await storage.local.set({ [KEY]: key });
    await storage.sync.remove(KEY);
    return key;
  }

  async function saveApiKey(key) {
    const storage = requireStorage();
    await storage.local.set({ [KEY]: key });
    await storage.sync.remove(KEY);
  }

  async function clearApiKey() {
    const storage = requireStorage();
    await Promise.all([storage.local.remove(KEY), storage.sync.remove(KEY)]);
  }

  global.ProjectionLabSecretStorage = { loadApiKey, saveApiKey, clearApiKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);
