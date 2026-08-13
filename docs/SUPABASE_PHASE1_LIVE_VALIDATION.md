# Supabase Phase 1 live validation

Use this checklist only after the migration has run successfully and the four Supabase/Vercel variables in `SETUP_SUPABASE.md` have been added to a new Vercel deployment. Use a fresh test email address that has never signed in to this Supabase project.

Stop at the first failed step. Do not configure Gemini or PayPal and do not proceed to the next phase until all thirteen steps pass.

## Safe debugging boundary

The API may return these diagnostic codes without returning stack traces or secrets:

- `CONFIG_MISSING`: required Supabase environment configuration is absent.
- `AUTH_REQUIRED`: no Bearer session was supplied.
- `INVALID_SESSION`: Supabase rejected the session.
- `DATABASE_ERROR`: the server could not complete a database operation.
- `FREE_GRANT_FAILED`: the one-time initial-credit transaction failed.
- `CREDIT_ACCOUNT_NOT_FOUND`: authentication succeeded but the credit account could not be read.

When checking Vercel or Supabase logs, never copy a complete JWT, Service Role/Secret key, database connection string, OTP, or user photo into a ticket, screenshot, chat, or source file. The API response must not contain an internal stack trace.

## 1. Open `/api/health`

Visit `https://YOUR_DEPLOYED_ORIGIN/api/health`.

**Expected result**

- HTTP `200`.
- JSON contains `success: true` and `service: "return-system-api"`.
- `environment: "sandbox"` is expected because the repository remains restricted to PayPal Sandbox, but this does not configure or test PayPal.

**If it fails, inspect**

- Vercel deployment status and Function routing.
- `api/health.js` deployment output and `vercel.json` routing/headers.
- Whether the URL is the latest deployment rather than an older Preview URL.

**Relevant evidence**

- Browser Network response and status.
- Vercel **Deployments > selected deployment > Functions/Runtime Logs**.

**Gate:** do not continue unless the endpoint returns HTTP 200. This endpoint proves only that the Function route is reachable; it does not prove Supabase connectivity.

## 2. Open `/api/public-config`

Visit `https://YOUR_DEPLOYED_ORIGIN/api/public-config`.

**Expected result**

- HTTP `200` and `success: true`.
- `supabaseUrl` is the intended development Supabase project URL.
- `supabasePublishableKey` is non-empty.
- No `supabaseServiceRoleKey`, secret key, database password, connection string, or `APP_BASE_URL` appears.
- `paypalClientId` may be empty and `paypalEnvironment` remains `sandbox` during this phase.

**If it fails, inspect**

- Vercel Project **Settings > Environment Variables** for `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the environment used by this deployment.
- Whether a new deployment was created after saving the variables.
- A `CONFIG_MISSING` response means at least one public Supabase value is absent in that deployment.

**Relevant evidence**

- Browser Network response; do not publish screenshots containing unnecessary configuration values.
- Vercel deployment environment assignment and Runtime Logs.

**Gate:** do not continue while either public Supabase value is empty or any server secret is exposed.

## 3. Call `/api/credits` while signed out

Open a private/incognito window and visit `https://YOUR_DEPLOYED_ORIGIN/api/credits`, or make a plain GET request without an `Authorization` header.

**Expected result**

- HTTP `401`.
- JSON contains `success: false` and `error.code: "AUTH_REQUIRED"`.
- No account or credit row is created.

**If it fails, inspect**

- `api/credits.js`, `lib/auth.js`, and the deployed Function version.
- Browser Network request headers: there must be no stale `Authorization` header.
- If it returns 200, stop immediately because the authentication boundary is broken.

**Relevant evidence**

- Browser Network request/response.
- Vercel Runtime Logs only if the Function itself failed; routine 401 responses need no secret-bearing log entry.

**Gate:** do not continue unless unauthenticated access is rejected.

## 4. Complete a real Email OTP sign-in

In the deployed app, enter a real test email and select **SEND EMAIL CODE**. Enter the received six-digit code and select **VERIFY CODE**.

The current UI supports typed Email OTP. A template containing only a clickable Magic Link is not sufficient for this build; the Supabase Magic Link/OTP email template must visibly include `{{ .Token }}`.

**Expected result**

- The email arrives with a six-digit OTP.
- The code produces a real Supabase session.
- Supabase **Authentication > Users** shows one user for the test email.
- The browser does not display or log the complete access token.

**If it fails, inspect**

- Supabase **Authentication > Providers > Email** and whether email sign-ups are enabled.
- **Authentication > Email Templates > Magic Link / OTP** for `{{ .Token }}`.
- **Authentication > URL Configuration**, email rate limits, OTP expiry, and custom SMTP only if one was configured.
- Browser Network calls to `/auth/v1/otp` and `/auth/v1/verify`; inspect status/error text without copying the OTP or token.

