-- Separate bills for guests sharing a room: two colleagues in a twin room,
-- each with a bill of their own, paid on their own and invoiced to their own
-- company.
--
-- Switched on per booking. Every named guest is then a sharer: the room is
-- divided night by night by `room_share` (percent; blank shares divide what
-- is left evenly), and each service and payment belongs to one sharer's bill.
-- A service or payment with no `bill_guest_id` is on the primary guest's bill,
-- so everything recorded before the switch lands somewhere.
alter table reservations add column if not exists separate_bills boolean not null default false;

alter table reservation_guests add column if not exists room_share numeric(5, 2)
  check (room_share is null or (room_share >= 0 and room_share <= 100));
-- Who this sharer's invoices go to, when not the guest. The primary guest
-- falls back to the booking's own company.
alter table reservation_guests add column if not exists bill_company_id uuid references companies(id) on delete set null;

alter table reservation_extras add column if not exists bill_guest_id uuid references reservation_guests(id) on delete set null;
alter table reservation_payments add column if not exists bill_guest_id uuid references reservation_guests(id) on delete set null;

-- The city ledger looks up sharers billed to a company.
create index if not exists reservation_guests_bill_company_idx
  on reservation_guests (bill_company_id) where bill_company_id is not null;

notify pgrst, 'reload schema';
