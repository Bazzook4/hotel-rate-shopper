-- Purchases: the things the hotel buys and uses up (soap, towels, a TV).
--
-- kind:
--   consumable  used up by guests (soap, brush); drops by itself per guest night
--   longlife    lasts months (towels, linen); counted, replaced after a while
--   asset       bought once (TV, geyser); logged, with a replace-after time
--
-- What is in stock is never stored: it is the last count, plus what was
-- bought since, minus what was used since, minus the per-guest-night use
-- times the guest nights since. A purchase with a cost also posts an
-- expense in the cash book, so money is entered once.
create table if not exists stock_items (
  id               uuid        primary key default gen_random_uuid(),
  property_id      uuid        not null references properties(id) on delete cascade,
  name             text        not null,
  kind             text        not null default 'consumable'
    check (kind in ('consumable', 'longlife', 'asset')),
  unit             text        not null default 'pcs',
  per_guest_night  numeric(10, 3) not null default 0 check (per_guest_night >= 0),
  reorder_level    numeric(12, 2) not null default 0 check (reorder_level >= 0),
  replace_after_months integer check (replace_after_months > 0),
  created_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index if not exists stock_items_property_idx on stock_items (property_id);

create table if not exists stock_moves (
  id           uuid        primary key default gen_random_uuid(),
  property_id  uuid        not null references properties(id) on delete cascade,
  item_id      uuid        not null references stock_items(id) on delete cascade,
  -- count: what was counted on the shelf (the new starting point)
  -- purchase: bought, added to stock
  -- used: taken out by hand (damaged, lost, given away)
  kind         text        not null check (kind in ('count', 'purchase', 'used')),
  qty          numeric(12, 2) not null check (qty >= 0),
  move_date    date        not null,
  cost         numeric(12, 2) check (cost >= 0),
  supplier     text,
  notes        text,
  cash_entry_id uuid       references cash_entries(id) on delete set null,
  recorded_by  uuid        references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz
);
create index if not exists stock_moves_item_idx on stock_moves (item_id, created_at);
create index if not exists stock_moves_property_idx on stock_moves (property_id, move_date);

alter table stock_items enable row level security;
alter table stock_moves enable row level security;
drop policy if exists "Service role only on stock_items" on stock_items;
create policy "Service role only on stock_items" on stock_items for all using (true);
drop policy if exists "Service role only on stock_moves" on stock_moves;
create policy "Service role only on stock_moves" on stock_moves for all using (true);

notify pgrst, 'reload schema';
