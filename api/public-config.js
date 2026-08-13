import { failure, methodNotAllowed, success } from '../lib/responses.js';
import { getPayPalEnvironment } from '../lib/paypal.js';

export function handlePublicConfig(request) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      return failure('CONFIG_MISSING', 'Supabase public configuration is unavailable.', 503);
    }
    const environment = getPayPalEnvironment();
    if (environment !== 'sandbox') return failure('PAYPAL_SANDBOX_REQUIRED', 'This development build only supports Sandbox.', 503);
    return success({
      paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
      paypalEnvironment: environment,
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
    });
  } catch (error) {
    return failure(error.code || 'CONFIG_MISSING', 'Public configuration is unavailable.', error.status || 503);
  }
}

export default { fetch: handlePublicConfig };
