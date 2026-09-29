// Test script to verify EUR price matching with historical FX rates
import { computeDiscrepancies, type MatchingInput } from "./lib/line-matching";
import type { FxRate } from "./lib/fx";

// Ostmark test data based on the spec
const ostmarkPOs: MatchingInput = {
  poLines: [
    {
      id: "po-line-ostmark-1",
      po_number: "PO-OSTMARK-001",
      po_date: "2026-04-10",
      vendor_id: "OSTMARK",
      vendor_name: "Ostmark",
      line_number: 1,
      our_pn: "WIDGET-100",
      our_description: "Widget",
      qty_ordered: 100,
      unit_price: 1240,
      required_date: "2026-05-15",
    },
    {
      id: "po-line-ostmark-2",
      po_number: "PO-OSTMARK-002",
      po_date: "2026-04-15",
      vendor_id: "OSTMARK",
      vendor_name: "Ostmark",
      line_number: 1,
      our_pn: "COMPONENT-X",
      our_description: "Component X",
      qty_ordered: 50,
      unit_price: 500,
      required_date: "2026-05-20",
    },
  ],
  confirmations: [
    {
      id: "conf-ostmark-1",
      file_id: "file-ostmark-1",
      po_number: "PO-OSTMARK-001",
      vendor_name: "Ostmark",
      doc_part: null,
      currency: "EUR",
      ack_date: "2026-04-12",
      ack_date_text: "12.04.2026",
    },
    {
      id: "conf-ostmark-2",
      file_id: "file-ostmark-2",
      po_number: "PO-OSTMARK-002",
      vendor_name: "Ostmark",
      doc_part: null,
      currency: "EUR",
      ack_date: "2026-04-16",
      ack_date_text: "16.04.2026",
    },
  ],
  confirmationLines: [
    {
      id: "conf-line-ostmark-1",
      confirmation_id: "conf-ostmark-1",
      line_number: 1,
      part_number: "WIDGET-100",
      description: "Widget",
      quantity: 100,
      unit_of_measure: "EA",
      unit_price: 1140.8,
      promise_text: "01.05.2026",
      promise_date_start: "2026-05-01",
      promise_date_end: "2026-05-01",
      promise_basis: "delivery",
    },
    {
      id: "conf-line-ostmark-2",
      confirmation_id: "conf-ostmark-2",
      line_number: 1,
      part_number: "COMPONENT-X",
      description: "Component X",
      quantity: 50,
      unit_of_measure: "EA",
      unit_price: 460,
      promise_text: "05.05.2026",
      promise_date_start: "2026-05-05",
      promise_date_end: "2026-05-05",
      promise_basis: "delivery",
    },
  ],
  files: [
    { id: "file-ostmark-1", file_name: "ostmark-001.pdf" },
    { id: "file-ostmark-2", file_name: "ostmark-002.pdf" },
  ],
  existingCrosswalk: [],
  getFxRate: (month: string, currency: string): FxRate | null => {
    // April 2026 EUR rate from Beacon ERP
    if (month === "2026-04" && currency === "EUR") {
      return { rate: 1.0874, month: "2026-04", source: "Beacon ERP (2026-04)" };
    }
    return null;
  },
};

const result = computeDiscrepancies(ostmarkPOs);

console.log("Ostmark Matching Results:");
console.log("==========================\n");

// Filter to just Ostmark discrepancies
const ostmarkDiscrepancies = result.discrepancies.filter(
  (d) => d.vendor_name === "Ostmark",
);

if (ostmarkDiscrepancies.length === 0) {
  console.log("✓ No discrepancies found for Ostmark (price conversions within tolerance)");
} else {
  console.log(`Found ${ostmarkDiscrepancies.length} discrepancies:\n`);
  for (const d of ostmarkDiscrepancies) {
    console.log(`PO: ${d.po_number}`);
    console.log(`Issue: ${d.issue_type}`);
    console.log(`Part: ${d.part}`);
    console.log(`Ordered: ${d.ordered_value}`);
    console.log(`Confirmed: ${d.confirmed_value}`);
    console.log(`Note: ${d.note}`);
    console.log(`Severity: ${d.severity}`);
    console.log("---");
  }
}

console.log("\nPrice Conversion Details:");
console.log("========================\n");

const line1 = ostmarkPOs.confirmationLines[0];
const po1 = ostmarkPOs.poLines[0];
const rate = 1.0874;
const convertedPrice = line1.unit_price! * rate;
const diff = Math.abs(convertedPrice - po1.unit_price!);
const percentDiff = (diff / po1.unit_price!) * 100;

console.log("Ostmark Row 1:");
console.log(`EUR Price: €${line1.unit_price}`);
console.log(`Rate (April 2026): 1 EUR = $${rate}`);
console.log(`Converted: €${line1.unit_price} × ${rate} = $${convertedPrice.toFixed(2)}`);
console.log(`PO USD Price: $${po1.unit_price}`);
console.log(`Difference: $${diff.toFixed(2)} (${percentDiff.toFixed(2)}%)`);
console.log(`Status: ${percentDiff <= 0.5 ? "✓ Within 0.5% tolerance" : "✗ Exceeds tolerance"}`);

const line2 = ostmarkPOs.confirmationLines[1];
const po2 = ostmarkPOs.poLines[1];
const convertedPrice2 = line2.unit_price! * rate;
const diff2 = Math.abs(convertedPrice2 - po2.unit_price!);
const percentDiff2 = (diff2 / po2.unit_price!) * 100;

console.log("\nOstmark Row 2:");
console.log(`EUR Price: €${line2.unit_price}`);
console.log(`Rate (April 2026): 1 EUR = $${rate}`);
console.log(`Converted: €${line2.unit_price} × ${rate} = $${convertedPrice2.toFixed(2)}`);
console.log(`PO USD Price: $${po2.unit_price}`);
console.log(`Difference: $${diff2.toFixed(2)} (${percentDiff2.toFixed(2)}%)`);
console.log(`Status: ${percentDiff2 <= 0.5 ? "✓ Within 0.5% tolerance" : "✗ Exceeds tolerance"}`);
