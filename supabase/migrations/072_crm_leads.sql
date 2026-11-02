-- CRM: every number that writes in and is not a hotel on our system is a
-- lead. Statuses on wa_leads.status: new, contacted, no_contact, won, lost.
-- New leads are made by the webhook from now on; this adds the ones that
-- wrote in before. A chat we already answered by hand starts at contacted.
--
-- Needs 064_whatsapp. Safe to run more than once.

insert into wa_leads (phone, step, status, created_at)
select c.phone,
       'done',
       case when exists (
         select 1 from wa_messages m
         where m.phone = c.phone and m.direction = 'out'
           and m.sent_by is not null and m.sent_by <> 'ai'
       ) then 'contacted' else 'new' end,
       c.created_at
from wa_contacts c
where c.property_id is null
  and not exists (select 1 from wa_leads l where l.phone = c.phone);

notify pgrst, 'reload schema';
