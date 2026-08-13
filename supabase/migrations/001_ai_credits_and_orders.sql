begin;

create extension if not exists pgcrypto;

create table if not exists public.ai_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  free_credits_granted integer not null default 0 check (free_credits_granted between 0 and 3),
  account_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  transaction_type text not null check (transaction_type in (
    'free_grant','purchase','story_reserve','story_commit','story_release','refund','manual_adjustment'
  )),
  reference_type text not null,
  reference_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (reference_type, reference_id, transaction_type)
);

create index if not exists ai_credit_transactions_user_created_idx
  on public.ai_credit_transactions(user_id, created_at desc);

create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  paypal_order_id text unique,
  paypal_capture_id text unique,
  product_id text not null check (product_id in ('story_credits_10','story_credits_30')),
  expected_amount numeric(10,2) not null check (expected_amount > 0),
  expected_currency text not null check (expected_currency = 'USD'),
  status text not null default 'created' check (status in (
    'created','approved','completed','refunded','reversed','disputed','failed'
  )),
  credits integer not null check (credits > 0),
  balance_after integer,
  payer_email text,
  raw_capture_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists paypal_orders_user_created_idx
  on public.paypal_orders(user_id, created_at desc);

create table if not exists public.story_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  prayer_name text not null check (prayer_name in ('Fajr','Dhuhr','Asr','Maghrib','Isha')),
  selected_state text not null check (selected_state in ('busy','tired','rhythm','distant','quiet','unknown')),
  model_name text not null,
  status text not null check (status in ('reserved','generating','completed','failed','released')),
  credit_reserved boolean not null default false,
  title text,
  body text,
  visual_facts jsonb,
  atmosphere text,
  photo_relevance text check (photo_relevance in ('high','medium','low')),
  safety_flags jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_id)
);

create index if not exists story_generations_user_created_idx
  on public.story_generations(user_id, created_at desc);

create table if not exists public.paypal_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text
);

alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_transactions enable row level security;
alter table public.paypal_orders enable row level security;
alter table public.story_generations enable row level security;
alter table public.paypal_webhook_events enable row level security;

revoke all on public.ai_credit_accounts from anon, authenticated;
revoke all on public.ai_credit_transactions from anon, authenticated;
revoke all on public.paypal_orders from anon, authenticated;
revoke all on public.story_generations from anon, authenticated;
revoke all on public.paypal_webhook_events from anon, authenticated;

grant select, insert, update, delete on public.ai_credit_accounts to service_role;
grant select, insert, update, delete on public.ai_credit_transactions to service_role;
grant select, insert, update, delete on public.paypal_orders to service_role;
grant select, insert, update, delete on public.story_generations to service_role;
grant select, insert, update, delete on public.paypal_webhook_events to service_role;

