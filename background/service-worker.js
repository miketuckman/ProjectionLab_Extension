/**
 * Background service worker for the local ProjectionLab MCP bridge.
 * Reads logged-in browser state and permits writes only through the guarded
 * snapshot, preview, explicit-confirmation, and verification workflow.
 */

import '../shared/mapping-storage.js';
import '../shared/secret-storage.js';
import {
  BALANCE_PREVIEW_TTL_MS,
  buildBalancePreview,
  extractProjectionLabAccounts,
  hashProjectionLabExport,
  hashProjectionLabState,
  normalizeMappings as normalizeBalanceMappings,
} from '../shared/balance-sync.js';
import { startNativeBridge } from './native-bridge.js';

// ProjectionLab origins. By default Chrysalis only uses the standard app.*
// instance. Early Access users opt in via the setup toggle
// (chrome.storage.sync.plUseEarlyAccess), which makes ea.* the preferred origin
// with app.* kept as a fallback. ALL_PL_ORIGINS is the full set, used only to
// recognize a PL URL regardless of the user's preference.
const APP_PL_ORIGIN = 'https://app.projectionlab.com';
const EA_PL_ORIGIN = 'https://ea.projectionlab.com';
const ALL_PL_ORIGINS = [EA_PL_ORIGIN, APP_PL_ORIGIN];
async function getPlOrigins() {
  const { plUseEarlyAccess } = await chrome.storage.sync.get(['plUseEarlyAccess']);
  return plUseEarlyAccess ? [EA_PL_ORIGIN, APP_PL_ORIGIN] : [APP_PL_ORIGIN];
}
const MONARCH_ORIGIN = 'https://app.monarch.com';
function plOriginForUrl(url) {
  return ALL_PL_ORIGINS.find((o) => typeof url === 'string' && url.startsWith(o)) || null;
}

async function findPLTab() {
  const origins = await getPlOrigins();
  const tabs = await chrome.tabs.query({ url: origins.map((o) => o + '/*') });
  if (!tabs.length) return null;
  const originIndex = (url) => {
    const idx = origins.findIndex((o) => typeof url === 'string' && url.startsWith(o));
    return idx === -1 ? origins.length : idx;
  };
  const prefer = (t) => t.url && !t.url.includes('/docs') && !t.url.includes('/settings');
  // Primary sort: preferred-origin order (ea.* before app.* when Early Access is
  // enabled). Secondary: most recently accessed.
  const sorted = [...tabs].sort((a, b) => {
    const ai = originIndex(a.url);
    const bi = originIndex(b.url);
    if (ai !== bi) return ai - bi;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  const main = sorted.find(prefer) || sorted[0];
  if (!main) return null;
  const origin = plOriginForUrl(main.url) || origins[0];
  return { tab: main, origin };
}

async function findMonarchTab() {
  const tabs = await chrome.tabs.query({ url: MONARCH_ORIGIN + '/*' });
  if (!tabs.length) return null;
  const sorted = [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return sorted[0] || null;
}

/**
 * Run updateAccount in the page context. Each update has { plId, data }.
 * Returns array of { plId, success, error }.
 */
async function runPLUpdatesInTab(plTabId, updatesWithPayload, apiKey) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: plTabId },
    world: 'MAIN',
    func: async (updatesJson, key) => {
      const updates = JSON.parse(updatesJson);
      const out = [];
      const updateFn = window.projectionlabPluginAPI && window.projectionlabPluginAPI.updateAccount;
      for (const u of updates) {
        try {
          if (typeof updateFn !== 'function') {
            out.push({ plId: u.plId, success: false, error: 'Plugin API or updateAccount not available' });
            continue;
          }
          const data = u.data;
          // PL validates accountId strictly. EA returns numeric IDs for at
          // least some categories, so coerce defensively.
          const accountId = String(u.plId);
          await updateFn.call(window.projectionlabPluginAPI, accountId, data, { key });
          out.push({ plId: u.plId, success: true });
        } catch (e) {
          out.push({ plId: u.plId, success: false, error: e.message || String(e) });
        }
      }
      try {
        const toast = document.createElement('div');
        toast.id = 'monarch-pl-sync-toast';
        toast.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#181c27;color:#34d58e;border:1px solid #34d58e;padding:12px 16px;border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        toast.textContent = 'Chrysalis ran • ' + out.filter(function(r){ return r.success; }).length + '/' + updates.length + ' updated';
        document.body.appendChild(toast);
        setTimeout(function() { try { toast.remove(); } catch(_){} }, 5000);
      } catch (_) {}
      return out;
    },
    args: [JSON.stringify(updatesWithPayload), apiKey],
  });
  const payload = results && results[0] && results[0].result;
  return Array.isArray(payload) ? payload : [];
}

