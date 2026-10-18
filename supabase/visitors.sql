-- Visitor count for the admin page. Run once in the Supabase SQL Editor of the `svla-scores` project. Safe to run again.
--
-- Each phone or browser gets a random id (no name, no IP address, nothing personal) the first time it opens the
-- parent page or a table report page. One row per device per page keeps the count "unique": opening the page
-- fifty times is still one visitor. The table is locked down with row level security like the others, so only
-- the server (using the secret key) can read or write it.

create table if not exists public.visitors (
  client_id  text        not null,
  page       text        not null check (page in ('scores', 'report')),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       integer     not null default 1,
  primary key (client_id, page)
);

alter table public.visitors enable row level security;
create index if not exists visitors_last_seen_idx on public.visitors (last_seen);

create or replace function public.record_visit(p_client text, p_page text)
returns void
language sql
set search_path = public
as $$
  insert into public.visitors (client_id, page) values (p_client, p_page)
  on conflict (client_id, page) do update
    set hits = visitors.hits + 1, last_seen = now();
$$;

create or replace function public.visitor_stats()
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'unique_total',  (select count(distinct client_id) from visitors),
    'unique_today',  (select count(distinct client_id) from visitors
                      where (last_seen at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date),
    'new_today',     (select count(distinct client_id) from visitors
                      where (first_seen at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date),
    'unique_hour',   (select count(distinct client_id) from visitors where last_seen > now() - interval '1 hour'),
    'visits_total',  (select coalesce(sum(hits), 0) from visitors),
    'by_page',       (select coalesce(json_object_agg(page, n), '{}'::json)
                      from (select page, count(*) n from visitors group by page) p),
    'first_seen',    (select min(first_seen) from visitors)
  );
$$;

-- Only the server's secret key may call these.
revoke all on function public.record_visit(text, text) from public, anon, authenticated;
revoke all on function public.visitor_stats() from public, anon, authenticated;
grant execute on function public.record_visit(text, text) to service_role;
grant execute on function public.visitor_stats() to service_role;

-- To clear the count before a new event: truncate table public.visitors;
