-- The city ledger: what companies and agents owe for stays billed to them,
-- and the money they send.
--
-- What is owed is never stored. A stay billed to a company is a folio like
-- any other, and its balance is worked out from its nights, lines, taxes and
-- payments on every read -- so the ledger can never disagree with the bill
-- the desk sees when it opens the stay.
--
-- What is stored is the money: a company pays one lump sum for many stays,
-- so a receipt is recorded once, against the company, and applied to its
-- stays as ordinary payments carrying the receipt's id. Whatever is not
-- applied yet stays on the receipt as credit, to apply to the next bills.
-- Voiding a receipt voids every payment it made, so nothing is left half
-- undone.

-- Credit terms: how many days after a bill the company has to pay, and how
-- much it may owe before the desk should ask for payment first.
alter table companies
  add column if not exists credit_days integer check (credit_days is null or credit_days >= 0),
  add column if not exists credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0);

create table if not exists city_ledger_receipts (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete restrict,

  amount       numeric(12,2) not null check (amount > 0),
  method       text not null default 'bank_transfer'
    check (method in ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  -- The UTR, cheque number or whatever traces the money.
  reference    text,
  received_on  date not null default current_date,
  notes        text,
  recorded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Voided, never deleted: a receipt that vanished would leave the bank
  -- statement with a line nothing in the hotel accounts for.
  voided_at    timestamptz,
  void_reason  text,
  voided_by    uuid references users(id) on delete set null
);

create index if not exists city_ledger_receipts_company_idx
  on city_ledger_receipts (property_id, company_id, received_on);

alter table reservation_payments
  add column if not exists receipt_id uuid references city_ledger_receipts(id) on delete restrict;

create index if not exists reservation_payments_receipt_idx on reservation_payments (receipt_id);

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
