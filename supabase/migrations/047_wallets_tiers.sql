-- Wallets, wallet plans, guest tiers, and company credit terms.
--
-- (This migration replaces the first draft of 047, which kept a separate
-- table of company receipts. It was never run; if it was, run this anyway --
-- every statement is safe to repeat, and the old table is dropped at the end
-- only when it holds nothing.)
--
-- A WALLET is prepaid credit held by a guest, a company or a travel agent.
-- Money goes in as a top-up -- often on a plan, "pay 10,000, get 11,000" --
-- and comes out as a payment on a booking's bill, room or services alike.
--
-- Two numbers are kept apart on every top-up, because they are different
-- facts: the money actually paid (`cash_amount`, what the cash-up and the
-- bank see) and the credit given (`credit`, what the wallet can spend). The
-- difference is the bonus. A bill paid from a wallet is a payment with method
-- 'wallet', which the Payments report shows apart from cash, so money is
-- counted once -- when it was received -- and never again when it is spent.
--
-- The balance is never stored: credit from top-ups and adjustments, less the
-- wallet payments on bills that still stand. Voiding a wallet payment on a
-- bill therefore puts the money back in the wallet by itself.
--
-- For a company or agent the wallet IS its City Ledger credit: money it sends
-- is a top-up, and applying it to its bills is paying them from the wallet.

-- ---------------------------------------------------------------------------
-- Company credit terms
-- ---------------------------------------------------------------------------

alter table companies
  add column if not exists credit_days integer check (credit_days is null or credit_days >= 0),
  add column if not exists credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0);

-- ---------------------------------------------------------------------------
-- Guest tiers: labels the desk gives a guest, shown as a badge.
-- ---------------------------------------------------------------------------

create table if not exists guest_tiers (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name        text not null,
  -- One of the badge colours the app offers (see GuestTiers.jsx), so the
  -- badge follows the light and dark themes.
  tone        text not null default 'gold'
    check (tone in ('gold', 'green', 'blue', 'purple', 'grey')),
  sort_order  integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists guest_tiers_property_idx on guest_tiers (property_id, sort_order);

alter table guests
  add column if not exists tier_id uuid references guest_tiers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Wallet plans: the offers a top-up can be sold on.
-- ---------------------------------------------------------------------------

create table if not exists wallet_plans (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name        text not null,
  pay_amount  numeric(12,2) not null check (pay_amount > 0),
  credit      numeric(12,2) not null check (credit > 0),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wallet_plans_property_idx on wallet_plans (property_id);

-- ---------------------------------------------------------------------------
-- Wallet transactions: what went into a wallet.
-- ---------------------------------------------------------------------------

create table if not exists wallet_transactions (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  -- Exactly one owner: a guest, or a company / agent.
  guest_id     uuid references guests(id) on delete restrict,
  company_id   uuid references companies(id) on delete restrict,

  -- topup   money paid in, on a plan or not
  -- adjust  a correction by hand, up or down; no money changes hands
  kind         text not null check (kind in ('topup', 'adjust')),
  credit       numeric(12,2) not null,
  cash_amount  numeric(12,2) not null default 0,
  method       text check (method in ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  reference    text,
  plan_id      uuid references wallet_plans(id) on delete set null,
  received_on  date not null default current_date,
  notes        text,
  recorded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Voided, never deleted: a top-up that vanished would leave money in the
  -- bank that nothing in the hotel's records accounts for.
  voided_at    timestamptz,
  void_reason  text,
  voided_by    uuid references users(id) on delete set null,

  check ((guest_id is null) <> (company_id is null)),
  check (kind <> 'topup' or (credit > 0 and cash_amount >= 0 and method is not null))
);

create index if not exists wallet_tx_guest_idx on wallet_transactions (guest_id);
create index if not exists wallet_tx_company_idx on wallet_transactions (company_id);
create index if not exists wallet_tx_property_idx on wallet_transactions (property_id, received_on);

-- A bill paid from a wallet: method 'wallet', and whose wallet it came from.
alter table reservation_payments
  add column if not exists wallet_guest_id uuid references guests(id) on delete restrict,
  add column if not exists wallet_company_id uuid references companies(id) on delete restrict;

alter table reservation_payments drop constraint if exists reservation_payments_method_check;
alter table reservation_payments
  add constraint reservation_payments_method_check
  check (method in ('cash', 'card', 'upi', 'bank_transfer', 'ota', 'wallet', 'other'));

create index if not exists reservation_payments_wallet_guest_idx on reservation_payments (wallet_guest_id);
create index if not exists reservation_payments_wallet_company_idx on reservation_payments (wallet_company_id);

-- The first draft's receipts table, if it was created and never used.
do $$
begin
  if to_regclass('public.city_ledger_receipts') is not null then
    if not exists (select 1 from city_ledger_receipts) then
      alter table reservation_payments drop column if exists receipt_id;
      drop table city_ledger_receipts;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The City Ledger page (id "cityledger") is money work, so it goes to
-- whoever already sees Payments or Invoicing.
-- ---------------------------------------------------------------------------

insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, 'cityledger', true
from user_modules um
where um.module_id in ('payments', 'invoicing')
  and um.enabled is not false
on conflict (user_id, module_id) do nothing;

update app_settings
set value = value || '["cityledger"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'cityledger';
