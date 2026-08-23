import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBalancePreview,
  hashProjectionLabExport,
  hashProjectionLabState,
  normalizeMappings,
} from '../shared/balance-sync.js';

function exportFixture() {
  return {
    today: {
      savingsAccounts: [{ id: 'cash', name: 'Cash', type: 'savings', balance: 100 }],
      investmentAccounts: [
        { id: 'ira', name: 'IRA', type: 'traditional-ira', balance: 1_000 },
      ],
      assets: [
        {
          id: 'home',
          name: 'Home',
          type: 'real-estate',
          amount: 500_000,
          balance: 200_000,
        },
      ],
      debts: [{ id: 'card', name: 'Card', type: 'debt', amount: 1_000 }],
    },
    plans: [{ id: 'plan-1', name: 'Base plan' }],
    settings: { inflation: 0.03 },
  };
}

test('builds strict previews for standard, aggregated, and debt mappings', () => {
  const preview = buildBalancePreview({
    projectionLabExport: exportFixture(),
    monarchAccounts: [
      { id: 'checking', name: 'Checking', balance: 125 },
      { id: 'brokerage-a', name: 'Brokerage A', balance: 700 },
      { id: 'brokerage-b', name: 'Brokerage B', balance: 500 },
      { id: 'credit-card', name: 'Credit Card', balance: -1_250 },
    ],
    mappings: [
      {
        plId: 'cash',
        plName: 'Cash',
        plType: 'savings',
        monarchAccounts: [{ id: 'checking', name: 'Checking' }],
      },
      {
        plId: 'ira',
        plName: 'IRA',
        plType: 'investment',
        monarchAccounts: [
          { id: 'brokerage-a', name: 'Brokerage A' },
          { id: 'brokerage-b', name: 'Brokerage B' },
        ],
      },
      {
        plId: 'card',
        plName: 'Card',
        plType: 'debt',
        monarchAccounts: [{ id: 'credit-card', name: 'Credit Card' }],
      },
    ],
  });

  assert.equal(preview.changedAccountCount, 3);
  assert.deepEqual(
    preview.updates.map((update) => [update.plId, update.data]),
    [
      ['cash', { balance: 125 }],
      ['ira', { balance: 1_200 }],
      ['card', { amount: 1_250 }],
    ],
  );
  assert.equal(preview.changes[1].monarchSources.length, 2);
});

test('maps real-asset value and loan to separate allowlisted fields', () => {
  const preview = buildBalancePreview({
    projectionLabExport: exportFixture(),
    monarchAccounts: [
      { id: 'property', name: 'Property', balance: 550_000 },
      { id: 'mortgage', name: 'Mortgage', balance: -190_000 },
    ],
    mappings: [
      {
        plId: 'home',
        plName: 'Home',
        plType: 'asset',
        plNativeType: 'real_estate',
        monarchAccounts: [{ id: 'property', name: 'Property' }],
        monarchAccountsLoan: [{ id: 'mortgage', name: 'Mortgage' }],
      },
    ],
  });

  assert.deepEqual(preview.updates[0].data, { amount: 550_000, balance: 190_000 });
});

test('refuses partial source retrieval and forced fields', () => {
  assert.throws(
    () =>
      buildBalancePreview({
        projectionLabExport: exportFixture(),
        monarchAccounts: [{ id: 'one', name: 'One', balance: 10 }],
        mappings: [
          {
            plId: 'cash',
            plName: 'Cash',
            plType: 'savings',
            monarchAccounts: [
              { id: 'one', name: 'One' },
              { id: 'missing', name: 'Missing' },
            ],
          },
        ],
      }),
    /missing Monarch sources: Missing/,
  );

  const fixture = exportFixture();
  delete fixture.today.savingsAccounts[0].balance;
  assert.throws(
    () =>
      buildBalancePreview({
        projectionLabExport: fixture,
        monarchAccounts: [{ id: 'one', name: 'One', balance: 10 }],
        mappings: [
          {
            plId: 'cash',
            plName: 'Cash',
            plType: 'savings',
            monarchAccounts: [{ id: 'one', name: 'One' }],
          },
        ],
      }),
    /refusing a forced write/,
  );
});

test('normalizes legacy mappings and hashes object keys deterministically', async () => {
  assert.deepEqual(
    normalizeMappings([
      { plId: 'cash', plName: 'Cash', monarchId: 'a', monarchName: 'A' },
      { plId: 'cash', plName: 'Cash', monarchId: 'b', monarchName: 'B' },
    ])[0].monarchAccounts,
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  );
  assert.equal(
    await hashProjectionLabExport({ b: 2, a: { z: 3, y: 4 } }),
    await hashProjectionLabExport({ a: { y: 4, z: 3 }, b: 2 }),
  );
});

test('state hashes ignore export metadata but detect current-finances changes', async () => {
  const first = exportFixture();
  const second = { ...exportFixture(), exportedAt: 'later' };
  assert.notEqual(await hashProjectionLabExport(first), await hashProjectionLabExport(second));
  assert.equal(await hashProjectionLabState(first), await hashProjectionLabState(second));
  second.today.savingsAccounts[0].balance = 101;
  assert.notEqual(await hashProjectionLabState(first), await hashProjectionLabState(second));
});
