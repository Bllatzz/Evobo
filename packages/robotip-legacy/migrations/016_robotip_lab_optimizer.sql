-- Otimizador do Laboratório: uma "campanha" melhora um robô gerando
-- backtests de variações (services/labOptimizer.js).

-- O robô sendo melhorado. champion_* = a melhor versão até agora (começa no
-- robô/relatório de origem). mode 'suggest' só mostra a fila; 'auto' gera os
-- backtests sozinho dentro dos slots livres (menos reserve_slots, que ficam
-- pro uso manual).
CREATE TABLE IF NOT EXISTS rt_lab_campaigns (
  id                 SERIAL      PRIMARY KEY,
  name               TEXT        NOT NULL,
  market             TEXT        NOT NULL,
  is_live            BOOLEAN     NOT NULL DEFAULT TRUE,
  termex             TEXT        NOT NULL DEFAULT '',
  origin_bot_id      INTEGER,
  origin_report_id   INTEGER,
  champion_filter    TEXT        NOT NULL,
  champion_report_id INTEGER,
  mode               TEXT        NOT NULL DEFAULT 'suggest' CHECK (mode IN ('suggest', 'auto')),
  status             TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  odd_margin         NUMERIC     NOT NULL DEFAULT 0.2,
  min_count          INTEGER     NOT NULL DEFAULT 300,
  max_in_flight      INTEGER     NOT NULL DEFAULT 2,
  reserve_slots      INTEGER     NOT NULL DEFAULT 2,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cada backtest gerado por uma campanha. parent_report_id = campeão na hora
-- em que foi gerado (é contra ele que o resultado é comparado).
CREATE TABLE IF NOT EXISTS rt_lab_runs (
  id               SERIAL      PRIMARY KEY,
  campaign_id      INTEGER     NOT NULL REFERENCES rt_lab_campaigns(id) ON DELETE CASCADE,
  parent_report_id INTEGER,
  filter           TEXT        NOT NULL,
  sig              TEXT        NOT NULL,
  mutation         JSONB       NOT NULL,
  predicted        JSONB,
  report_name      TEXT        NOT NULL UNIQUE,
  report_id        INTEGER,
  status           TEXT        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'done', 'failed')),
  verdict          TEXT        CHECK (verdict IN ('better', 'worse', 'same', 'champion')),
  error            TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rt_lab_runs_campaign ON rt_lab_runs (campaign_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_lab_runs_pending ON rt_lab_runs (status) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS idx_rt_reports_name ON rt_reports (name);
