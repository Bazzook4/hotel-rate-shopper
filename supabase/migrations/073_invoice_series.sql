-- The invoice series a hotel numbers its invoices in.
--
-- invoice_prefix is the text before the number, for example "GH/25-26/".
-- Blank means the old form, "INV-<year>-".
--
-- invoice_next_number is a one-time start: the next invoice takes it, then
-- the field clears and numbering follows the highest number used.
--
-- Safe to run more than once.

alter table properties add column if not exists invoice_prefix text;
alter table properties add column if not exists invoice_next_number integer;

notify pgrst, 'reload schema';

-- A payment can be corrected after it is recorded (amount, method,
-- reference). Each correction keeps what the payment said before, who changed
-- it and when, so a cash-up can still be explained.
alter table reservation_payments add column if not exists edit_log jsonb not null default '[]'::jsonb;
alter table reservation_payments add column if not exists edited_at timestamptz;

notify pgrst, 'reload schema';

-- A booking can say whether its rate includes tax or has tax added on top.
-- Blank follows the hotel's own tax setup.
alter table reservations add column if not exists rate_tax_mode text
  check (rate_tax_mode in ('inclusive', 'exclusive'));

notify pgrst, 'reload schema';
