-- Room order, and housekeeping as front-office work.
--
-- Migration 023 gave rooms a number and a floor but no order, so every list
-- sorted `room_number` as text -- which puts "1001" before "201" and "G2"
-- wherever the alphabet says. The desk reads rooms in the order it walks the
-- building, and only the hotel knows that order, so it is stored.
--
-- Housekeeping status already lives on `rooms`; what it lacked was a trail.
-- Once the status is changed from the front office by whoever cleaned or
-- inspected the room, "who said 204 was ready, and when" is the first thing
-- asked when a guest walks into one that is not.

alter table rooms add column if not exists sort_order integer not null default 0;

alter table rooms add column if not exists housekeeping_updated_at timestamptz;
alter table rooms add column if not exists housekeeping_updated_by uuid
  references users(id) on delete set null;

-- Seed the order from what the hotel already has: by floor, then by room
-- number compared as a number where it is one, so 99 precedes 100. Spaced by
-- ten so a room can later be slotted between two without renumbering both.
-- Only rooms still on the default are touched, so re-running this is safe.
with ordered as (
  select
    id,
    row_number() over (
      partition by property_id
      order by
        floor nulls first,
        nullif(regexp_replace(room_number, '\D', '', 'g'), '')::bigint nulls last,
        room_number
    ) * 10 as pos
  from rooms
)
update rooms r
   set sort_order = o.pos
  from ordered o
 where r.id = o.id
   and r.sort_order = 0;

create index if not exists rooms_property_order_idx on rooms (property_id, sort_order);
