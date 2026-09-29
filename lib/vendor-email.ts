import { humanizeIssueType } from "@/lib/issue-labels";
import type { Severity } from "@/lib/line-matching";

export interface VendorEmailIssue {
  part: string | null;
  issue_type: string;
  ordered_value: string | null;
  confirmed_value: string | null;
  days_late: number | null;
  note: string | null;
  severity: Severity;
}

export function buildVendorEmail(
  poNumber: string,
  vendorName: string | null,
  issues: VendorEmailIssue[],
): { subject: string; body: string } {
  const subject = `Order confirmation discrepancies – PO ${poNumber}`;

  const greeting = vendorName ? `Hi ${vendorName} team,` : "Hi,";

  const lines = issues.map((issue, i) => {
    const parts: string[] = [];
    parts.push(
      `${i + 1}. ${humanizeIssueType(issue.issue_type)}${issue.part ? ` – Part ${issue.part}` : ""}`,
    );
    if (issue.ordered_value) parts.push(`   Ordered: ${issue.ordered_value}`);
    if (issue.confirmed_value) {
      const late = issue.days_late !== null ? ` (${issue.days_late} days late)` : "";
      parts.push(`   Confirmed: ${issue.confirmed_value}${late}`);
    }
    if (issue.note) parts.push(`   Note: ${issue.note}`);
    return parts.join("\n");
  });

  const body = [
    greeting,
    "",
    `We found the following discrepancies between PO ${poNumber} and your order confirmation. Could you please review and send us corrected details?`,
    "",
    ...lines.flatMap((l) => [l, ""]),
    "Please let us know if anything above looks incorrect on our end.",
    "",
    "Thanks,",
    "Lisa",
  ].join("\n");

  return { subject, body };
}
