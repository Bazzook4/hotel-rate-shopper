-- Closing the day, and who voided an invoice.
--
-- Night Audit is worked out live from the folios, so a day already audited
-- changed whenever a stay on it was edited later. Closing the day now keeps
-- a copy of the audit as it stood, with who closed it and the cash they
-- counted. One close per business date; the copy is never edited.
--
-- An invoice voided now records who voided it, as payments already do.
--
-- Safe to run more than once.

create table if not exists day_closes (
  id             uuid primary key default uuid_generate_v4(),
  property_id    uuid not null references properties(id) on delete cascade,
  business_date  date not null,
  closed_at      timestamptz not null default now(),
  closed_by      uuid references users(id) on delete set null,
  cash_counted   numeric(12, 2),
  snapshot       jsonb not null,
  unique (property_id, business_date)
);

alter table day_closes enable row level security;
drop policy if exists "Service role only on day_closes" on day_closes;
create policy "Service role only on day_closes" on day_closes for all using (true);

alter table reservation_invoices add column if not exists voided_by uuid references users(id) on delete set null;

notify pgrst, 'reload schema';
