export const OPEN_POS_COLUMNS = [
  "po_number",
  "po_date",
  "vendor_id",
  "vendor_name",
  "line_number",
  "our_pn",
  "our_description",
  "qty_ordered",
  "unit_price",
  "required_date",
] as const;

export type OpenPosColumn = (typeof OPEN_POS_COLUMNS)[number];

export type OpenPosRow = Record<OpenPosColumn, string>;

export function missingOpenPosColumns(fields: string[]): OpenPosColumn[] {
  const present = new Set(fields.map((f) => f.trim()));
  return OPEN_POS_COLUMNS.filter((c) => !present.has(c));
}
