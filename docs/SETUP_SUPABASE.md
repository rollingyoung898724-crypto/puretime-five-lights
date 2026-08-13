# Supabase Phase 1 setup and verification

This phase configures Supabase Auth and the credit database only. Do not add Gemini or PayPal credentials yet, and never paste a real secret into source code, chat, screenshots, or client-side configuration.

## 1. Create an isolated development project

1. Sign in to the Supabase Dashboard and choose the intended organization.
2. Select **New project**.
3. Use a clearly non-production name such as `return-system-dev`.
4. Generate a strong database password and store it in a password manager. It is not one of this app's Vercel variables.
5. Choose the region closest to the expected test users, select the desired development plan, and create the project.
6. Wait until the project reports that it is healthy before opening the SQL Editor.

Do not reuse a production database for Phase 1. A standard hosted Supabase project already contains `auth.users` and the `anon`, `authenticated`, and `service_role` database roles used by this migration.

## 2. Run the migration

1. Open this repository file in a local editor:

   `supabase/migrations/001_ai_credits_and_orders.sql`

2. Copy the complete file, including `begin;` and `commit;`.
3. In the Supabase project, open **SQL Editor**, create a new query, paste the complete file, and select **Run** once.

Run it as one complete query, not in sections. The transaction preserves the required creation order and rolls back the whole migration if any statement fails. The file creates `pgcrypto` if needed, then tables and indexes, enables RLS, applies privileges, creates RPCs, and finally grants only the server role permission to execute them.

On a fresh project, one successful run is sufficient. Do not keep rerunning the migration to troubleshoot an error without first reading the exact SQL Editor error. `CREATE TABLE IF NOT EXISTS` does not upgrade an older table whose columns differ from this migration.

After a successful run, **Table Editor** should show:

- `ai_credit_accounts`
- `ai_credit_transactions`
- `paypal_orders`
- `story_generations`
- `paypal_webhook_events`

Under **Database > Functions** (the Dashboard label may appear simply as **Functions**), the `public` schema should show:

- `ensure_credit_account`
- `grant_initial_free_credits`
- `reserve_story_credit`
- `commit_story_credit`
- `release_story_credit`
- `grant_purchase_credits`
- `process_refund_adjustment`

The PayPal-named tables and RPCs are created now because they are part of the single schema dependency graph. Their existence does not configure or call PayPal.

## 3. Configure Email OTP for the existing UI

The current `index.html` asks the user to type a six-digit email code. It does not consume a clicked Magic Link callback.

1. Open **Authentication > Providers > Email**.
2. Keep the Email provider enabled. Allow email sign-ups for development, because the app calls `signInWithOtp` with `shouldCreateUser: true`.
3. Open **Authentication > Email Templates** and edit the **Magic Link / OTP** template.
4. Make sure the message visibly includes `{{ .Token }}`. For example, the body may contain `Your Return System code is: {{ .Token }}`.
5. Do not configure a template that only contains `{{ .ConfirmationURL }}`; that sends a clickable link while the current UI is waiting for a six-digit code.
6. For production launch later, configure custom SMTP and review OTP expiry and email rate limits. The built-in sender is suitable only for limited development testing.

## 4. Configure Site URL and redirect URLs

Open **Authentication > URL Configuration**.

Set **Site URL** to the exact canonical production origin when it exists, including `https://`, for example:

`https://your-production-domain.example`

If no production domain exists yet, use the stable Vercel production URL temporarily and replace it later. Do not use a changing deployment-specific Preview URL as the Site URL.

Add only origins that you actually use to **Redirect URLs**:

- `http://localhost:3000/**` for local `vercel dev` testing.
- `https://your-production-domain.example/**` for production.
- `https://*-your-vercel-team-or-account-slug.vercel.app/**` for Vercel Preview deployments.

Replace every placeholder with the real project/domain values. For stricter Preview security, add the stable branch Preview URL instead of a broad wildcard. The current typed-OTP flow does not pass `emailRedirectTo`, but keeping these allowed URLs correct prevents future email-auth redirects from falling back to an unintended origin.

## 5. Obtain the Supabase values without exposing them

In the Supabase Dashboard, use the project's **Connect** dialog or **Settings > API Keys**:

- `SUPABASE_URL`: the project URL, such as the project's `https://...supabase.co` origin.
- `SUPABASE_PUBLISHABLE_KEY`: the current publishable key beginning with `sb_publishable_`. The legacy `anon` key also works, but new projects should prefer the publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: put the current server-only secret key beginning with `sb_secret_` in this existing environment-variable name. The variable name is retained for code compatibility. A legacy `service_role` JWT also works, but the current secret key is preferred.

