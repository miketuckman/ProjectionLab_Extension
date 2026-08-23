import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const selected = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.prototype.hasOwnProperty.call(data, key)) selected[key] = data[key];
      }
      return selected;
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

async function loadHelper(filePath, local, sync) {
  const context = vm.createContext({ chrome: { storage: { local, sync } } });
  vm.runInContext(await fs.readFile(filePath, 'utf8'), context, { filename: filePath });
  return context;
}

test('migrates mappings and API keys from roaming sync storage to local storage', async () => {
  const local = storageArea();
  const sync = storageArea({
    accountMappingsStorage: { chunkCount: 2 },
    'accountMappingsChunk.0': [{ plId: 'one' }],
    'accountMappingsChunk.1': [{ plId: 'two' }],
    plApiKey: 'synthetic-key',
  });
  const context = await loadHelper('shared/mapping-storage.js', local, sync);
  vm.runInContext(await fs.readFile('shared/secret-storage.js', 'utf8'), context, {
    filename: 'shared/secret-storage.js',
  });

  assert.deepEqual(
    structuredClone(await context.ChrysalisMappingStorage.loadMappings()),
    [{ plId: 'one' }, { plId: 'two' }],
  );
  assert.equal(await context.ProjectionLabSecretStorage.loadApiKey(), 'synthetic-key');
  assert.deepEqual(local.data.accountMappings, [{ plId: 'one' }, { plId: 'two' }]);
  assert.equal(local.data.plApiKey, 'synthetic-key');
  assert.deepEqual(sync.data, {});
});
