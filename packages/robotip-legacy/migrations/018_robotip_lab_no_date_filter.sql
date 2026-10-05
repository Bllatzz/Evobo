-- Backtest do Laboratório nunca leva filtro de data. Campanhas cujo campeão
-- tinha período herdado voltam pro robô sem a data e sem campeão — o
-- primeiro teste roda o robô de novo, sem período.
UPDATE rt_lab_campaigns
SET champion_filter = ltrim(regexp_replace(champion_filter, '(^|&)data-[^&]*', '', 'g'), '&'),
    champion_report_id = NULL,
    updated_at = NOW()
WHERE champion_filter ~ '(^|&)data-';
