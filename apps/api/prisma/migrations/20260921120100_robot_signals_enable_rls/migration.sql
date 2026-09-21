-- Review fix: robot_signals was created without RLS (see 20260703040000). It
-- lives in `public`, so the Supabase Data API exposed it (including
-- raw_message) to anon/authenticated for read AND write. No client ever
-- touches this table — the backend reads it through Prisma, which bypasses
-- RLS — so enabling RLS with deliberately no policies (deny-all for
-- anon/authenticated) is enough.
alter table public.robot_signals enable row level security;
