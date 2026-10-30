-- The hotel's registered company name, and whether invoices show it.
--
-- A hotel often trades under one name (the brand guests know) and is
-- registered under another (the company that holds the GST number). A
-- company claiming GST input credit needs the registered name on the invoice.
--
-- legal_name is blank until the hotel types it. invoice_show_tax_id decides
-- whether the registered name and GST number print on invoices; it starts
-- on, because the GST number has always printed.
--
-- Safe to run more than once.

alter table properties add column if not exists legal_name text;
alter table properties add column if not exists invoice_show_tax_id boolean not null default true;

notify pgrst, 'reload schema';