const MCP_PREVIEWS_KEY = 'mcpBalancePreviews';

async function exportProjectionLabFromTab(tabId, apiKey) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (key) => {
      const api = window.projectionlabPluginAPI;
      if (!api || typeof api.exportData !== 'function') {
        return { error: 'ProjectionLab Plugin API is unavailable in the open tab.' };
      }
      try {
        return { data: await api.exportData({ key }) };
      } catch (error) {
        return { error: error.message || String(error) };
      }
    },
    args: [apiKey],
  });
  const payload = results?.[0]?.result;
  if (!payload) throw new Error('ProjectionLab did not return an export.');
  if (payload.error) throw new Error(payload.error);
  return payload.data;
}

async function requireProjectionLabContext() {
  const [plApiKey, found] = await Promise.all([
    globalThis.ProjectionLabSecretStorage.loadApiKey(),
    findPLTab(),
  ]);
  if (!plApiKey || !plApiKey.trim()) {
    throw new Error('ProjectionLab API key is not configured in local extension storage.');
  }
  if (!found?.tab?.id) {
    throw new Error('Open a signed-in ProjectionLab plan or dashboard tab before using MCP tools.');
  }
  return { apiKey: plApiKey, tab: found.tab, origin: found.origin };
}

function projectionLabSummary(exportData) {
  return {
    accountCount: extractProjectionLabAccounts(exportData).length,
    planCount: Array.isArray(exportData?.plans) ? exportData.plans.length : 0,
    hasProgress: exportData?.progress != null,
    hasSettings: exportData?.settings != null,
  };
}

async function createProjectionLabSnapshot() {
  const context = await requireProjectionLabContext();
  const data = await exportProjectionLabFromTab(context.tab.id, context.apiKey);
  const hash = await hashProjectionLabExport(data);
  return {
    data,
    hash,
    createdAt: new Date().toISOString(),
    summary: projectionLabSummary(data),
  };
}

async function fetchMonarchBalancesForMappings(mappings) {
  const monarchTab = await findMonarchTab();
  if (!monarchTab?.id) {
    throw new Error('Open a signed-in app.monarch.com tab before previewing a balance sync.');
  }
  const accountIds = [
    ...new Set(
      mappings.flatMap((mapping) => [
        ...(mapping.monarchAccounts || []).map((account) => String(account.id)),
        ...(mapping.monarchAccountsLoan || []).map((account) => String(account.id)),
      ]),
    ),
  ];
  await chrome.scripting.executeScript({
    target: { tabId: monarchTab.id },
    files: ['content-scripts/monarch.js'],
  });
  const response = await chrome.tabs.sendMessage(monarchTab.id, {
    type: 'FETCH_BALANCES',
    accountIds,
  });
  if (!response?.success) {
    throw new Error(response?.error || 'Monarch balance retrieval failed.');
  }
  return response.accounts || [];
}

async function saveMcpPreview(preview) {
  const stored = await chrome.storage.local.get([MCP_PREVIEWS_KEY]);
  const previews = stored[MCP_PREVIEWS_KEY] || {};
  const now = Date.now();
  for (const [id, value] of Object.entries(previews)) {
    if (!value?.expiresAt || Date.parse(value.expiresAt) <= now) delete previews[id];
  }
  previews[preview.previewId] = preview;
  await chrome.storage.local.set({ [MCP_PREVIEWS_KEY]: previews });
}

