-- Lingua Quest Online – initial schema (phases 1–4). Run once in the Supabase SQL editor or `supabase db push`.
-- Every table has Row Level Security: a signed-in user can only see and change their own rows.
-- Edge Functions use the service role key (bypasses RLS) and must filter by user themselves.

create extension if not exists pgcrypto;

-- ---------- profiles & devices ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  locale text not null default 'vi',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  platform text not null default 'windows',
  app_version text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices (user_id);

-- ---------- sync (phase 3; also read by the bot and the PWA) ----------
create sequence if not exists public.sync_seq;

create table if not exists public.sync_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  tbl text not null check (length(tbl) between 1 and 64),
  row_key text not null check (length(row_key) between 1 and 200),
  data jsonb not null,
  deleted boolean not null default false,
  device_id uuid references public.devices (id) on delete set null,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  seq bigint not null default nextval('public.sync_seq'),
  primary key (user_id, tbl, row_key)
);
create index if not exists sync_rows_cursor_idx on public.sync_rows (user_id, seq);
create index if not exists sync_rows_tbl_idx on public.sync_rows (user_id, tbl);

-- Every change gets a fresh, increasing seq so clients can pull "everything after my cursor".
create or replace function public.sync_rows_touch() returns trigger language plpgsql as $$
begin
  new.seq := nextval('public.sync_seq');
  new.server_updated_at := now();
  return new;
end $$;
drop trigger if exists sync_rows_touch on public.sync_rows;
create trigger sync_rows_touch before update on public.sync_rows for each row execute function public.sync_rows_touch();

-- Batch upsert with last-writer-wins on client_updated_at. Returns how many rows were applied.
-- rows: [{ "tbl": "...", "row_key": "...", "data": {...}, "deleted": false, "client_updated_at": "ISO" }]
create or replace function public.sync_push(rows jsonb, device uuid default null) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  applied integer := 0;
  r jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_array_length(rows) > 1000 then raise exception 'too many rows in one push (max 1000)'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    insert into public.sync_rows as s (user_id, tbl, row_key, data, deleted, device_id, client_updated_at)
    values (auth.uid(), r->>'tbl', r->>'row_key', coalesce(r->'data', '{}'::jsonb), coalesce((r->>'deleted')::boolean, false),
            device, (r->>'client_updated_at')::timestamptz)
    on conflict (user_id, tbl, row_key) do update
      set data = excluded.data, deleted = excluded.deleted, device_id = excluded.device_id,
          client_updated_at = excluded.client_updated_at
      where s.client_updated_at <= excluded.client_updated_at;
    if found then applied := applied + 1; end if;
  end loop;
  return applied;
end $$;

-- ---------- Telegram on the server (phase 2) ----------
create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  username text,
  linked_at timestamptz not null default now()
);

create table if not exists public.link_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create table if not exists public.bot_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists bot_messages_user_idx on public.bot_messages (user_id, id desc);

create table if not exists public.notification_schedules (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  period_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  requests integer not null default 0,
  primary key (user_id, day)
);

-- Creates a fresh 6-digit pairing code for the signed-in user (replaces older codes).
create or replace function public.create_link_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.link_codes where user_id = auth.uid() or expires_at < now();
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.link_codes (code, user_id) values (c, auth.uid());
      exit;
    exception when unique_violation then
      -- try another code
    end;
  end loop;
  return c;
end $$;

-- ---------- privacy: delete everything stored for the signed-in user ----------
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.sync_rows where user_id = auth.uid();
  delete from public.bot_messages where user_id = auth.uid();
  delete from public.telegram_links where user_id = auth.uid();
  delete from public.link_codes where user_id = auth.uid();
  delete from public.notification_schedules where user_id = auth.uid();
  delete from public.notification_log where user_id = auth.uid();
  delete from public.ai_usage where user_id = auth.uid();
  delete from public.devices where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
  delete from storage.objects where bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text;
end $$;

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.sync_rows enable row level security;
alter table public.telegram_links enable row level security;
alter table public.link_codes enable row level security;
alter table public.bot_messages enable row level security;
alter table public.notification_schedules enable row level security;
alter table public.notification_log enable row level security;
alter table public.ai_usage enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'devices', 'sync_rows', 'notification_schedules'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  foreach t in array array['telegram_links', 'bot_messages', 'notification_log', 'ai_usage', 'link_codes'] loop
    execute format('drop policy if exists own_rows_read on public.%I', t);
    execute format('create policy own_rows_read on public.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;
-- Unlinking Telegram from the app.
drop policy if exists own_link_delete on public.telegram_links;
create policy own_link_delete on public.telegram_links for delete to authenticated using (user_id = auth.uid());

-- ---------- Storage: private cloud backups, one folder per user ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 104857600)
on conflict (id) do nothing;

drop policy if exists backups_own on storage.objects;
create policy backups_own on storage.objects for all to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
