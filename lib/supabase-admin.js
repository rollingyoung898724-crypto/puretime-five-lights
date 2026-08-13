import { createClient } from '@supabase/supabase-js';

let adminClient;
let authClient;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`Missing server configuration: ${name}`), { code: 'CONFIG_MISSING', status: 503 });
  return value;
}

const serverAuthOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
};

export function getSupabaseAdmin() {
  if (!adminClient) adminClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), serverAuthOptions);
  return adminClient;
}

export function getSupabaseAuthVerifier() {
  if (!authClient) authClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_PUBLISHABLE_KEY'), serverAuthOptions);
  return authClient;
}

export function resetSupabaseClientsForTests() {
  adminClient = undefined;
  authClient = undefined;
}
