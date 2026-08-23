export const BALANCE_PREVIEW_TTL_MS = 10 * 60 * 1000;

const ASSET_WITH_LOAN_TYPES = new Set([
  'land',
  'car',
  'vehicle',
  'auto',
  'real-estate',
  'building',
  'motorcycle',
  'boat',
  'jewelry',
  'precious-metals',
  'furniture',
  'instrument',
  'machinery',
  'other',
]);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return number;
}

function sourceRef(account) {
  return {
    id: String(account.id),
    name: account.name || String(account.id),
  };
}

export function normalizeMappings(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const hasCurrentSchema = raw.some(
    (mapping) =>
      Array.isArray(mapping.monarchAccounts) ||
      Array.isArray(mapping.monarchAccountsLoan),
  );

  if (hasCurrentSchema) {
    return raw.map((mapping) => ({
      plId: mapping.plId == null ? '' : String(mapping.plId),
      plName: mapping.plName || String(mapping.plId || ''),
      plType: mapping.plType || 'asset',
      plNativeType: mapping.plNativeType || '',
      monarchAccounts: Array.isArray(mapping.monarchAccounts)
        ? mapping.monarchAccounts.map(sourceRef)
        : [],
      monarchAccountsLoan: Array.isArray(mapping.monarchAccountsLoan)
        ? mapping.monarchAccountsLoan.map(sourceRef)
        : [],
    }));
  }

  const byProjectionLabId = new Map();
  for (const mapping of raw) {
    if (mapping.plId == null || mapping.plId === '') continue;
    const plId = String(mapping.plId);
    if (!byProjectionLabId.has(plId)) {
      byProjectionLabId.set(plId, {
        plId,
        plName: mapping.plName || plId,
        plType: mapping.plType || 'asset',
        plNativeType: mapping.plNativeType || '',
        monarchAccounts: [],
        monarchAccountsLoan: [],
      });
    }
    const accountId = mapping.monarchId || mapping.monarchAccountId;
    if (accountId == null || accountId === '') continue;
    const entry = byProjectionLabId.get(plId);
    const normalized = {
      id: String(accountId),
      name: mapping.monarchName || mapping.monarchAccountName || String(accountId),
    };
    if (!entry.monarchAccounts.some((account) => account.id === normalized.id)) {
      entry.monarchAccounts.push(normalized);
    }
  }
  return [...byProjectionLabId.values()];
}

export function isAssetWithLoanMapping(mapping) {
  const nativeType = String(mapping.plNativeType || '')
    .toLowerCase()
    .replaceAll('_', '-');
  return [...ASSET_WITH_LOAN_TYPES].some(
    (candidate) => nativeType === candidate || nativeType.includes(candidate),
  );
}

export function extractProjectionLabAccounts(exportData) {
  const today = exportData?.today || exportData || {};
  const categories = [
    ['savingsAccounts', 'savings'],
    ['investmentAccounts', 'investment'],
    ['assets', 'asset'],
    ['debts', 'debt'],
  ];
  const accounts = [];
  for (const [property, category] of categories) {
    const values = Array.isArray(today[property]) ? today[property] : [];
    for (const account of values) {
      if (account?.id == null) continue;
      accounts.push({
        id: String(account.id),
        name: account.name || String(account.id),
        category,
        nativeType: account.type || '',
        account,
      });
    }
  }
  return accounts;
}

function requireSources(accounts, balancesById, label) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(`${label} has no Monarch source accounts.`);
  }
  const missing = accounts.filter((account) => !balancesById.has(String(account.id)));
  if (missing.length > 0) {
    throw new Error(
      `${label} is missing Monarch sources: ${missing
        .map((account) => account.name || account.id)
        .join(', ')}.`,
    );
  }
  return accounts.map((account) => ({
    ...sourceRef(account),
    balance: balancesById.get(String(account.id)).balance,
  }));
}

function sumSources(sources, label) {
  return sources.reduce(
    (total, source) => total + finiteNumber(source.balance, `${label}: ${source.name}`),
    0,
  );
}

