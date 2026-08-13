import { getSupabaseAuthVerifier } from './supabase-admin.js';

function authError(code, message, status = 401) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

export async function authenticateRequest(request, { verifier = getSupabaseAuthVerifier() } = {}) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw authError('AUTH_REQUIRED', 'Sign in is required to use this feature.');

  const token = match[1].trim();
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data?.user) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('expired')) throw authError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    throw authError('INVALID_SESSION', 'Your session is not valid. Please sign in again.');
  }
  if (!data.user.id) throw authError('INVALID_SESSION', 'Your session is not valid. Please sign in again.');
  return { userId: data.user.id, email: data.user.email || null, token };
}