**Relevant evidence**

- Supabase **Authentication > Logs** and **Authentication > Users**.
- Browser Network statuses for Supabase Auth calls.

**Gate:** do not continue unless a real email produces a valid session.

## 5. Query credits after login

The app automatically requests `/api/credits` after OTP verification. Open the browser Network panel and inspect that authenticated request.

**Expected result**

- Request contains a Bearer token, but the token is not copied or recorded.
- HTTP `200`.
- Response contains `success`, `balance`, `accountHold`, and `freeCreditsGranted` only; it contains no internal database row, key, or stack trace.

**If it fails, inspect**

- `INVALID_SESSION`: verify that `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` belong to the same Supabase project that issued the session.
- `CONFIG_MISSING`: check the deployment's server environment variables and redeploy.
- `DATABASE_ERROR`: inspect the real migration result, RPC permissions, Vercel Runtime Logs, and Supabase Postgres Logs.
- `FREE_GRANT_FAILED`: inspect `grant_initial_free_credits`, constraints, and database logs; do not manually add credits.
- `CREDIT_ACCOUNT_NOT_FOUND`: inspect `ai_credit_accounts` and the `ensure_credit_account` RPC result.

**Relevant evidence**

- Browser Network response.
- Vercel Runtime Logs.
- Supabase **Logs > Postgres Logs** and Table Editor.

**Gate:** do not continue unless the authenticated Function verifies the Supabase session and returns HTTP 200.

## 6. Confirm the first account receives exactly 3 credits

Use the first successful `/api/credits` response for the fresh test user.

**Expected result**

```json
{
  "success": true,
  "balance": 3,
  "accountHold": false,
  "freeCreditsGranted": 3
}
```

**If it fails, inspect**

- `grant_initial_free_credits` in Database Functions.
- `ai_credit_accounts.balance` and `free_credits_granted`.
- `ai_credit_transactions` for the user's `free_grant` row.
- Vercel Runtime Logs and Supabase Postgres Logs for `FREE_GRANT_FAILED` or constraint errors.

**Relevant evidence**

- `/api/credits` response.
- The two credit tables; use the read-only SQL in step 10.

**Gate:** stop if the first balance is not exactly 3 or if more than one grant appears.

## 7. Refresh and query again

Reload the page, return to the Basic Reflection/AI account area, and select **Refresh balance**.

**Expected result**

- `/api/credits` returns `balance: 3` and `freeCreditsGranted: 3` again.
- No additional `free_grant` transaction is created.

**If it fails, inspect**

- The row lock and existing-ledger check in `grant_initial_free_credits`.
- The unique constraint on `(reference_type, reference_id, transaction_type)`.
- Supabase Postgres Logs for concurrency or unique-constraint errors.

**Relevant evidence**

- Repeated Network responses.
- `ai_credit_transactions` count from step 10.

**Gate:** stop if the balance increases or the grant count becomes greater than one.

## 8. Sign out and sign in again

Select **Sign out**, then sign in again with the same email and a new OTP. Refresh the balance.

**Expected result**

- The same Supabase user ID is reused.
- Balance remains 3.
- `freeCreditsGranted` remains 3.
- Exactly one `free_grant` row exists.

**If it fails, inspect**

- Supabase Authentication Users for accidental duplicate identities.
- Whether the email address was entered identically.
- `ai_credit_accounts.user_id` and the transaction reference ID.

**Relevant evidence**

- Authentication Users.
- `/api/credits` response and the two credit tables.

**Gate:** do not continue if re-login creates a second account or grant.

## 9. Sign in concurrently in another browser

Keep the first browser signed in. In a different browser or private session, sign in with the same test email and refresh the balance in both browsers as close together as practical.

**Expected result**

- Both browsers receive `balance: 3`.
- Only one account row and one `free_grant` transaction exist.
- No HTTP 500/503 or unique-constraint error appears.

**If it fails, inspect**

- Supabase Postgres Logs around both request timestamps.
- The `FOR UPDATE` row lock in `grant_initial_free_credits`.
- The `ai_credit_transactions` unique constraint.
- Vercel Runtime Logs for `FREE_GRANT_FAILED` or `DATABASE_ERROR`.

**Relevant evidence**

- Network responses from both browsers.
- Supabase Postgres Logs and the read-only count query below.

**Gate:** stop if concurrent access changes the balance or creates duplicate grants.

## 10. Inspect the two credit tables in Supabase

From **Authentication > Users**, copy only the test user's UUID. Replace `TEST_USER_UUID` locally in SQL Editor; do not paste it into chat.

