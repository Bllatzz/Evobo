-- "Limite de aposta: R$ X" from the message text (parsed but discarded
-- until now, see parseTip.ts's LIMIT_LINE_RE) — lets the upcoming
-- bet-analytix auto-grader tell "stake capped by the house" apart from a
-- genuine mismatch. needs_review flags a tip the daily grader couldn't
-- confidently auto-grade (ambiguous candidates), surfaced in the admin
-- screen; cleared whenever result is set, auto or manual.
alter table public.telegram_tips
  add column "limit" numeric(10, 2),
  add column needs_review boolean not null default false;
