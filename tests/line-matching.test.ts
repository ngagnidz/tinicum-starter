import { describe, expect, it } from "vitest";
import {
  computeDiscrepancies,
  type ConfirmationLineRow,
  type ConfirmationRow,
  type MatchingInput,
  type PoLineRow,
} from "@/lib/line-matching";
import type { FxRate } from "@/lib/fx";

function baseInput(overrides: Partial<MatchingInput> = {}): MatchingInput {
  const poLine: PoLineRow = {
    id: "po-line-1",
    po_number: "PO-1",
    po_date: "2026-04-15",
    vendor_id: "V001",
    vendor_name: "Ostmark",
    line_number: 1,
    our_pn: "PART-1",
    our_description: "widget",
    qty_ordered: 10,
    unit_price: 1240,
    required_date: "2026-01-01",
  };
  const confirmation: ConfirmationRow = {
    id: "conf-1",
    file_id: "file-1",
    po_number: "PO-1",
    vendor_name: "Ostmark",
    doc_part: null,
    currency: "EUR",
    ack_date: "2026-01-01",
    ack_date_text: "01.01.2026",
  };
  const confirmationLine: ConfirmationLineRow = {
    id: "conf-line-1",
    confirmation_id: "conf-1",
    line_number: 1,
    part_number: "PART-1",
    description: "widget",
    quantity: 10,
    unit_of_measure: null,
    unit_price: 1140.8,
    promise_text: "01.01.2026",
    promise_date_start: "2026-01-01",
    promise_date_end: "2026-01-01",
    promise_basis: "delivery",
  };

  const getFxRateMock = (month: string, currency: string): FxRate | null => {
    if (month === "2026-04" && currency === "EUR") {
      return { rate: 1.0874, month: "2026-04", source: "Beacon ERP (2026-04)" };
    }
    return null;
  };

  return {
    poLines: [poLine],
    confirmations: [confirmation],
    confirmationLines: [confirmationLine],
    files: [{ id: "file-1", file_name: "ostmark.pdf" }],
    existingCrosswalk: [],
    getFxRate: getFxRateMock,
    ...overrides,
  };
}

describe("computeDiscrepancies: EUR conversion", () => {
  it("does not flag €1140.80 at 1.0874 vs $1240.00 (within 0.5% tolerance)", () => {
    // €1140.80 * 1.0874 = $1240.53 vs PO $1240.00 (0.04% difference, well under 0.5%)
    const input = baseInput();
    const { discrepancies } = computeDiscrepancies(input);
    expect(discrepancies.find((d) => d.issue_type === "price_change")).toBeUndefined();
    expect(discrepancies.find((d) => d.issue_type === "currency_differs")).toBeUndefined();
  });

  it("flags a 3% price difference after EUR conversion", () => {
    // €1175 * 1.0874 = $1277.695 vs PO $1240 = 3.04% difference (exceeds 0.5% tolerance)
    const input = baseInput();
    input.confirmationLines[0].unit_price = 1175;
    const { discrepancies } = computeDiscrepancies(input);
    const priceIssue = discrepancies.find((d) => d.issue_type === "price_change");
    expect(priceIssue).toBeDefined();
    expect(priceIssue?.ordered_value).toBe("1240 USD");
    expect(priceIssue?.confirmed_value).toContain("1175 EUR");
    expect(priceIssue?.note).toContain("2026-04");
    expect(priceIssue?.note).toContain("1.0874");
    expect(priceIssue?.note).toContain("3.04");
    expect(priceIssue?.severity).toBe("HIGH");
  });

  it("falls back to currency_differs when no rate is available for the PO month", () => {
    const input = baseInput();
    input.poLines[0].po_date = "2025-08-15"; // No rate for August 2025
    input.confirmationLines[0].unit_price = 1200;
    const { discrepancies } = computeDiscrepancies(input);
    const issue = discrepancies.find((d) => d.issue_type === "currency_differs");
    expect(issue).toBeDefined();
    expect(issue?.confirmed_value).toBe("1200 EUR");
    expect(issue?.note).toContain("2025-08");
    expect(discrepancies.find((d) => d.issue_type === "price_change")).toBeUndefined();
  });

  it("still reports price_not_confirmed for a null EUR price regardless of rate availability", () => {
    const input = baseInput();
    input.confirmationLines[0].unit_price = null;
    const { discrepancies } = computeDiscrepancies(input);
    const issue = discrepancies.find((d) => d.issue_type === "price_not_confirmed");
    expect(issue).toBeDefined();
  });
});
