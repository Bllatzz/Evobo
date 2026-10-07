-- A conta do Laboratório passa a usar a odd que o operador realmente pega:
-- ele espera a odd chegar num valor (2,0 em gols e escanteios) e entra nela.
-- A margem sobre a odd do alerta (odd_margin) fica só pra quem zerar target_odd.
ALTER TABLE rt_lab_campaigns ADD COLUMN IF NOT EXISTS target_odd NUMERIC DEFAULT 2.0;

-- Comparação de cada teste com a versão de onde saiu, nos dias em comum.
ALTER TABLE rt_lab_runs ADD COLUMN IF NOT EXISTS comparison JSONB;
