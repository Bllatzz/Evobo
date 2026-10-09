-- Gestão de banca: campos que a tabela de entradas passa a editar (mercado,
-- observação, lay, comissão) e exclusão lógica. Excluir de vez não durava:
-- o "Sincronizar alertas" re-inseria a linha a partir de alerts.
ALTER TABLE gestao_banca
  ADD COLUMN IF NOT EXISTS market         TEXT,
  ADD COLUMN IF NOT EXISTS obs            TEXT,
  ADD COLUMN IF NOT EXISTS lay            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE gestao_banca
    ADD CONSTRAINT gestao_banca_commission_pct_range
    CHECK (commission_pct >= 0 AND commission_pct < 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_gestao_banca_live
  ON gestao_banca (received_at) WHERE deleted_at IS NULL;
