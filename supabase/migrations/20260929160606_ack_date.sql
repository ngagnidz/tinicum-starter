-- The document's own issue date (not a promise date), needed to tell
-- whether multiple confirmations for the same PO are split parts or
-- successive revisions of the same document (see lib/line-matching.ts).
alter table confirmations
  add column if not exists ack_date_text text,
  add column if not exists ack_date date;
