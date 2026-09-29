// Human-readable labels for the machine-friendly issue_type codes stored on
// the discrepancies table (see lib/line-matching.ts for where each is set).
const ISSUE_TYPE_LABELS: Record<string, string> = {
  revision_unresolved: "Unresolved revision",
  revised_confirmation: "Revised confirmation",
  unknown_po: "PO not on open list",
  no_confirmation: "No confirmation received",
  acknowledged_no_details: "Acknowledged, no line details",
  missing_line: "Line missing from confirmation",
  extra_line: "Extra line not on PO",
  partially_confirmed: "Partially confirmed quantity",
  qty_short: "Quantity short",
  qty_over: "Quantity over",
  price_not_confirmed: "Price not confirmed",
  currency_differs: "Currency differs",
  price_change: "Price changed",
  date_not_confirmed: "Date not confirmed",
  late_promise: "Late delivery promise",
  uom_differs: "Unit of measure differs",
};

export function humanizeIssueType(issueType: string): string {
  return (
    ISSUE_TYPE_LABELS[issueType] ??
    issueType
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