create or replace function public.ensure_credit_account(p_user_id uuid)
returns table(balance integer, account_hold boolean, free_credits_granted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ai_credit_accounts(user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  return query select a.balance, a.account_hold, a.free_credits_granted
    from public.ai_credit_accounts a where a.user_id = p_user_id;
end;
$$;

create or replace function public.grant_initial_free_credits(p_user_id uuid)
returns table(balance integer, account_hold boolean, free_credits_granted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.ai_credit_accounts%rowtype;
begin
  insert into public.ai_credit_accounts(user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select * into account from public.ai_credit_accounts where user_id = p_user_id for update;
  if account.free_credits_granted = 0 and not exists (
    select 1 from public.ai_credit_transactions t
      where t.reference_type = 'user'
        and t.reference_id = p_user_id::text
        and t.transaction_type = 'free_grant'
  ) then
    update public.ai_credit_accounts as a
      set balance = a.balance + 3, free_credits_granted = 3, updated_at = now()
      where a.user_id = p_user_id returning a.* into account;
    insert into public.ai_credit_transactions(user_id, delta, balance_after, transaction_type, reference_type, reference_id)
      values (p_user_id, 3, account.balance, 'free_grant', 'user', p_user_id::text);
  elsif account.free_credits_granted = 0 then
    update public.ai_credit_accounts as a
      set free_credits_granted = 3, updated_at = now()
      where a.user_id = p_user_id returning a.* into account;
  end if;
  return query select account.balance, account.account_hold, account.free_credits_granted;
end;
$$;

create or replace function public.reserve_story_credit(p_user_id uuid, p_request_id uuid)
returns table(balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.ai_credit_accounts%rowtype;
begin
  select * into account from public.ai_credit_accounts where user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if exists(select 1 from public.ai_credit_transactions where reference_type='story' and reference_id=p_request_id::text and transaction_type='story_reserve') then
    return query select account.balance; return;
  end if;
  if account.account_hold then raise exception 'ACCOUNT_HOLD'; end if;
  if account.balance < 1 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  if not exists(select 1 from public.story_generations where user_id=p_user_id and request_id=p_request_id) then
    raise exception 'GENERATION_NOT_FOUND';
  end if;
  update public.ai_credit_accounts as a set balance=a.balance-1, updated_at=now()
    where a.user_id=p_user_id returning a.* into account;
  insert into public.ai_credit_transactions(user_id,delta,balance_after,transaction_type,reference_type,reference_id)
    values(p_user_id,-1,account.balance,'story_reserve','story',p_request_id::text);
  update public.story_generations set credit_reserved=true,status='generating'
    where user_id=p_user_id and request_id=p_request_id;
  return query select account.balance;
end;
$$;

create or replace function public.commit_story_credit(
  p_user_id uuid, p_request_id uuid, p_title text, p_body text,
  p_visual_facts jsonb, p_atmosphere text, p_photo_relevance text, p_safety_flags jsonb
)
returns table(balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.ai_credit_accounts%rowtype;
begin
  select * into account from public.ai_credit_accounts where user_id=p_user_id for update;
  if exists(select 1 from public.ai_credit_transactions where reference_type='story' and reference_id=p_request_id::text and transaction_type='story_commit') then
    return query select account.balance; return;
  end if;
  if not exists(select 1 from public.ai_credit_transactions where user_id=p_user_id and reference_type='story' and reference_id=p_request_id::text and transaction_type='story_reserve') then
    raise exception 'CREDIT_NOT_RESERVED';
  end if;
  update public.story_generations set status='completed',credit_reserved=false,title=p_title,body=p_body,
    visual_facts=p_visual_facts,atmosphere=p_atmosphere,photo_relevance=p_photo_relevance,
    safety_flags=p_safety_flags,error_code=null,completed_at=now()
    where user_id=p_user_id and request_id=p_request_id;
  insert into public.ai_credit_transactions(user_id,delta,balance_after,transaction_type,reference_type,reference_id)
    values(p_user_id,0,account.balance,'story_commit','story',p_request_id::text);
  return query select account.balance;
end;
$$;

create or replace function public.release_story_credit(p_user_id uuid, p_request_id uuid, p_error_code text)
returns table(balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.ai_credit_accounts%rowtype;
begin
  select * into account from public.ai_credit_accounts where user_id=p_user_id for update;
  if exists(select 1 from public.ai_credit_transactions where reference_type='story' and reference_id=p_request_id::text and transaction_type in ('story_release','story_commit')) then
    return query select account.balance; return;
  end if;
  if exists(select 1 from public.ai_credit_transactions where user_id=p_user_id and reference_type='story' and reference_id=p_request_id::text and transaction_type='story_reserve') then
    update public.ai_credit_accounts as a set balance=a.balance+1,updated_at=now()
      where a.user_id=p_user_id returning a.* into account;
    insert into public.ai_credit_transactions(user_id,delta,balance_after,transaction_type,reference_type,reference_id,metadata)
      values(p_user_id,1,account.balance,'story_release','story',p_request_id::text,jsonb_build_object('error_code',p_error_code));
  end if;
  update public.story_generations set status='released',credit_reserved=false,error_code=p_error_code,completed_at=now()
    where user_id=p_user_id and request_id=p_request_id and status <> 'completed';
  return query select account.balance;
end;
$$;

create or replace function public.grant_purchase_credits(
  p_user_id uuid, p_order_id uuid, p_capture_id text, p_amount text, p_currency text,
  p_payer_email text, p_raw_summary jsonb
)
returns table(credits_added integer, balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare order_row public.paypal_orders%rowtype; account public.ai_credit_accounts%rowtype;
begin
  select * into order_row from public.paypal_orders where id=p_order_id for update;
  if not found or order_row.user_id<>p_user_id then raise exception 'ORDER_NOT_FOUND'; end if;
  insert into public.ai_credit_accounts(user_id) values(p_user_id) on conflict do nothing;
  select * into account from public.ai_credit_accounts where user_id=p_user_id for update;
  if order_row.status='completed' then return query select 0,account.balance; return; end if;
  if order_row.expected_amount<>p_amount::numeric or order_row.expected_currency<>p_currency then raise exception 'ORDER_MISMATCH'; end if;
  if exists(select 1 from public.paypal_orders where paypal_capture_id=p_capture_id and id<>p_order_id) then raise exception 'CAPTURE_ALREADY_USED'; end if;
  update public.ai_credit_accounts as a set balance=a.balance+order_row.credits,updated_at=now()
    where a.user_id=p_user_id returning a.* into account;
  update public.paypal_orders set paypal_capture_id=p_capture_id,status='completed',payer_email=p_payer_email,
    raw_capture_summary=p_raw_summary,balance_after=account.balance,updated_at=now() where id=p_order_id;
  insert into public.ai_credit_transactions(user_id,delta,balance_after,transaction_type,reference_type,reference_id,metadata)
    values(p_user_id,order_row.credits,account.balance,'purchase','paypal_order',p_order_id::text,jsonb_build_object('capture_id',p_capture_id));
  return query select order_row.credits,account.balance;
end;
$$;

create or replace function public.process_refund_adjustment(
  p_paypal_order_id text, p_event_id text, p_new_status text
)
returns table(balance integer, account_hold boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare order_row public.paypal_orders%rowtype; account public.ai_credit_accounts%rowtype; debit integer;
begin
  if p_new_status not in ('refunded','reversed') then raise exception 'INVALID_REFUND_STATUS'; end if;
  select * into order_row from public.paypal_orders where paypal_order_id=p_paypal_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into account from public.ai_credit_accounts where user_id=order_row.user_id for update;
  if exists(select 1 from public.ai_credit_transactions where reference_type='paypal_order' and reference_id=order_row.id::text and transaction_type='refund') then
    return query select account.balance,account.account_hold; return;
  end if;
  debit=least(account.balance,order_row.credits);
  update public.ai_credit_accounts as a set balance=a.balance-debit,
    account_hold=(a.account_hold or debit<order_row.credits),updated_at=now()
    where a.user_id=order_row.user_id returning a.* into account;
  update public.paypal_orders set status=p_new_status,updated_at=now() where id=order_row.id;
  insert into public.ai_credit_transactions(user_id,delta,balance_after,transaction_type,reference_type,reference_id,metadata)
    values(order_row.user_id,-debit,account.balance,'refund','paypal_order',order_row.id::text,
      jsonb_build_object('event_id',p_event_id,'unrecovered_credits',order_row.credits-debit));
  return query select account.balance,account.account_hold;
end;
$$;

revoke all on function public.ensure_credit_account(uuid) from public;
revoke all on function public.grant_initial_free_credits(uuid) from public;
revoke all on function public.reserve_story_credit(uuid,uuid) from public;
revoke all on function public.commit_story_credit(uuid,uuid,text,text,jsonb,text,text,jsonb) from public;
revoke all on function public.release_story_credit(uuid,uuid,text) from public;
revoke all on function public.grant_purchase_credits(uuid,uuid,text,text,text,text,jsonb) from public;
revoke all on function public.process_refund_adjustment(text,text,text) from public;

revoke all on function public.ensure_credit_account(uuid) from anon, authenticated;
revoke all on function public.grant_initial_free_credits(uuid) from anon, authenticated;
revoke all on function public.reserve_story_credit(uuid,uuid) from anon, authenticated;
revoke all on function public.commit_story_credit(uuid,uuid,text,text,jsonb,text,text,jsonb) from anon, authenticated;
revoke all on function public.release_story_credit(uuid,uuid,text) from anon, authenticated;
revoke all on function public.grant_purchase_credits(uuid,uuid,text,text,text,text,jsonb) from anon, authenticated;
revoke all on function public.process_refund_adjustment(text,text,text) from anon, authenticated;

grant execute on function public.ensure_credit_account(uuid) to service_role;
grant execute on function public.grant_initial_free_credits(uuid) to service_role;
grant execute on function public.reserve_story_credit(uuid,uuid) to service_role;
grant execute on function public.commit_story_credit(uuid,uuid,text,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.release_story_credit(uuid,uuid,text) to service_role;
grant execute on function public.grant_purchase_credits(uuid,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.process_refund_adjustment(text,text,text) to service_role;

commit;
