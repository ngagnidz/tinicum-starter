-- Standardize confirmations/confirmation_lines to one shape for every
-- vendor: a single `part_number` (whatever identifier the vendor prints --
-- Beacon PN, vendor PN, or a process code like "PASV"), no beacon/vendor
-- split, no separate process_code. Promise dates are computed
-- deterministically in the app from a verbatim `promise_text` rather than
-- asked of the model (see lib/normalize.ts).
--
-- Dropping and recreating `confirmations`/`confirmation_lines` rather than
-- ALTERing: at the time this migration was written both tables only held
-- data from the schema it replaces, which the app's next extraction run
-- regenerates. `confirmation_files` DOES hold real data already, so it's
-- altered in place instead.

alter table confirmation_files
  add column if not exists needs_review boolean not null default false;

drop table if exists confirmation_lines;
drop table if exists confirmations;

create table confirmations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references confirmation_files(id) on delete cascade,
  po_number text,
  vendor_name text,
  doc_part text,
  currency text check (currency in ('USD', 'EUR')),
  raw_json jsonb
);

create index confirmations_run_id_idx on confirmations(run_id);
create index confirmations_file_id_idx on confirmations(file_id);
create index confirmations_run_id_po_number_idx on confirmations(run_id, po_number);

create table confirmation_lines (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references confirmations(id) on delete cascade,
  line_number int,
  part_number text,
  description text,
  quantity numeric check (quantity > 0),
  unit_of_measure text,
  unit_price numeric check (unit_price > 0),
  promise_text text,
  promise_date_start date,
  promise_date_end date,
  promise_basis text check (promise_basis in ('delivery', 'ship', 'ex_works')),
  needs_review boolean not null default false
);

create index confirmation_lines_confirmation_id_idx on confirmation_lines(confirmation_id);

alter table confirmations enable row level security;
alter table confirmation_lines enable row level security;

create policy "confirmations_all" on confirmations for all
  to anon, authenticated using (true) with check (true);

create policy "confirmation_lines_all" on confirmation_lines for all
  to anon, authenticated using (true) with check (true);
