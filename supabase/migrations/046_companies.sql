-- Companies and travel agents, and the rates contracted with them.
--
-- One list for both, told apart by `kind`: they are the same thing to the
-- desk -- someone other than the guest who books, may pay, and may have been
-- promised a rate -- and differ only in that an agent earns commission.
--
-- A contracted rate is a fixed price, never a discount off the public rate:
-- the hotel signed a number, and that number must not move when Dynamic
-- Pricing moves the public rate. It is priced like a rate plan -- per room
-- type and meal plan, a rate per adult up to the room's base adults, plus an
-- extra adult and child charge -- so it reads like everything else the desk
-- already knows.
--
-- Each line says when it applies: a date range, and optionally only some
-- weekdays and/or months. Where several lines cover a night, the most
-- specific wins (see src/lib/contractRates.js), so a contract can be a
-- year-round rate with a weekend line and a December line on top.

create table if not exists companies (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references properties(id) on delete cascade,

  kind               text not null default 'company'
    check (kind in ('company', 'travel_agent')),
  name               text not null,
  gstin              text,
  billing_address    text,
  city               text,
  state              text,
  postal_code        text,
  country            text,
  contact_person     text,
  email              text,
  phone              text,
  -- Travel agents only; a company earns none.
  commission_percent numeric(5,2) check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100)),
  notes              text,
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists companies_property_idx on companies (property_id, kind, lower(name));

create table if not exists company_rates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  room_type_id     uuid not null references room_types(id) on delete cascade,
  -- The meal plan. Null means the line holds whatever plan is booked.
  rate_plan_id     uuid references rate_plans(id) on delete cascade,

  valid_from       date not null,
  valid_to         date not null,
  -- 0 = Sunday .. 6 = Saturday, as JavaScript counts them. Null = every day.
  weekdays         smallint[],
  -- 1 = January .. 12 = December. Null = every month.
  months           smallint[],

  -- {"1": 3000, "2": 3500}: the price for that many adults, up to the room's
  -- base adults, matching rate_plan_rooms.adult_rates.
  adult_rates      jsonb not null default '{}'::jsonb,
  extra_adult_rate numeric(10,2),
  extra_child_rate numeric(10,2),
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (valid_to >= valid_from)
);

create index if not exists company_rates_company_idx on company_rates (company_id, room_type_id);

-- The booking's company or agent; who the invoice is addressed to; and the
-- commission agreed when it was booked, frozen so a later change to the
-- agent's terms does not rewrite what an old booking owes them.
alter table reservations
  add column if not exists company_id uuid references companies(id) on delete set null,
  add column if not exists bill_to text not null default 'guest',
  add column if not exists commission_percent numeric(5,2);

alter table reservations drop constraint if exists reservations_bill_to_check;
alter table reservations
  add constraint reservations_bill_to_check check (bill_to in ('guest', 'company'));

create index if not exists reservations_company_idx on reservations (company_id);

-- A tax invoice to a company must carry the hotel's own GSTIN as well as
-- the company's, or the company cannot claim the input credit.
alter table properties add column if not exists gstin text;

-- ---------------------------------------------------------------------------
-- The Companies & agents page (id "companies") sets rates, so it goes to
-- whoever already sets rates, not to every desk user. Picking a company on a
-- booking needs only a booking page.
-- ---------------------------------------------------------------------------

insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, 'companies', true
from user_modules um
where um.module_id in ('rateplans', 'cm')
  and um.enabled is not false
on conflict (user_id, module_id) do nothing;

update app_settings
set value = value || '["companies"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'companies';
