-- Payments are voided, not deleted.
--
-- Until now a payment taken off a folio simply vanished, which is the one
-- thing a cash drawer cannot afford: at the end of the shift the desk has
-- less money than the folios say, or more, and nothing records why. A
-- payment recorded in error is now voided the way an invoice already is --
-- it stops counting towards what the guest has paid, but the row stays, with
-- who voided it, when and why, so the payments report and the night audit
-- can show it.

alter table reservation_payments add column if not exists voided_at   timestamptz;
alter table reservation_payments add column if not exists void_reason text;
alter table reservation_payments add column if not exists voided_by   uuid
  references users(id) on delete set null;

-- The payments report and the night audit read payments by the moment they
-- were taken, across every stay, rather than one stay at a time.
create index if not exists reservation_payments_paid_at_idx
  on reservation_payments (paid_at);

-- And the invoice register reads invoices the same way, per property.
create index if not exists reservation_invoices_property_issued_idx
  on reservation_invoices (property_id, issued_at);
