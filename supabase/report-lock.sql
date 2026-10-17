-- Score lock: backup to the check in api/report.js.
-- Run once in the Supabase SQL Editor of the `svla-scores` project. Safe to run again.
--
-- A table worker's report is refused once more than 20 minutes have passed since the game's first
-- posted report. Staff edits from the Reports tab are inserted with status 'approved' (and approvals,
-- undo and reject are updates), so they are never blocked. Only brand-new table reports
-- (status 'published' or 'held') are checked.
--
-- Keep the 20 minutes in step with LOCK_MINUTES in lib/report-rules.js.

create or replace function public.enforce_report_lock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_posted timestamptz;
begin
  -- Staff-created rows (admin edit) are exempt.
  if new.status not in ('published', 'held') then
    return new;
  end if;

  -- The clock starts at the game's first posted report and never restarts on corrections.
  select min(created_at) into first_posted
  from public.reports
  where game_id = new.game_id
    and status in ('published', 'approved', 'superseded');

  if first_posted is not null and now() > first_posted + interval '20 minutes' then
    raise exception 'SCORE_LOCKED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_lock on public.reports;
create trigger reports_lock
  before insert on public.reports
  for each row execute function public.enforce_report_lock();

-- To remove the lock: drop trigger reports_lock on public.reports;
