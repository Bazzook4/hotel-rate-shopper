-- Channel display order for the Rate Parity grid.
--
-- The grid ordered channels by whichever was cheapest anywhere in the window,
-- which reshuffles the rows every refresh: the channel a hotelier watches
-- most is wherever the week's prices happened to put it. This lets them fix
-- an order and keep it.
--
-- Keyed by `channel_key` rather than the channel's name because Google writes
-- the same channel several ways ("Booking.com", "booking.com ") and the key
-- is what `channelKey()` already collapses those into, so the ordering
-- survives a spelling change.
--
-- Channels a property has never ordered simply have no row here, and the grid
-- falls back to its cheapest-first ordering for them.

create table if not exists parity_channel_order (
  property_id  uuid not null references properties(id) on delete cascade,
  channel_key  text not null,
  -- Lower sorts first. Sparse by design: reordering rewrites every row for
  -- the property, so there is no need to renumber gaps.
  position     integer not null,
  updated_at   timestamptz not null default now(),

  primary key (property_id, channel_key)
);

-- The grid reads every row for one property at once, ordered.
create index if not exists parity_channel_order_property_idx
  on parity_channel_order (property_id, position);
