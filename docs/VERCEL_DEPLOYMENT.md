# Vercel deployment

## Local preparation

1. Use a Vercel-supported Node.js version matching `package.json` (Node.js 20 or newer).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill only the Phase 1 values. Never commit this file.
4. Run `npm test` and `npm run check`.
5. With the four Phase 1 environment variables present in the shell, run `npm run check:deploy`. If the project is already linked to Vercel, use `vercel env run -- npm run check:deploy` so the Development values are injected without printing them.

The predeploy check only verifies that required variable names are present, critical project files exist, and declared runtime dependencies are installed. It never validates or prints a key value. Any failure prints only `CONFIG_MISSING`.

## Vercel project settings

Import this directory as the Vercel project root. Select **Other** as the Framework Preset if Vercel does not detect the static project automatically. Do not set an Output Directory: the static PWA is at the repository root. JavaScript files under the root `/api` directory use Vercel's Node.js Web Handler format.

For Supabase Phase 1, configure only:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL=https://YOUR-DEPLOYED-ORIGIN`

Apply the intended values to Development, Preview, or Production as documented in `SETUP_SUPABASE.md`, then create a new deployment. Existing deployments do not receive environment-variable changes retroactively.

The predeploy script is a manual gate; it is not configured as the Vercel Build Command. Run it before creating the deployment or through `vercel env run`. A successful local check does not prove that the same values were assigned to the Preview or Production deployment.

Do not configure these during Phase 1:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENV`
- `PAYPAL_WEBHOOK_ID`

Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` among the Supabase values may be returned by `/api/public-config`. `SUPABASE_SERVICE_ROLE_KEY` and `APP_BASE_URL` remain server-side. API responses use `no-store`, and the Service Worker treats same-origin `/api/` requests as Network Only.

## First deployed URLs

Test in this order:

1. `https://YOUR-DEPLOYED-ORIGIN/`
2. `https://YOUR-DEPLOYED-ORIGIN/manifest.json`
3. `https://YOUR-DEPLOYED-ORIGIN/service-worker.js`
4. `https://YOUR-DEPLOYED-ORIGIN/api/health`
5. `https://YOUR-DEPLOYED-ORIGIN/api/public-config`
6. `https://YOUR-DEPLOYED-ORIGIN/api/credits` while signed out

After those checks pass, follow `SUPABASE_PHASE1_LIVE_VALIDATION.md` without skipping steps.
