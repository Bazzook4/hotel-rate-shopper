-- Page opens: which pages get used, by which kind of user, so the menu can
-- be judged on how people really move around rather than on guesses.
--
-- Deliberately anonymous. A row is a page opened on a day, by a role
-- (SuperAdmin / PropertyAdmin / PropertyUser) and a job profile worked out
-- from the user's rights (owner, desk, housekeeping, other). There is no
-- user id, no session id and nothing the user typed, and users are told so
-- on the Users & rights page.
--
-- Written only by the server (service key); no policies, so the public API
-- can neither read nor write it.
--
-- Safe to run more than once.

create table if not exists page_opens (
  id bigint generated always as identity primary key,
  property_id uuid references properties(id) on delete cascade,
  page_id text not null,
  role text,
  profile text,
  opened_on date not null default current_date
);

create index if not exists page_opens_day on page_opens (opened_on, page_id);

alter table page_opens enable row level security;

-- To read the results, for example the last 14 days by profile:
--
--   select profile, page_id, count(*) as opens
--   from page_opens
--   where opened_on >= current_date - 14
--   group by profile, page_id
--   order by profile, opens desc;
