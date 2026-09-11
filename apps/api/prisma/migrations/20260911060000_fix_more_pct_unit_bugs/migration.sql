-- More rows hit by the same pre-fix percentage-parsing bugs already fixed
-- in parseTip.ts (see the 20260911050000 migration for the first instance):
--   - "aumento de N%" boost commentary overwriting the real unit-sizing %
--     (bc30d63f, e9427914 below; the earlier migration fixed the first one
--     found, this fixes two more the user found afterward).
--   - a tipster revising odd/% inline ("nova ODD 2.10") not being picked up
--     over the original stale value (c335aaeb below).
-- Also deletes 3 phantom rows: old chat/correction messages ("Podem colocar
-- 2.50% nessa...") that predate the hasLink gating and should never have
-- become tips — all still pending/never taken, so removing them has no
-- effect on any resolved banca math.
update public.telegram_tips set unit = 1.5
  where id = '6b38b4ec-59dc-4b45-a55a-40e11ef31681';
update public.telegram_tips set unit = 1
  where id = 'bc30d63f-612e-484f-ab34-27f062b8764c';
update public.telegram_tips set unit = 1
  where id = 'e9427914-7def-494d-b6a6-2d5726c0c827';
update public.telegram_tips set unit = 5.2, odd = 2.1, odd_source = 'text'
  where id = 'c335aaeb-a935-46b6-ae38-14c3ffd8a6d5';

delete from public.telegram_tips
  where id in (
    '85c5c945-d0dd-412d-bce8-2a012ced342c',
    'd367f959-b51d-406a-af74-512a8be18475',
    '4703b12e-5e75-4ee1-8a46-c43bd6ded772'
  );
