-- A room that is part of another room: a villa and the rooms inside it.
--
-- parent_room_id on a room names the villa it belongs to. Selling the villa
-- takes all its rooms off sale; selling or blocking one room takes the villa
-- off sale. The rooms stay free of each other. Each is its own room type, so
-- the villa and its rooms have their own rates.
--
-- One level only. Blank means a room on its own, as before.
--
-- Safe to run more than once.

alter table rooms add column if not exists parent_room_id uuid references rooms(id) on delete set null;

create index if not exists rooms_parent_idx on rooms (parent_room_id);

notify pgrst, 'reload schema';
