-- Odd com 4 casas: casas como a Superbet pagam por odd "quebrada" (ex.:
-- R$ 20 → prêmio R$ 48,75 = odd 2,4375). Com 2 casas ela virava 2,44 e o
-- retorno/lucro calculado saía uns centavos acima do que a casa pagou.
-- Só aumenta a precisão: todo valor atual continua idêntico.
alter table public.telegram_tips
    alter column odd type numeric(10, 4),
    alter column original_odd type numeric(10, 4);

alter table public.telegram_tip_takes
    alter column odd type numeric(10, 4);
