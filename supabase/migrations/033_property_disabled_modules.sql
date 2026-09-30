-- Modules a property does not have, by page id ('parity', 'compshopper').
--
-- Page grants are per user, and a user with none sees every page, so they
-- cannot take a feature away from a whole property. This list can: the menu
-- hides these pages for everyone at the property and their API routes refuse.
-- Hotels that sign up through an onboarding link start without Rate Parity
-- and Competitor Shopper.
alter table properties
  add column if not exists disabled_modules text[] not null default '{}';
