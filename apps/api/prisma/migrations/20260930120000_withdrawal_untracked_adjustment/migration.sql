-- Quanto este saque somou no untracked_profit da casa (lucro/prejuízo de
-- apostas fora do Evobo). Gravado junto com o saque pra poder ser revertido
-- quando o saque for apagado.
alter table public.telegram_bookmaker_withdrawals
    add column untracked_adjustment numeric(10, 2) not null default 0;