function addChange({ changes, data, target, mapping, field, proposedValue, sources }) {
  if (!Object.prototype.hasOwnProperty.call(target.account, field)) {
    throw new Error(
      `${mapping.plName} does not expose the expected ProjectionLab field "${field}"; refusing a forced write.`,
    );
  }
  const currentValue = finiteNumber(
    target.account[field],
    `${mapping.plName}.${field}`,
  );
  const proposed = finiteNumber(proposedValue, `${mapping.plName}.${field}`);
  if (Object.is(currentValue, proposed)) return;
  data[field] = proposed;
  changes.push({
    projectionLabAccountId: mapping.plId,
    projectionLabAccountName: mapping.plName,
    field,
    currentValue,
    proposedValue: proposed,
    delta: proposed - currentValue,
    monarchSources: sources,
  });
}

export function buildBalancePreview({ mappings, monarchAccounts, projectionLabExport }) {
  const normalizedMappings = normalizeMappings(mappings).filter((mapping) => mapping.plId);
  if (normalizedMappings.length === 0) {
    throw new Error('No ProjectionLab account mappings are configured.');
  }

  const seenTargets = new Set();
  for (const mapping of normalizedMappings) {
    if (seenTargets.has(mapping.plId)) {
      throw new Error(`ProjectionLab account ${mapping.plName} is mapped more than once.`);
    }
    seenTargets.add(mapping.plId);
  }

  const balancesById = new Map(
    (Array.isArray(monarchAccounts) ? monarchAccounts : []).map((account) => [
      String(account.id),
      {
        id: String(account.id),
        name: account.name || String(account.id),
        balance: finiteNumber(account.balance, account.name || String(account.id)),
      },
    ]),
  );
  const projectionLabById = new Map(
    extractProjectionLabAccounts(projectionLabExport).map((account) => [account.id, account]),
  );

  const updates = [];
  const changes = [];
  for (const mapping of normalizedMappings) {
    const target = projectionLabById.get(mapping.plId);
    if (!target) {
      throw new Error(`ProjectionLab account ${mapping.plName} (${mapping.plId}) was not found.`);
    }
    const data = {};

    if (isAssetWithLoanMapping(mapping)) {
      if (mapping.monarchAccounts.length > 0) {
        const valueSources = requireSources(
          mapping.monarchAccounts,
          balancesById,
          `${mapping.plName} asset value`,
        );
        addChange({
          changes,
          data,
          target,
          mapping,
          field: 'amount',
          proposedValue: Math.abs(sumSources(valueSources, mapping.plName)),
          sources: valueSources,
        });
      }
      if (mapping.monarchAccountsLoan.length > 0) {
        const loanSources = requireSources(
          mapping.monarchAccountsLoan,
          balancesById,
          `${mapping.plName} loan`,
        );
        addChange({
          changes,
          data,
          target,
          mapping,
          field: 'balance',
          proposedValue: Math.abs(sumSources(loanSources, mapping.plName)),
          sources: loanSources,
        });
      }
      if (mapping.monarchAccounts.length === 0 && mapping.monarchAccountsLoan.length === 0) {
        throw new Error(`${mapping.plName} has no Monarch source accounts.`);
      }
    } else {
      const sources = requireSources(
        mapping.monarchAccounts,
        balancesById,
        mapping.plName,
      );
      const isDebt = String(mapping.plType || target.category).toLowerCase() === 'debt';
      addChange({
        changes,
        data,
        target,
        mapping,
        field: isDebt ? 'amount' : 'balance',
        proposedValue: isDebt
          ? Math.abs(sumSources(sources, mapping.plName))
          : sumSources(sources, mapping.plName),
        sources,
      });
    }

    if (Object.keys(data).length > 0) {
      updates.push({
        plId: mapping.plId,
        plName: mapping.plName,
        data,
      });
    }
  }

  return {
    mappedAccountCount: normalizedMappings.length,
    changedAccountCount: updates.length,
    unchangedAccountCount: normalizedMappings.length - updates.length,
    updates,
    changes,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(
    typeof value === 'string' ? value : canonicalJson(value),
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashProjectionLabExport(exportData) {
  return sha256Hex(exportData);
}

export async function hashProjectionLabState(exportData) {
  return sha256Hex(exportData?.today || exportData || {});
}
