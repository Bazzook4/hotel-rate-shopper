-- Inquiries: a stay the guest has asked about but not yet committed to.
--
-- An inquiry holds its room the way a confirmed booking does -- the channels
-- see one room fewer, and nobody else may be put in it -- so the desk can
-- promise the room while the guest decides. What it is not is revenue: it
-- has not been confirmed, so the performance reports leave it out until it
-- is. From here it is either confirmed or cancelled, which releases the room.

alter table reservations drop constraint if exists reservations_status_check;

alter table reservations add constraint reservations_status_check
  check (status in ('inquiry', 'confirmed', 'in_house', 'checked_out', 'cancelled', 'no_show'));
