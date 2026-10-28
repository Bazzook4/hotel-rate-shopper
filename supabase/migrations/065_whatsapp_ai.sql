-- WhatsApp AI replies: the assistant chats in its own words and saves what
-- it learns about a lead, and hands a chat to SJ when it should not answer.
--
-- wa_leads.current_otas      which OTAs the hotel uses today, as they said it
-- wa_contacts.handoff_at     when the assistant handed this chat to SJ; set
--                            until SJ replies or turns the bot back on, and
--                            what puts the chat at the top of the inbox
-- wa_contacts.handoff_reason why, in the assistant's words
--
-- Needs 064_whatsapp. Safe to run more than once.

alter table wa_leads add column if not exists current_otas text;
alter table wa_contacts add column if not exists handoff_at timestamptz;
alter table wa_contacts add column if not exists handoff_reason text;

notify pgrst, 'reload schema';
