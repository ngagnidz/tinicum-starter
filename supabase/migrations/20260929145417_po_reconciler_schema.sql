-- PO confirmation reconciler: core schema
--
-- Scope: single-tenant internal tool, no per-user data isolation yet.
-- RLS is enabled (required by Supabase lint/security defaults) but policies
-- are intentionally permissive (anon + authenticated can read/write everything)
-- since there is no auth/ownership model on `runs` yet. Tighten before this
-- handles real vendor data.

create extension if not exists "pgcrypto";

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'uploading'
);

create table if not exists po_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  po_number text not null,
  po_date date,
  vendor_id text,
  vendor_name text,
  line_number int,
  our_pn text,
  our_description text,
  qty_ordered numeric,
  unit_price numeric,
  required_date date
);

create index if not exists po_lines_run_id_idx on po_lines(run_id);
create index if not exists po_lines_run_id_po_number_idx on po_lines(run_id, po_number);

create table if not exists confirmation_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'extracted', 'failed')),
  error text
);

create index if not exists confirmation_files_run_id_idx on confirmation_files(run_id);

create table if not exists confirmations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references confirmation_files(id) on delete cascade,
  po_number text,
  vendor_name text,
  ack_date date,
  vendor_order_number text,
  currency text,
  doc_part text,
  raw_json jsonb
);

create index if not exists confirmations_run_id_idx on confirmations(run_id);
create index if not exists confirmations_file_id_idx on confirmations(file_id);
create index if not exists confirmations_run_id_po_number_idx on confirmations(run_id, po_number);

create table if not exists confirmation_lines (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references confirmations(id) on delete cascade,
  line_number int,
  beacon_part_number text,
  vendor_part_number text,
  description text,
  quantity numeric,
  unit_of_measure text,
  unit_price numeric,
  promise_date_start date,
  promise_date_end date,
  raw_promise_text text
);

create index if not exists confirmation_lines_confirmation_id_idx on confirmation_lines(confirmation_id);

-- Row Level Security -----------------------------------------------------

alter table runs enable row level security;
alter table po_lines enable row level security;
alter table confirmation_files enable row level security;
alter table confirmations enable row level security;
alter table confirmation_lines enable row level security;

create policy "runs_all" on runs for all
  to anon, authenticated using (true) with check (true);

create policy "po_lines_all" on po_lines for all
  to anon, authenticated using (true) with check (true);

create policy "confirmation_files_all" on confirmation_files for all
  to anon, authenticated using (true) with check (true);

create policy "confirmations_all" on confirmations for all
  to anon, authenticated using (true) with check (true);

create policy "confirmation_lines_all" on confirmation_lines for all
  to anon, authenticated using (true) with check (true);

-- Storage ------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('confirmations', 'confirmations', false)
on conflict (id) do nothing;

create policy "confirmations_bucket_read" on storage.objects for select
  to anon, authenticated using (bucket_id = 'confirmations');

create policy "confirmations_bucket_write" on storage.objects for insert
  to anon, authenticated with check (bucket_id = 'confirmations');
