-- Laboratório: relatório cujo detalhe sempre falha não pode travar o backfill
-- dos outros (tentativas contadas; depois de 5 sai da fila automática).
ALTER TABLE rt_reports ADD COLUMN IF NOT EXISTS detail_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rt_reports ALTER COLUMN green_rate TYPE NUMERIC;
