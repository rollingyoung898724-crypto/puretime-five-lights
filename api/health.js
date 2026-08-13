import { methodNotAllowed, success } from '../lib/responses.js';

export function handleHealth(request) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  return success({ service: 'return-system-api', environment: process.env.PAYPAL_ENV || 'sandbox' });
}

export default { fetch: handleHealth };
