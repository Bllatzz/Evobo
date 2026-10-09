-- Robôs criados no Robotip a partir do campeão de uma campanha do
-- Laboratório: "Otimizado V{version} - {base_name}". version conta por
-- base_name (o nome do robô original), não por campanha.
CREATE TABLE IF NOT EXISTS rt_lab_promotions (
  id            SERIAL      PRIMARY KEY,
  campaign_id   INTEGER     REFERENCES rt_lab_campaigns(id) ON DELETE SET NULL,
  base_name     TEXT        NOT NULL,
  version       INTEGER     NOT NULL,
  bot_name      TEXT        NOT NULL,
  bot_id        INTEGER,
  origin_bot_id INTEGER,
  report_id     INTEGER,
  filter        TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (base_name, version)
);

CREATE INDEX IF NOT EXISTS idx_rt_lab_promotions_campaign ON rt_lab_promotions (campaign_id);
