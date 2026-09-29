import { describe, expect, it } from "vitest";
import {
  computeDiscrepancies,
  type ConfirmationFileRow,
  type ConfirmationLineRow,
  type ConfirmationRow,
  type PoLineRow,
} from "@/lib/line-matching";

// A single-line PO, matched by exact part_number (rule a) so these tests
// isolate revision/part grouping from the pairing rules themselves.
const poLine: PoLineRow = {
  id: "po-line-1",
  po_number: "PO-1",
  po_date: "2026-05-01",
  vendor_id: "V006",
  vendor_name: "QuickShip",
  line_number: null,
  our_pn: "MISC-SPR-001",
  our_description: "spring",
  qty_ordered: 500,
  unit_price: 0.18,
  required_date: "2026-05-21",
};

const files: ConfirmationFileRow[] = [
  { id: "file-a", file_name: "a.pdf" },
  { id: "file-b", file_name: "b.pdf" },
];

function confirmation(overrides: Partial<ConfirmationRow>): ConfirmationRow {
  return {
    id: "conf-a",
    file_id: "file-a",
    po_number: "PO-1",
    vendor_name: "QuickShip",
    doc_part: null,
    currency: "USD",
    ack_date: null,
    ack_date_text: null,
    ...overrides,
  };
}

function line(overrides: Partial<ConfirmationLineRow>): ConfirmationLineRow {
  return {
    id: "line-a",
    confirmation_id: "conf-a",
    line_number: null,
    part_number: "MISC-SPR-001",
    description: null,
    quantity: 500,
    unit_of_measure: "EA",
    unit_price: 0.18,
    promise_text: "ship 05/21/2026",
    promise_date_start: "2026-05-21",
    promise_date_end: "2026-05-21",
    promise_basis: "ship",
    ...overrides,
  };
}

function run(confirmations: ConfirmationRow[], confirmationLines: ConfirmationLineRow[]) {
  return computeDiscrepancies({
    poLines: [poLine],
    confirmations,
    confirmationLines,
    files,
    existingCrosswalk: [],
    getFxRate: () => null, // No FX rates needed for USD confirmations
  });
}

describe("confirmation revision handling", () => {
  it("sums quantities across two parts (1 of 2, 2 of 2)", () => {
    const c1 = confirmation({ id: "conf-1", file_id: "file-a", doc_part: "1 of 2", ack_date: "2026-05-01" });
    const c2 = confirmation({ id: "conf-2", file_id: "file-b", doc_part: "2 of 2", ack_date: "2026-05-02" });
    const l1 = line({ id: "line-1", confirmation_id: "conf-1", quantity: 300 });
    const l2 = line({ id: "line-2", confirmation_id: "conf-2", quantity: 200 });

    const { discrepancies } = run([c1, c2], [l1, l2]);

    expect(discrepancies.find((d) => d.issue_type === "qty_short")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "qty_over")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "revision_unresolved")).toBeUndefined();
  });

  it("uses only the latest of two revisions (different ack_dates) and reports the change", () => {
    const older = confirmation({ id: "conf-1", file_id: "file-a", ack_date: "2026-05-01" });
    const newer = confirmation({ id: "conf-2", file_id: "file-b", ack_date: "2026-05-06" });
    const olderLine = line({ id: "line-1", confirmation_id: "conf-1", quantity: 450 });
    const newerLine = line({ id: "line-2", confirmation_id: "conf-2", quantity: 500 });

    const { discrepancies } = run([older, newer], [olderLine, newerLine]);

    // Only the newer version's qty (500) counts, matching the PO exactly.
    expect(discrepancies.find((d) => d.issue_type === "qty_short")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "qty_over")).toBeUndefined();

    const revised = discrepancies.find((d) => d.issue_type === "revised_confirmation");
    expect(revised).toBeDefined();
    expect(revised?.note).toContain("qty 450 → 500");
    expect(revised?.note).toContain("a.pdf 2026-05-01");
    expect(revised?.note).toContain("b.pdf 2026-05-06");
    expect(revised?.severity).toBe("MEDIUM");
  });

  it("flags revision_unresolved and skips comparison when two revisions share the same ack_date", () => {
    const c1 = confirmation({ id: "conf-1", file_id: "file-a", ack_date: "2026-05-01" });
    const c2 = confirmation({ id: "conf-2", file_id: "file-b", ack_date: "2026-05-01" });
    const l1 = line({ id: "line-1", confirmation_id: "conf-1", quantity: 450 });
    const l2 = line({ id: "line-2", confirmation_id: "conf-2", quantity: 500 });

    const { discrepancies } = run([c1, c2], [l1, l2]);

    const unresolved = discrepancies.find((d) => d.issue_type === "revision_unresolved");
    expect(unresolved).toBeDefined();
    expect(unresolved?.severity).toBe("HIGH");
    expect(unresolved?.needs_review).toBe(true);
    expect(unresolved?.note).toContain("a.pdf");
    expect(unresolved?.note).toContain("b.pdf");
    expect(discrepancies.find((d) => d.issue_type === "qty_short")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "qty_over")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "revised_confirmation")).toBeUndefined();
  });

  it("flags revision_unresolved when one revision has a null ack_date", () => {
    const c1 = confirmation({ id: "conf-1", file_id: "file-a", ack_date: null });
    const c2 = confirmation({ id: "conf-2", file_id: "file-b", ack_date: "2026-05-06" });
    const l1 = line({ id: "line-1", confirmation_id: "conf-1", quantity: 450 });
    const l2 = line({ id: "line-2", confirmation_id: "conf-2", quantity: 500 });

    const { discrepancies } = run([c1, c2], [l1, l2]);

    const unresolved = discrepancies.find((d) => d.issue_type === "revision_unresolved");
    expect(unresolved).toBeDefined();
    expect(unresolved?.note).toContain("no date");
  });

  it("reports missing_line with 'dropped in revision' when a newer version drops a line", () => {
    // Two-line PO so the revision keeps confirming one line and drops the
    // other, rather than dropping to zero lines entirely (which is the
    // acknowledged_no_details case, not this one).
    const poLineA: PoLineRow = { ...poLine, id: "po-line-a", our_pn: "MISC-SPR-001" };
    const poLineB: PoLineRow = { ...poLine, id: "po-line-b", our_pn: "MISC-WAS-A25" };

    const older = confirmation({ id: "conf-1", file_id: "file-a", ack_date: "2026-05-01" });
    const newer = confirmation({ id: "conf-2", file_id: "file-b", ack_date: "2026-05-06" });
    const olderLineA = line({ id: "line-1a", confirmation_id: "conf-1", part_number: "MISC-SPR-001" });
    const olderLineB = line({ id: "line-1b", confirmation_id: "conf-1", part_number: "MISC-WAS-A25" });
    // Newer version only re-confirms MISC-WAS-A25; MISC-SPR-001 is gone.
    const newerLineB = line({ id: "line-2b", confirmation_id: "conf-2", part_number: "MISC-WAS-A25" });

    const { discrepancies } = computeDiscrepancies({
      poLines: [poLineA, poLineB],
      confirmations: [older, newer],
      confirmationLines: [olderLineA, olderLineB, newerLineB],
      files,
      existingCrosswalk: [],
      getFxRate: () => null,
    });

    const missing = discrepancies.find((d) => d.issue_type === "missing_line");
    expect(missing).toBeDefined();
    expect(missing?.po_line_id).toBe("po-line-a");
    expect(missing?.note).toBe("dropped in revision");
  });
});
