-- Rights are given, never assumed.
--
-- Until now a user with no pages ticked saw every page. From here on a user
-- sees exactly the pages they hold, a PropertyUser never more than their
-- property's admins hold, and a super admin sets what the admins hold.
--
-- Run this BEFORE deploying the code that goes with it: without the backfill
-- below, everyone who relied on "nothing ticked" would see an empty dashboard.

-- Settings kept in the database so a super admin can change them from the
-- app: the rights an onboarded hotel's admin starts with.
create table if not exists app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

drop policy if exists "Service role only on app_settings" on app_settings;
create policy "Service role only on app_settings" on app_settings
  for all to service_role using (true);

insert into app_settings (key, value) values (
  'default_admin_modules',
  '["calendar","reservations","housekeeping","cm","integrations","logs","pricing",
    "performance","nightaudit","invoicing","payments","setup","rooms","rateplans",
    "pmssetup","servicesetup","taxsetup"]'::jsonb
) on conflict (key) do nothing;

-- Everyone who was relying on "nothing ticked means everything" -- no grants
-- at all, or only ids for pages that no longer exist -- is given every page,
-- so nobody loses access on the day this ships. Legacy ids that still map to
-- a page (disparity, ratetracker, compare, location) count as real grants.
insert into user_modules (user_id, module_id, enabled)
select u.id, m.module_id, true
from users u
cross join unnest(array[
  'calendar','reservations','housekeeping','cm','integrations','logs','parity',
  'compshopper','pricing','performance','nightaudit','invoicing','payments',
  'setup','rooms','rateplans','pmssetup','servicesetup','taxsetup'
]) as m(module_id)
where u.role not in ('SuperAdmin', 'Admin')
  and not exists (
    select 1 from user_modules um
    where um.user_id = u.id
      and um.enabled is not false
      and um.module_id in (
        'calendar','reservations','housekeeping','cm','integrations','logs','parity',
        'compshopper','pricing','performance','nightaudit','invoicing','payments',
        'setup','rooms','rateplans','pmssetup','servicesetup','taxsetup',
        'disparity','ratetracker','compare','location'
      )
  )
-- A row switched off for one of these pages is switched back on.
on conflict (user_id, module_id) do update set enabled = true;