async function createMcpBalancePreview() {
  const mappings = normalizeBalanceMappings(
    await globalThis.ChrysalisMappingStorage.loadMappings(),
  );
  const [snapshot, monarchAccounts] = await Promise.all([
    createProjectionLabSnapshot(),
    fetchMonarchBalancesForMappings(mappings),
  ]);
  const preview = buildBalancePreview({
    mappings,
    monarchAccounts,
    projectionLabExport: snapshot.data,
  });
  const createdAtMs = Date.now();
  const storedPreview = {
    previewId: crypto.randomUUID(),
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + BALANCE_PREVIEW_TTL_MS).toISOString(),
    stateHash: await hashProjectionLabState(snapshot.data),
    updates: preview.updates,
    changes: preview.changes,
  };
  await saveMcpPreview(storedPreview);
  return {
    previewId: storedPreview.previewId,
    createdAt: storedPreview.createdAt,
    expiresAt: storedPreview.expiresAt,
    snapshot,
    stateHash: storedPreview.stateHash,
    summary: {
      mappedAccountCount: preview.mappedAccountCount,
      changedAccountCount: preview.changedAccountCount,
      unchangedAccountCount: preview.unchangedAccountCount,
    },
    changes: preview.changes,
  };
}

async function applyMcpBalancePreview(params) {
  if (params.confirmation !== 'APPLY BALANCE SYNC') {
    throw new Error('Exact confirmation phrase is required.');
  }
  const stored = await chrome.storage.local.get([MCP_PREVIEWS_KEY]);
  const previews = stored[MCP_PREVIEWS_KEY] || {};
  const preview = previews[params.previewId];
  if (!preview) throw new Error(`Unknown balance-sync preview: ${params.previewId}`);
  if (!/^[a-f0-9]{64}$/.test(preview.stateHash || '')) {
    throw new Error('The balance-sync preview has no valid ProjectionLab state hash.');
  }
  if (Date.now() > Date.parse(preview.expiresAt)) {
    throw new Error('The balance-sync preview expired. Create and review a new preview.');
  }
  if (params.expectedStateHash !== preview.stateHash) {
    throw new Error('The supplied ProjectionLab state hash does not belong to this preview.');
  }
  for (const update of preview.updates) {
    const fields = Object.keys(update.data || {});
    if (fields.length === 0 || fields.some((field) => !['balance', 'amount'].includes(field))) {
      throw new Error(`Preview ${preview.previewId} contains a non-allowlisted field.`);
    }
    for (const value of Object.values(update.data)) {
      if (!Number.isFinite(Number(value))) {
        throw new Error(`Preview ${preview.previewId} contains a non-numeric value.`);
      }
    }
  }

  const context = await requireProjectionLabContext();
  const before = await exportProjectionLabFromTab(context.tab.id, context.apiKey);
  const beforeHash = await hashProjectionLabExport(before);
  const beforeStateHash = await hashProjectionLabState(before);
  if (beforeStateHash !== preview.stateHash) {
    throw new Error(
      'ProjectionLab changed after the preview. No writes were made; create and review a new preview.',
    );
  }

  delete previews[params.previewId];
  await chrome.storage.local.set({ [MCP_PREVIEWS_KEY]: previews });
  const receiptId = crypto.randomUUID();
  const appliedAt = new Date().toISOString();
  let updateResults;
  try {
    updateResults = await runPLUpdatesInTab(
      context.tab.id,
      preview.updates,
      context.apiKey,
    );
  } catch (error) {
    return {
      receiptId,
      appliedAt,
      success: false,
      outcomeRequiresManualVerification: true,
      error: `ProjectionLab write execution did not return a result: ${error.message || String(error)}`,
      beforeHash,
      beforeStateHash,
      afterHash: null,
      afterStateHash: null,
      results: preview.updates.map((update) => ({
        projectionLabAccountId: String(update.plId),
        projectionLabAccountName: update.plName,
        fields: Object.keys(update.data),
        success: false,
        error: 'Write outcome is unknown; verify ProjectionLab against the rollback snapshot.',
      })),
      verification: [],
    };
  }
  const resultById = new Map(updateResults.map((result) => [String(result.plId), result]));
  const results = preview.updates.map((update) => {
    const result = resultById.get(String(update.plId));
    return {
      projectionLabAccountId: String(update.plId),
      projectionLabAccountName: update.plName,
      fields: Object.keys(update.data),
      success: result?.success === true,
      error: result?.success ? undefined : result?.error || 'ProjectionLab returned no result.',
    };
  });

  let after;
  try {
    after = await exportProjectionLabFromTab(context.tab.id, context.apiKey);
  } catch (error) {
    return {
      receiptId,
      appliedAt,
      success: false,
      outcomeRequiresManualVerification: true,
      error: `Writes returned results, but ProjectionLab verification failed: ${error.message || String(error)}`,
      beforeHash,
      beforeStateHash,
      afterHash: null,
      afterStateHash: null,
      results,
      verification: [],
    };
  }
  const afterHash = await hashProjectionLabExport(after);
  const afterStateHash = await hashProjectionLabState(after);
  const afterById = new Map(
    extractProjectionLabAccounts(after).map((account) => [account.id, account.account]),
  );
  const verification = preview.changes.map((change) => {
    const account = afterById.get(String(change.projectionLabAccountId));
    const actualValue = account?.[change.field];
    return {
      projectionLabAccountId: String(change.projectionLabAccountId),
      projectionLabAccountName: change.projectionLabAccountName,
      field: change.field,
      expectedValue: change.proposedValue,
      actualValue,
      verified: Number(actualValue) === Number(change.proposedValue),
    };
  });
  const success =
    results.every((result) => result.success) &&
    verification.every((result) => result.verified);
  return {
    receiptId,
    appliedAt,
    success,
    beforeHash,
    afterHash,
    beforeStateHash,
    afterStateHash,
    results,
    verification,
  };
}

