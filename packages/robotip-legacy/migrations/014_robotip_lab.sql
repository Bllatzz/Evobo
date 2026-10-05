-- Laboratório: espelho read-only dos robôs e relatórios de backtest do
-- robotip.com.br (sincronizados por services/robotipSync.js).

-- Robôs da conta (/api/filter_live). `filter` é a query string de parâmetros
-- no formato do site: "tm->=-70&tm-<=-86&...".
CREATE TABLE IF NOT EXISTS rt_bots (
  id            INTEGER     PRIMARY KEY,
  name          TEXT        NOT NULL,
  filter        TEXT        NOT NULL DEFAULT '',
  termex        TEXT        NOT NULL DEFAULT '',
  send_telegram BOOLEAN     NOT NULL DEFAULT FALSE,
  stake         NUMERIC(6,2),
  deleted_at    TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relatórios de backtest (/api/reports). Um relatório processado não muda
-- mais, então o detalhe (dias/ligas) é baixado uma vez só (detail_synced_at).
CREATE TABLE IF NOT EXISTS rt_reports (
  id               INTEGER     PRIMARY KEY,
  name             TEXT        NOT NULL,
  market           TEXT        NOT NULL,
  query_filter     TEXT        NOT NULL DEFAULT '',
  termex           TEXT        NOT NULL DEFAULT '',
  is_live          BOOLEAN     NOT NULL DEFAULT TRUE,
  lay_bet          BOOLEAN     NOT NULL DEFAULT FALSE,
  done             BOOLEAN     NOT NULL DEFAULT FALSE,
  error            BOOLEAN     NOT NULL DEFAULT FALSE,
  count            INTEGER,
  greens           INTEGER,
  green_rate       NUMERIC(8,6),
  mean_odd         NUMERIC(8,4),
  profit           NUMERIC(12,4),
  max_drawdown     NUMERIC(12,4),
  pval             NUMERIC(10,6),
  months           INTEGER,
  first_day        DATE,
  last_day         DATE,
  active_days      INTEGER,
  created_at       TIMESTAMPTZ,
  scheduled_to     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail_synced_at TIMESTAMPTZ
);

-- Resultado dia a dia de cada relatório (info_res do detalhe).
CREATE TABLE IF NOT EXISTS rt_report_days (
  report_id INTEGER       NOT NULL REFERENCES rt_reports(id) ON DELETE CASCADE,
  day       DATE          NOT NULL,
  count     INTEGER       NOT NULL,
  greens    INTEGER       NOT NULL,
  mean_odd  NUMERIC(8,4),
  profit    NUMERIC(12,4),
  PRIMARY KEY (report_id, day)
);

-- Resumo por liga de cada relatório (leagues do detalhe).
CREATE TABLE IF NOT EXISTS rt_report_leagues (
  report_id   INTEGER       NOT NULL REFERENCES rt_reports(id) ON DELETE CASCADE,
  league_id   TEXT          NOT NULL,
  league_name TEXT          NOT NULL,
  count       INTEGER       NOT NULL,
  greens      INTEGER       NOT NULL,
  mean_odd    NUMERIC(8,4),
  profit      NUMERIC(12,4),
  pval        NUMERIC(10,6),
  months      INTEGER,
  PRIMARY KEY (report_id, league_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_reports_market ON rt_reports (market);
CREATE INDEX IF NOT EXISTS idx_rt_reports_detail_pending
  ON rt_reports (created_at)
  WHERE done AND NOT error AND detail_synced_at IS NULL;
