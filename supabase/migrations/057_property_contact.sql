-- The person who signed the hotel up, so Online Hotelier can call or
-- WhatsApp them later. Asked on the onboarding form; a super admin can
-- correct it under Admin > Properties.
alter table properties add column if not exists contact_name text;
alter table properties add column if not exists contact_phone text;

notify pgrst, 'reload schema';
