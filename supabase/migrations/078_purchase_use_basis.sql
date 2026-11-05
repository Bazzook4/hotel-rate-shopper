-- How a used-up item is given out: every night a guest stays (a towel
-- change), or once per guest at check-in however long the stay (soap).
alter table stock_items
  add column if not exists use_basis text not null default 'night'
  check (use_basis in ('night', 'stay'));

notify pgrst, 'reload schema';