async function mcpBridgeStatus() {
  const [plApiKey, mappings, projectionLab, monarch] = await Promise.all([
    globalThis.ProjectionLabSecretStorage.loadApiKey(),
    globalThis.ChrysalisMappingStorage.loadMappings(),
    findPLTab(),
    findMonarchTab(),
  ]);
  return {
    extensionConnected: true,
    apiKeyConfigured: Boolean(plApiKey?.trim()),
    mappingCount: normalizeBalanceMappings(mappings).filter((mapping) => mapping.plId).length,
    projectionLabTabOpen: Boolean(projectionLab?.tab?.id),
    projectionLabOrigin: projectionLab?.origin || null,
    monarchTabOpen: Boolean(monarch?.id),
    automaticWritesEnabled: false,
  };
}

async function handleMcpBridgeRequest(action, params) {
  if (action === 'status') return mcpBridgeStatus();
  if (action === 'create_snapshot') return createProjectionLabSnapshot();
  if (action === 'list_accounts') {
    const snapshot = await createProjectionLabSnapshot();
    return {
      snapshotHash: snapshot.hash,
      accounts: extractProjectionLabAccounts(snapshot.data).map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        nativeType: entry.nativeType,
        balance: Object.prototype.hasOwnProperty.call(entry.account, 'balance')
          ? entry.account.balance
          : undefined,
        amount: Object.prototype.hasOwnProperty.call(entry.account, 'amount')
          ? entry.account.amount
          : undefined,
      })),
    };
  }
  if (action === 'preview_balance_sync') return createMcpBalancePreview();
  if (action === 'apply_balance_sync') return applyMcpBalancePreview(params);
  throw new Error(`Unsupported ProjectionLab MCP action: ${action}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type == 'RUN_SYNC') {
      sendResponse({
        success: false,
        error: 'Direct one-click writes are disabled. Use the MCP preview and approved apply tools.',
      });
      return false;
  } else if (message.type == 'GET_MONARCH_CSRF_TOKEN') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const match = document.cookie.match(/(^|;\s*)csrftoken=([^;]*)/);
        return match ? match[2] : null;
      }
    }).then(results => {
      const tokenVal = results[0].result;
      sendResponse({ success: true, token: tokenVal});
    });
    return true; // Keep channel open for async response
  }
  return false;
});

startNativeBridge(handleMcpBridgeRequest);
