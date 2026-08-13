import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest } from '../lib/auth.js';
import { handleCredits } from '../api/credits.js';
import { handlePublicConfig } from '../api/public-config.js';
import { createCreditStore } from '../lib/credit-store.js';
import { USER_ID } from './helpers.js';

test('paid endpoint rejects requests without token', async () => {
  await assert.rejects(() => authenticateRequest(new Request('http://localhost/api/credits'), { verifier: { auth: { getUser: async () => ({}) } } }), error => error.code === 'AUTH_REQUIRED');
});

test('expired token receives SESSION_EXPIRED', async () => {
  const request = new Request('http://localhost/api/credits', { headers: { authorization: 'Bearer expired' } });
  const verifier = { auth: { getUser: async () => ({ data: {}, error: { message: 'JWT expired' } }) } };
  await assert.rejects(() => authenticateRequest(request, { verifier }), error => error.code === 'SESSION_EXPIRED');
});

test('invalid Supabase session receives INVALID_SESSION', async () => {
  const request = new Request('http://localhost/api/credits', { headers: { authorization: 'Bearer invalid' } });
  const verifier = { auth: { getUser: async () => ({ data: {}, error: { message: 'Invalid JWT' } }) } };
  await assert.rejects(() => authenticateRequest(request, { verifier }), error => error.code === 'INVALID_SESSION');
});

test('public config reports CONFIG_MISSING when Supabase public values are absent', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const response = handlePublicConfig(new Request('http://localhost/api/public-config'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'CONFIG_MISSING');
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test('credit store distinguishes database, free grant and missing account failures', async () => {
  const databaseFailure = createCreditStore({
    rpc: async () => ({ data: null, error: { message: 'connection failed' } })
  });
  await assert.rejects(() => databaseFailure.ensureAccount(USER_ID), error => error.code === 'DATABASE_ERROR');

  let rpcCall = 0;
  const grantFailure = createCreditStore({
    rpc: async () => (++rpcCall === 1
      ? { data: [{ balance: 0 }], error: null }
      : { data: null, error: { message: 'grant transaction failed' } })
  });
  await assert.rejects(() => grantFailure.ensureAccount(USER_ID), error => error.code === 'FREE_GRANT_FAILED');

  const missingAccount = createCreditStore({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
      })
    })
  });
  await assert.rejects(() => missingAccount.getBalance(USER_ID), error => error.code === 'CREDIT_ACCOUNT_NOT_FOUND');
});

test('credits endpoint returns only the authenticated account balance', async () => {
  const store = { ensureAccount: async userId => ({ balance: userId === USER_ID ? 3 : 99, account_hold: false, free_credits_granted: 3 }) };
  const response = await handleCredits(new Request('http://localhost/api/credits'), {
    authenticate: async () => ({ userId: USER_ID }), creditStore: store
  });
  assert.deepEqual(await response.json(), { success: true, balance: 3, accountHold: false, freeCreditsGranted: 3 });
});

test('initial free credit grant remains store-controlled and idempotent', async () => {
  let granted = false;
  let balance = 0;
  const store = { ensureAccount: async () => { if (!granted) { balance += 3; granted = true; } return { balance, account_hold: false, free_credits_granted: 3 }; } };
  const deps = { authenticate: async () => ({ userId: USER_ID }), creditStore: store };
  await handleCredits(new Request('http://localhost/api/credits'), deps);
  const second = await handleCredits(new Request('http://localhost/api/credits'), deps);
  assert.equal((await second.json()).balance, 3);
});
