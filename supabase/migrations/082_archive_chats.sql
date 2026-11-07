-- Archive a WhatsApp chat: it leaves the inbox list and counts, and comes
-- back by itself when that number writes in again. Safe to run more than once.

alter table wa_contacts add column if not exists archived_at timestamptz;

notify pgrst, 'reload schema';
