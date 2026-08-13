-- Return System / Supabase Phase 1
-- Read-only migration verification. This script does not modify schema or data.

-- 1. Required tables. Every row should report exists = true.
with expected(table_name) as (
  values
    ('ai_credit_accounts'),
    ('ai_credit_transactions'),
    ('paypal_orders'),
    ('story_generations'),
    ('paypal_webhook_events')
)
select
  table_name,
  to_regclass(format('public.%I', table_name)) is not null as exists
from expected
order by table_name;

-- 2. Required RPC names, exact input arguments, return definition, security mode,
-- and configured search_path. Every expected row should be present once.
with expected(function_name, input_arguments) as (
  values
    ('ensure_credit_account', 'p_user_id uuid'),
    ('grant_initial_free_credits', 'p_user_id uuid'),
    ('reserve_story_credit', 'p_user_id uuid, p_request_id uuid'),
    ('commit_story_credit', 'p_user_id uuid, p_request_id uuid, p_title text, p_body text, p_visual_facts jsonb, p_atmosphere text, p_photo_relevance text, p_safety_flags jsonb'),
    ('release_story_credit', 'p_user_id uuid, p_request_id uuid, p_error_code text'),
    ('grant_purchase_credits', 'p_user_id uuid, p_order_id uuid, p_capture_id text, p_amount text, p_currency text, p_payer_email text, p_raw_summary jsonb'),
    ('process_refund_adjustment', 'p_paypal_order_id text, p_event_id text, p_new_status text')
)
select
  e.function_name,
  e.input_arguments as expected_arguments,
  p.oid is not null as exists,
  pg_get_function_arguments(p.oid) as actual_arguments_and_outputs,
  pg_get_function_result(p.oid) as return_type,
  coalesce(p.prosecdef, false) as security_definer,
  p.proconfig as function_settings
from expected e
left join pg_proc p
  on p.proname = e.function_name
 and pg_get_function_identity_arguments(p.oid) = e.input_arguments
 and p.pronamespace = 'public'::regnamespace
order by e.function_name;

-- 3. Table-level privileges. Browser roles should have no privileges;
-- service_role should have SELECT, INSERT, UPDATE and DELETE on all five tables.
with expected(table_name) as (
  values
    ('ai_credit_accounts'),
    ('ai_credit_transactions'),
    ('paypal_orders'),
    ('story_generations'),
    ('paypal_webhook_events')
), roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
)
select
  e.table_name,
  r.role_name,
  to_regclass(format('public.%I', e.table_name)) is not null as table_exists,
  case when to_regclass(format('public.%I', e.table_name)) is not null
    then has_table_privilege(r.role_name, to_regclass(format('public.%I', e.table_name)), 'SELECT') end as can_select,
  case when to_regclass(format('public.%I', e.table_name)) is not null
    then has_table_privilege(r.role_name, to_regclass(format('public.%I', e.table_name)), 'INSERT') end as can_insert,
  case when to_regclass(format('public.%I', e.table_name)) is not null
    then has_table_privilege(r.role_name, to_regclass(format('public.%I', e.table_name)), 'UPDATE') end as can_update,
  case when to_regclass(format('public.%I', e.table_name)) is not null
    then has_table_privilege(r.role_name, to_regclass(format('public.%I', e.table_name)), 'DELETE') end as can_delete
from expected e
cross join roles r
order by e.table_name, r.role_name;

-- 4. Function execution privileges. anon/authenticated should be false;
-- service_role should be true for all seven RPCs.
with functions(signature) as (
  values
    ('public.ensure_credit_account(uuid)'),
    ('public.grant_initial_free_credits(uuid)'),
    ('public.reserve_story_credit(uuid,uuid)'),
    ('public.commit_story_credit(uuid,uuid,text,text,jsonb,text,text,jsonb)'),
    ('public.release_story_credit(uuid,uuid,text)'),
    ('public.grant_purchase_credits(uuid,uuid,text,text,text,text,jsonb)'),
    ('public.process_refund_adjustment(text,text,text)')
), roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
)
select
  f.signature,
  r.role_name,
  to_regprocedure(f.signature) is not null as function_exists,
  case when to_regprocedure(f.signature) is not null
    then has_function_privilege(r.role_name, to_regprocedure(f.signature), 'EXECUTE') end as can_execute
from functions f
cross join roles r
order by f.signature, r.role_name;

-- 5. Primary keys, unique constraints, foreign keys and check constraints.
-- contype: p = primary key, u = unique, f = foreign key, c = check.
select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.connamespace = 'public'::regnamespace
  and c.conrelid::regclass::text = any (array[
    'ai_credit_accounts',
    'ai_credit_transactions',
    'paypal_orders',
    'story_generations',
    'paypal_webhook_events'
  ])
order by table_name, constraint_type, constraint_name;

-- 6. RLS state. row_level_security should be true for every table.
select
  schemaname,
  tablename,
  rowsecurity as row_level_security
from pg_tables
where schemaname = 'public'
  and tablename in (
    'ai_credit_accounts',
    'ai_credit_transactions',
    'paypal_orders',
    'story_generations',
    'paypal_webhook_events'
  )
order by tablename;

-- 7. RLS policies. This migration intentionally creates none; zero rows is expected.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'ai_credit_accounts',
    'ai_credit_transactions',
    'paypal_orders',
    'story_generations',
    'paypal_webhook_events'
  )
order by tablename, policyname;

-- 8. Indexes, including indexes backing primary-key and unique constraints.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'ai_credit_accounts',
    'ai_credit_transactions',
    'paypal_orders',
    'story_generations',
    'paypal_webhook_events'
  )
order by tablename, indexname;

-- 9. Focused checks for transaction_type and status constraints.
select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.contype = 'c'
  and c.connamespace = 'public'::regnamespace
  and (
    pg_get_constraintdef(c.oid, true) ilike '%transaction_type%'
    or pg_get_constraintdef(c.oid, true) ilike '%status%'
  )
order by table_name, constraint_name;
