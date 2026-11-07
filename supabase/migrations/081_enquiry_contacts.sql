-- Every new enquiry becomes a contact.
--
-- A number that writes in makes a wa_leads row (the enquiry). From now on the
-- same moment makes, or tops up, its crm_contacts row: name, phone, email and
-- hotel details. Anything the desk already typed on the contact is never
-- overwritten, only blanks are filled. Email is new on both tables.
--
-- Needs 064_whatsapp and 074_crm_contacts_deals. Safe to run more than once.

alter table wa_leads add column if not exists email text;
alter table crm_contacts add column if not exists email text;

create or replace function wa_lead_to_contact() returns trigger
language plpgsql as $$
begin
  insert into crm_contacts (phone, name, email, hotel_name, city, rooms, current_otas, interest)
  values (
    new.phone,
    (select c.name from wa_contacts c where c.phone = new.phone),
    new.email, new.hotel_name, new.city, new.rooms, new.current_otas, new.interest
  )
  on conflict (phone) do update set
    name         = coalesce(crm_contacts.name, excluded.name),
    email        = coalesce(crm_contacts.email, excluded.email),
    hotel_name   = coalesce(crm_contacts.hotel_name, excluded.hotel_name),
    city         = coalesce(crm_contacts.city, excluded.city),
    rooms        = coalesce(crm_contacts.rooms, excluded.rooms),
    current_otas = coalesce(crm_contacts.current_otas, excluded.current_otas),
    interest     = coalesce(crm_contacts.interest, excluded.interest),
    updated_at   = now();
  return new;
end $$;

drop trigger if exists wa_leads_to_contact on wa_leads;
create trigger wa_leads_to_contact
  after insert or update on wa_leads
  for each row execute function wa_lead_to_contact();

-- Enquiries that came in before this: one contact each, newest details win.
insert into crm_contacts (phone, name, hotel_name, city, rooms, current_otas, interest, created_at)
select distinct on (l.phone) l.phone, c.name, l.hotel_name, l.city, l.rooms, l.current_otas, l.interest, l.created_at
from wa_leads l
left join wa_contacts c on c.phone = l.phone
where not exists (select 1 from crm_contacts k where k.phone = l.phone)
order by l.phone, l.created_at desc;

notify pgrst, 'reload schema';
