-- A guest's photo ID: pictures or a PDF of the ID they showed at the desk.
--
-- Until now a guest record held the ID type and number only, so the copy the
-- desk takes at check-in lived in a drawer or on someone's phone.
--
-- The files are kept in a private storage bucket, guest-ids, under
-- <property id>/<guest id>/. Nothing in it is public: the page is handed a
-- link that expires after a few minutes, and only to someone who can open
-- the Guests page. The app also creates the bucket itself if it is missing.
--
-- id_photos lists the files, oldest first, so the Guests page can say how
-- many a guest has without asking storage for every row:
--   [{ "path": "...", "name": "aadhaar-front.jpg", "type": "image/jpeg",
--      "size": 182044, "uploaded_at": "2026-10-18T09:12:00Z" }]

alter table guests
  add column if not exists id_photos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('guest-ids', 'guest-ids', false)
on conflict (id) do nothing;
