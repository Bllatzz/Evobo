-- Correction: Over 0.5 Corners FT's "odd indicada" is 2.00, not the 2.025
-- the previous migration seeded (product correction, 2026-07-27).
update public.robot_market_odds
set indicated_odd = 2.00
where group_key = 'over|Corners|0.5|FT';
