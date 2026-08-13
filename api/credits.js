import { authenticateRequest } from '../lib/auth.js';
import { createCreditStore } from '../lib/credit-store.js';
import { methodNotAllowed, safeError, success } from '../lib/responses.js';

export async function handleCredits(request, deps = {}) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  try {
    const auth = await (deps.authenticate || authenticateRequest)(request);
    const store = deps.creditStore || createCreditStore();
    const account = await store.ensureAccount(auth.userId);
    return success({ balance: account.balance, accountHold: account.account_hold, freeCreditsGranted: account.free_credits_granted });
  } catch (error) {
    return safeError(error);
  }
}

export default { fetch: handleCredits };
