# Return System Phase 1 predeploy report

## A. Files required before Vercel deployment

- `package.json` and `package-lock.json`
- `vercel.json`
- `index.html`
- `manifest.json`
- `service-worker.js`
- `icons/icon-192.png` and `icons/icon-512.png`
- `api/health.js`
- `api/public-config.js`
- `api/credits.js`
- `api/return-story.js`
- `api/paypal/create-order.js`, `capture-order.js`, and `webhook.js`
- `lib/auth.js`
- `lib/credit-store.js`
- `lib/supabase-admin.js`
- Supporting `lib/` modules imported by the deployed API entries
- `supabase/migrations/001_ai_credits_and_orders.sql`
- `docs/SETUP_SUPABASE.md`
- `docs/SUPABASE_MIGRATION_VERIFY_READONLY.sql`
- `docs/SUPABASE_PHASE1_LIVE_VALIDATION.md`

The project uses root-level static files plus root-level `/api` Vercel Functions. No framework conversion, build output directory, or database client bundle in `index.html` is required.

## B. SQL required after creating Supabase

Execute the complete file below once, as one SQL Editor query:

`supabase/migrations/001_ai_credits_and_orders.sql`

Do not execute the verification file as the migration. After the migration succeeds, execute `docs/SUPABASE_MIGRATION_VERIFY_READONLY.sql` separately; it reads catalog state only.

## C. Required Phase 1 environment variables

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL`

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are browser-safe public configuration. `SUPABASE_SERVICE_ROLE_KEY` is server-only. `APP_BASE_URL` records the canonical origin for deployment configuration and must not be returned by `/api/public-config`.

Gemini and PayPal variables are not Phase 1 requirements.

## D. Files that must not be uploaded to GitHub

- `.env`
- `.env.local`
- Any `.env.*` file other than `.env.example`
- `.vercel/`
- `node_modules/`
- `npm-debug.log*`
- Coverage output
- Screenshots, exported logs, or notes containing JWTs, OTPs, database passwords, Service Role/Secret keys, Gemini keys, or PayPal secrets

The existing `.gitignore` covers the local environment files, `.vercel`, dependencies, logs, coverage, and `.DS_Store`.

Run the presence check with `vercel env run -- npm run check:deploy` after linking the local directory to the Vercel project. Running the command in a normal shell does not automatically load `.env.local`; the variables must already be exported or injected by Vercel.

## E. First deployed URLs

Use the exact deployed HTTPS origin and test:

1. `/`
2. `/manifest.json`
3. `/service-worker.js`
4. `/api/health`
5. `/api/public-config`
6. `/api/credits` while signed out

Expected API results are documented in `docs/SUPABASE_PHASE1_LIVE_VALIDATION.md`. Stop at the first failure.

## Service Worker network boundary

- Same-origin `/api/` GET requests call `fetch()` directly and are never opened from or written to Cache Storage.
- Non-GET requests are ignored by the Service Worker and continue through the browser network stack.
- Supabase Auth/Data API and the Supabase browser SDK use different origins; cross-origin requests are returned without `respondWith()` and are not cached.
- The PayPal SDK uses `https://www.paypal.com` and is not cached.
- Gemini is called only by the server-side `/api/return-story` Function; that same-origin API route is Network Only.

## Current risk status

- Local project structure, handler shape, dependency declarations, syntax, tests, and cache boundaries can be checked automatically.
- A real Vercel build, real Supabase migration, OTP delivery, JWT verification, one-time grant, browser write denial, and iPhone offline behavior still require manual evidence.
- Phase 1 must remain incomplete until all live gates pass.