Copy values directly from Supabase into Vercel's encrypted Environment Variables fields. Do not send them through chat and do not commit a populated `.env` or `.env.local` file.

Browser-safe values:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Server-only values:

- `SUPABASE_SERVICE_ROLE_KEY` (whether it contains a current `sb_secret_...` key or a legacy `service_role` key)

`APP_BASE_URL` is not a credential, but it stays in server configuration and is not returned by `/api/public-config`.

## 6. Add Phase 1 variables to Vercel

In **Vercel Project > Settings > Environment Variables**, add only:

| Variable | Development | Preview | Production | Browser exposure |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Development Supabase URL | Development/staging Supabase URL | Production Supabase URL | Allowed |
| `SUPABASE_PUBLISHABLE_KEY` | Matching publishable key | Matching publishable key | Matching publishable key | Allowed |
| `SUPABASE_SERVICE_ROLE_KEY` | Matching secret key | Matching secret key | Production secret key | Never |
| `APP_BASE_URL` | `http://localhost:3000` | Stable HTTPS Preview/branch origin | Canonical HTTPS production origin | No |

For Phase 1, Development and Preview may share the isolated development Supabase project. Production should use a separate production Supabase project before real users are admitted. Never point Preview builds at production data.

Vercel scopes each value independently:

- **Development** is used by `vercel dev` and by values pulled for local development.
- **Preview** is used by non-production branch/PR deployments; it can be limited to a specific Git branch.
- **Production** is used only by new production deployments.

After adding or changing any environment variable, create a new deployment or redeploy the intended deployment. Existing deployments retain their previous environment snapshot.

Before deployment, run `vercel env run -- npm run check:deploy` against the linked project's Development environment, or run `npm run check:deploy` from a shell where the four Phase 1 variables are already present. The script checks presence only and never prints their values. A failure prints only `CONFIG_MISSING`.

No Gemini or PayPal variable is required for this Supabase phase. The existing public-config response currently has this allowlist:

- `success`
- `supabaseUrl`
- `supabasePublishableKey`
- `paypalClientId` (empty until the PayPal phase)
- `paypalEnvironment` (remains `sandbox`)

It must never return `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, a database password, or any provider secret.

## 7. Verify the migration safely

Open `docs/SUPABASE_MIGRATION_VERIFY_READONLY.sql`, copy the complete file into a new SQL Editor query, and run it. It only reads PostgreSQL catalogs; it does not create, update, or delete schema or user data.

Expected results:

1. All five required tables report `exists = true`.
2. All seven RPCs exist with the exact named parameters, report `security_definer = true`, and show `search_path=public, pg_temp` in their function settings.
3. `anon` and `authenticated` have no table operations; `service_role` has select/insert/update/delete.
4. `anon` and `authenticated` cannot execute the seven RPCs; `service_role` can.
5. Primary keys, unique constraints, foreign keys to `auth.users`, and check constraints are present.
6. RLS is true for all five tables and the policy query returns zero rows by design.
7. User/time indexes and indexes backing the unique constraints are present.
8. The focused constraint result includes allowed values for `transaction_type`, PayPal `status`, and story-generation `status`.

Do not manually call credit-granting RPCs merely to inspect them: those calls write data. The first real authenticated `/api/credits` request is the appropriate end-to-end test after the environment variables and OTP flow are configured.

## 8. Evidence required before declaring Phase 1 successful

Configuration is successful only after all of the following have been observed against the real development project:

1. The read-only verification query returns the expected schema and privileges.
2. A real test email receives a six-digit OTP.
3. The deployed app verifies that OTP and receives a Supabase session.
4. The authenticated `GET /api/credits` returns `balance: 3`, `accountHold: false`, and `freeCreditsGranted: 3` for a new test user.
5. Repeating `GET /api/credits`, reloading, and signing in concurrently do not increase the balance above 3.
6. `ai_credit_transactions` contains exactly one `free_grant` row for that user.
7. A browser request made with only the publishable key cannot select or modify the credit tables and cannot execute the protected RPCs.

Until those real observations exist, the accurate status is: code and setup instructions are ready, but external Supabase configuration is not yet verified.

For the required deployment-by-deployment acceptance sequence, use `docs/SUPABASE_PHASE1_LIVE_VALIDATION.md`. Stop at the first failure and do not begin Gemini or PayPal configuration until every gate in that document passes.
