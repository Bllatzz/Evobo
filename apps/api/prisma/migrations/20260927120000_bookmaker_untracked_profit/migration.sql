-- Lucro de apostas que o usuário não lançou no Evobo, descoberto quando ele
-- saca mais do que o saldo calculado da casa. Entra no saldo e na banca
-- atual, mas não no depositado (não era dinheiro de antes) nem no ROI das tips.
alter table public.telegram_bookmaker_balances
    add column untracked_profit numeric(10, 2) not null default 0;