```sql
select user_id, balance, free_credits_granted, account_hold, created_at, updated_at
from public.ai_credit_accounts
where user_id = 'TEST_USER_UUID'::uuid;

select id, user_id, delta, balance_after, transaction_type,
       reference_type, reference_id, created_at
from public.ai_credit_transactions
where user_id = 'TEST_USER_UUID'::uuid
order by created_at, id;
```

**Expected result**

- Exactly one account row with balance 3, free credits 3, and no account hold.
- A single `free_grant` transaction with `delta = 3`, `balance_after = 3`, `reference_type = 'user'`, and the user UUID as `reference_id`.

**If it fails, inspect**

- Whether the UUID belongs to the same Supabase project and test user.
- RPC migration version, constraints, and Function calls.

**Relevant evidence**

- SQL Editor result sets and Postgres Logs.

**Gate:** do not continue unless the database is consistent with the API responses.

## 11. Confirm there is only one `free_grant`

Run this read-only query with the same local UUID replacement:

```sql
select
  count(*) as free_grant_count,
  coalesce(sum(delta), 0) as total_free_credits_granted,
  min(balance_after) as first_balance_after,
  max(balance_after) as last_balance_after
from public.ai_credit_transactions
where user_id = 'TEST_USER_UUID'::uuid
  and transaction_type = 'free_grant'
  and reference_type = 'user'
  and reference_id = 'TEST_USER_UUID';
```

**Expected result**

- `free_grant_count = 1`.
- `total_free_credits_granted = 3`.
- Both balance-after values are 3.

**If it fails, inspect**

- The deployed migration version and unique constraint.
- Whether any manual database edits were performed.
- Postgres Logs at each transaction timestamp.

**Relevant evidence**

- SQL Editor result and `ai_credit_transactions`.

**Gate:** any count other than one blocks Phase 1 acceptance.

## 12. Confirm the browser cannot modify the balance

While signed in, use Safari Web Inspector or browser DevTools on the deployed app. The following uses the already initialized browser client and writes the already observed balance value back to the same field, so a mistakenly permitted request does not intentionally change the amount:

```js
await aiSupabaseClient
  .from('ai_credit_accounts')
  .update({ balance: aiCreditBalance })
  .eq('user_id', aiSession.user.id)
```

Then select **Refresh balance** and rerun the read-only database query from step 10.

**Expected result**

- Supabase rejects the direct update with a permission/RLS error.
- Balance remains 3.
- No new credit transaction appears.

**If it succeeds, inspect immediately**

- Table grants for `anon` and `authenticated`.
- RLS state and unintended policies.
- RPC execution grants.
- Run `SUPABASE_MIGRATION_VERIFY_READONLY.sql` again.

**Relevant evidence**

- Browser console result and Network response from Supabase REST.
- Supabase API/Postgres Logs and catalog verification SQL.

**Gate:** a successful direct browser update is a security failure and blocks all later phases.

## 13. Confirm offline Basic Reflection still works

First open the deployed PWA online once so its shell is cached. Close it completely. Enable Airplane Mode, disable Wi-Fi, and reopen it from the iPhone Home Screen. Use the existing missed-Salah return flow and continue until a **Basic Reflection** is shown and saved locally. Do not select the optional AI action.

**Expected result**

- The PWA opens without network access.
- Salah Lights, Return Story flow, Sadaqah Box, Calendar, and local Basic Reflection remain usable.
- AI/Supabase actions may report that internet is required, but the local reflection flow is not blocked.
- Existing LocalStorage records remain present after returning online.

**If it fails, inspect**

- Safari/PWA cache state and the active Service Worker version.
- Whether the app was opened online after the latest deployment.
- iPhone storage settings and whether site data was cleared.
- Service Worker fetch handling: `/api/` should remain Network Only while the app shell remains cached.

**Relevant evidence**

- iPhone screen recording or a timestamped manual test note.
- Safari Web Inspector Service Worker/Cache Storage when available.
- There should be no Supabase database write for a Basic Reflection.

**Gate:** Phase 1 is blocked if Supabase integration has broken the existing offline local experience.

## Final acceptance record

Supabase Phase 1 is complete only when there is real evidence for all of the following:

- The migration succeeded against the intended real development project.
- Five tables and seven RPCs exist with the verified privileges and constraints.
- A real Email OTP creates a valid session.
- Vercel verifies that session and reads credits from Supabase.
- A fresh user receives one and only one three-credit grant across refresh, re-login, and concurrent browsers.
- The publishable-key browser client cannot modify credits or call protected RPCs.
- Credit values come from `ai_credit_accounts`, not LocalStorage.
- Offline Basic Reflection and the existing PWA remain operational.

Only after every item passes may the project enter the Gemini phase. PayPal configuration remains out of scope.
