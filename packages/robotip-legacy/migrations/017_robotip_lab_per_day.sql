-- Jogos/dia robusto: entradas ÷ dias do período onde caem 98% delas
-- (corta 1% de cada ponta). O primeiro→último dia cru estica com uma ou
-- duas entradas perdidas meses antes, e os "months" do Robotip arredondam
-- pra meses cheios — os dois distorciam o volume.
ALTER TABLE rt_reports ADD COLUMN IF NOT EXISTS per_day_calc DOUBLE PRECISION;

WITH d AS (
  SELECT report_id, day, count,
         SUM(count) OVER (PARTITION BY report_id ORDER BY day) AS cum,
         SUM(count) OVER (PARTITION BY report_id) AS total
  FROM rt_report_days
), w AS (
  SELECT report_id,
         MIN(day) FILTER (WHERE cum >= total * 0.01) AS a,
         MIN(day) FILTER (WHERE cum >= total * 0.99) AS b
  FROM d GROUP BY report_id
), s AS (
  SELECT w.report_id, SUM(d.count)::float / GREATEST(w.b - w.a + 1, 7) AS per_day
  FROM w JOIN d ON d.report_id = w.report_id AND d.day BETWEEN w.a AND w.b
  GROUP BY w.report_id, w.a, w.b
)
UPDATE rt_reports r SET per_day_calc = s.per_day FROM s WHERE r.id = s.report_id;
