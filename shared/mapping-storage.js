/**
 * Account-mapping storage.
 *
 * Mappings contain sensitive account metadata, so the hardened fork stores them
 * only in chrome.storage.local. The first read migrates the original Chrysalis
 * sync-storage formats and then removes those roaming copies.
 */
(function (global) {
  const LOCAL_KEY = 'accountMappings';
  const LEGACY_META_KEY = 'accountMappingsStorage';
  const LEGACY_CHUNK_PREFIX = 'accountMappingsChunk.';

  function requireStorage() {
    if (!global.chrome?.storage?.local || !global.chrome?.storage?.sync) {
      throw new Error('Chrome extension storage is not available.');
    }
    return {
      local: global.chrome.storage.local,
      sync: global.chrome.storage.sync,
    };
  }

  async function loadLegacySyncMappings(syncStorage) {
    const stored = await syncStorage.get([LOCAL_KEY, LEGACY_META_KEY]);
    const direct = Array.isArray(stored?.[LOCAL_KEY]) ? stored[LOCAL_KEY] : [];
    const meta = stored?.[LEGACY_META_KEY];
    if (!meta || !Number.isInteger(meta.chunkCount) || meta.chunkCount <= 0) {
      return { mappings: direct, cleanupKeys: [LOCAL_KEY, LEGACY_META_KEY] };
    }

    const chunkKeys = Array.from(
      { length: meta.chunkCount },
      (_, index) => `${LEGACY_CHUNK_PREFIX}${index}`,
    );
    const chunks = await syncStorage.get(chunkKeys);
    const mappings = [];
    for (const key of chunkKeys) {
      if (!Array.isArray(chunks?.[key])) {
        if (direct.length > 0) {
          return {
            mappings: direct,
            cleanupKeys: [LOCAL_KEY, LEGACY_META_KEY, ...chunkKeys],
          };
        }
        throw new Error(
          'Saved account mappings are incomplete. Restore the mapping backup before syncing.',
        );
      }
      mappings.push(...chunks[key]);
    }
    return {
      mappings,
      cleanupKeys: [LOCAL_KEY, LEGACY_META_KEY, ...chunkKeys],
    };
  }

  async function cleanupLegacySyncMappings(syncStorage) {
    const stored = await syncStorage.get([LEGACY_META_KEY]);
    const chunkCount = stored?.[LEGACY_META_KEY]?.chunkCount;
    const chunkKeys =
      Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= 1000
        ? Array.from(
            { length: chunkCount },
            (_, index) => `${LEGACY_CHUNK_PREFIX}${index}`,
          )
        : [];
    await syncStorage.remove([LOCAL_KEY, LEGACY_META_KEY, ...chunkKeys]);
  }

  async function loadMappings() {
    const storage = requireStorage();
    const localStored = await storage.local.get([LOCAL_KEY]);
    if (Array.isArray(localStored?.[LOCAL_KEY])) {
      await cleanupLegacySyncMappings(storage.sync);
      return localStored[LOCAL_KEY];
    }

    const legacy = await loadLegacySyncMappings(storage.sync);
    await storage.local.set({ [LOCAL_KEY]: legacy.mappings });
    await storage.sync.remove(legacy.cleanupKeys);
    return legacy.mappings;
  }

  async function saveMappings(mappings) {
    const values = Array.isArray(mappings) ? mappings : [];
    const storage = requireStorage();
    await storage.local.set({ [LOCAL_KEY]: values });
    await cleanupLegacySyncMappings(storage.sync);
  }

  global.ChrysalisMappingStorage = {
    LEGACY_KEY: LOCAL_KEY,
    META_KEY: LEGACY_META_KEY,
    CHUNK_PREFIX: LEGACY_CHUNK_PREFIX,
    loadMappings,
    saveMappings,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
