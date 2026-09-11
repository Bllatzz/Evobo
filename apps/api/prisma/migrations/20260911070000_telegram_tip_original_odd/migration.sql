alter table public.telegram_tips add column original_odd numeric(6, 2);

-- Backfill: current odd is the best available approximation of "original"
-- for existing rows (exact for anything never manually edited; for rows
-- already manually edited we have no record of the true original, so this
-- just avoids a false "odd mudou" flag on them going forward).
update public.telegram_tips set original_odd = odd where odd is not null;
