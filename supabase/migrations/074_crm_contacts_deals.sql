-- CRM as contacts and deals.
--
-- A lead is someone who wrote in (wa_leads: new, contacted, no_contact).
-- Once developed, Convert makes a contact (the person and their hotel) and
-- a deal for them. Deals move through demo, link_sent, won, lost. A converted
-- lead keeps its row with status 'converted', so the bot never makes a second
-- lead for the same number. Won and Lost leave wa_leads and become deals:
-- the ones already there are converted below.
--
-- Needs 064_whatsapp. Safe to run more than once.

create table if not exists crm_contacts (
  id bigint generated always as identity primary key,
  phone text unique,
  name text,
  hotel_name text,
  city text,
  rooms int,
  current_otas text,
  interest text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm_deals (
  id bigint generated always as identity primary key,
  contact_id bigint not null references crm_contacts(id) on delete cascade,
  stage text not null default 'demo',
  note text,
  next_follow_up date,
  property_id uuid references properties(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_deals_contact on crm_deals (contact_id);
create index if not exists crm_deals_stage on crm_deals (stage);

alter table crm_contacts enable row level security;
alter table crm_deals enable row level security;

-- Leads already marked Won or Lost become a contact with a closed deal.
insert into crm_contacts (phone, name, hotel_name, city, rooms, current_otas, interest)
select distinct on (l.phone) l.phone, c.name, l.hotel_name, l.city, l.rooms, l.current_otas, l.interest
from wa_leads l
left join wa_contacts c on c.phone = l.phone
where l.status in ('won', 'lost')
  and not exists (select 1 from crm_contacts k where k.phone = l.phone)
order by l.phone, l.created_at desc;

insert into crm_deals (contact_id, stage, property_id, closed_at, created_at)
select k.id, l.status, c.property_id, l.updated_at, l.created_at
from wa_leads l
join crm_contacts k on k.phone = l.phone
left join wa_contacts c on c.phone = l.phone
where l.status in ('won', 'lost')
  and not exists (select 1 from crm_deals d where d.contact_id = k.id);

update wa_leads set status = 'converted' where status in ('won', 'lost');

notify pgrst, 'reload schema';
