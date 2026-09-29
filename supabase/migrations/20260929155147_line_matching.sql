-- Line-level matching support: a persistent, cross-run part-number
-- crosswalk the matcher builds up as it infers vendor part number ->
-- Beacon part number mappings, and a per-run discrepancies table holding
-- one row per issue found (see lib/line-matching.ts).

create table part_crosswalk (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null,
  vendor_part_number text not null,
  our_pn text not null,
  source text not null default 'inferred',
  created_at timestamptz not null default now(),
  unique (vendor_id, vendor_part_number)
);

create table discrepancies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  po_number text,
  po_line_id uuid references po_lines(id) on delete cascade,
  confirmation_line_id uuid references confirmation_lines(id) on delete cascade,
  vendor_name text,
  part text,
  issue_type text not null,
  ordered_value text,
  confirmed_value text,
  days_late int,
  note text,
  severity text not null check (severity in ('HIGH', 'MEDIUM', 'LOW')),
  match_rule text,
  needs_review boolean not null default false,
  source_file text
);

create index discrepancies_run_id_idx on discrepancies(run_id);
create index discrepancies_run_id_severity_idx on discrepancies(run_id, severity);
create index discrepancies_run_id_vendor_idx on discrepancies(run_id, vendor_name);
create index discrepancies_run_id_issue_type_idx on discrepancies(run_id, issue_type);

alter table part_crosswalk enable row level security;
alter table discrepancies enable row level security;

create policy "part_crosswalk_all" on part_crosswalk for all
  to anon, authenticated using (true) with check (true);

create policy "discrepancies_all" on discrepancies for all
  to anon, authenticated using (true) with check (true);
