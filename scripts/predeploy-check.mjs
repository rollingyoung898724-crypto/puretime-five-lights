import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'vercel.json',
  'index.html',
  'manifest.json',
  'service-worker.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'api/health.js',
  'api/public-config.js',
  'api/credits.js',
  'api/return-story.js',
  'api/paypal/create-order.js',
  'api/paypal/capture-order.js',
  'api/paypal/webhook.js',
  'lib/auth.js',
  'lib/credit-store.js',
  'lib/supabase-admin.js',
  'lib/gemini.js',
  'lib/order-store.js',
  'lib/paypal.js',
  'lib/products.js',
  'lib/religious-boundaries.js',
  'lib/responses.js',
  'lib/validation.js',
  'supabase/migrations/001_ai_credits_and_orders.sql',
  'docs/SETUP_SUPABASE.md',
  'docs/SUPABASE_MIGRATION_VERIFY_READONLY.sql',
  'docs/SUPABASE_PHASE1_LIVE_VALIDATION.md'
];

const requiredEnvironment = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_BASE_URL'
];

const requiredDependencies = [
  '@google/genai',
  '@supabase/supabase-js',
  'zod'
];

let valid = requiredFiles.every(file => existsSync(file));

try {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  valid = valid && requiredDependencies.every(dependency => {
    if (!packageJson.dependencies?.[dependency]) return false;
    try {
      require.resolve(dependency);
      return true;
    } catch {
      return false;
    }
  });
} catch {
  valid = false;
}

valid = valid && requiredEnvironment.every(name => typeof process.env[name] === 'string' && process.env[name].length > 0);

if (!valid) {
  console.error('CONFIG_MISSING');
  process.exit(1);
}

console.log('PREDEPLOY_CHECK_OK');
