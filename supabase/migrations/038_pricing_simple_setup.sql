-- Dynamic pricing: two-question setup and auto weights.
--
-- A new hotel answers "how low will you go" (floor_pct of each room's base
-- rate) and "how bold" (max_change_pct, set by the Cautious / Balanced /
-- Aggressive choice). Signal weights are worked out from the property's own
-- booking history unless weights_mode is 'custom'.
--
-- Typed per-room floors and ceilings in pricing_bounds still win over the
-- percentages; they are now the exception rather than the setup.

alter table pricing_strategy
  add column if not exists weights_mode text not null default 'auto',
  add column if not exists floor_pct numeric(6, 2) not null default 70,
  add column if not exists ceiling_pct numeric(6, 2) not null default 250;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pricing_strategy_weights_mode_check') then
    alter table pricing_strategy add constraint pricing_strategy_weights_mode_check
      check (weights_mode in ('auto', 'custom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pricing_strategy_bounds_pct_check') then
    alter table pricing_strategy add constraint pricing_strategy_bounds_pct_check
      check (floor_pct > 0 and ceiling_pct >= floor_pct);
  end if;
end $$;

-- A property whose weights were changed from the old defaults keeps them:
-- someone chose those numbers, and switching them to auto would quietly
-- undo that choice.
update pricing_strategy
set weights_mode = 'custom'
where weight_compset <> 1.0
   or weight_occupancy <> 1.0
   or weight_weekday <> 0.5
   or weight_pickup <> 1.0
   or weight_adr_90 <> 0.5
   or weight_adr_ly <> 0.5
   or weight_events <> 1.0;
