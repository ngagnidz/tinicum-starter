-- Historical FX rates for price conversions. Populated from Beacon's ERP fx_rate table.
-- Used to convert EUR prices to USD based on the month of the PO date.

create table fx_rate (
  month text not null,
  currency text not null,
  rate_to_usd real not null,
  primary key (month, currency)
);

insert into fx_rate (month, currency, rate_to_usd) values
  ('2025-09', 'EUR', 1.0801),
  ('2025-10', 'EUR', 1.0836),
  ('2025-11', 'EUR', 1.0842),
  ('2025-12', 'EUR', 1.0895),
  ('2026-01', 'EUR', 1.0921),
  ('2026-02', 'EUR', 1.0868),
  ('2026-03', 'EUR', 1.081),
  ('2026-04', 'EUR', 1.0874),
  ('2026-05', 'EUR', 1.0902);

alter table fx_rate enable row level security;

create policy "fx_rate_all" on fx_rate for all
  to anon, authenticated using (true) with check (true);
