-- Categorized bet market (Over/Under, 1X2, Handicap, BTTS, ...), separate
-- from the free-text `selection` OCR already extracts — see
-- apps/worker/src/ocrShared.ts's MARKET_TYPE_CATEGORIES.
alter table public.telegram_tips
  add column market_type text;
