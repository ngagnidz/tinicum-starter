import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractConfirmation } from "@/lib/anthropic/extract-confirmation";
import { normalizeCurrency, toConfirmationLineRow } from "@/lib/normalize";

// These hit the real Anthropic API against the 6 reference PDFs in
// data/samples -- one per vendor template -- and check the fields called
// out in the spec (not full-row equality, so minor incidental differences
// like extra whitespace don't cause noise). Requires ANTHROPIC_API_KEY.

const SAMPLES_DIR = path.resolve(__dirname, "../data/samples");

async function extractSample(fileName: string) {
  const buf = await readFile(path.join(SAMPLES_DIR, fileName));
  const extraction = await extractConfirmation(buf.toString("base64"));
  const currency = normalizeCurrency(extraction.currency);
  const lines = extraction.lines.map((l) => toConfirmationLineRow(l, currency));
  return { extraction, lines, currency };
}

const itIfKey = process.env.ANTHROPIC_API_KEY ? it : it.skip;

describe("extraction regression: apex_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("apex_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050004");
    expect(lines[0].line_number).toBe(1);
    expect(lines[0].part_number).toBe("BAR-A286-250");
    expect(lines[0].quantity).toBe(200);
    expect(lines[0].unit_of_measure).toBe("EA");
    expect(lines[0].unit_price).toBe(4.71);
    expect(lines[0].promise_date_start).toBe("2026-05-21");
    expect(lines[0].promise_basis).toBe("delivery");
  });
});

describe("extraction regression: continental_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("continental_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050022");
    expect(lines[0].line_number).toBeNull();
    expect(lines[0].part_number).toBeNull();
    expect(lines[0].quantity).toBe(500);
    expect(lines[0].unit_of_measure).toBe("LB");
    expect(lines[0].unit_price).toBeNull();
    expect(lines[0].promise_date_start).toBe("2026-06-11");
    expect(lines[0].promise_basis).toBe("delivery");
  });
});

describe("extraction regression: heritage_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("heritage_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050009");
    expect(lines[0].line_number).toBe(1);
    expect(lines[0].part_number).toBe("APH-441");
    expect(lines[0].quantity).toBe(50000);
    expect(lines[0].unit_price).toBe(0.84);
    expect(lines[0].promise_date_start).toBe("2026-06-08");
    expect(lines[0].description).toBeNull();
  });
});

describe("extraction regression: liberty_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("liberty_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050016");
    expect(extraction.doc_part).toBe("1 of 2");
    expect(lines[0].line_number).toBeNull();
    expect(lines[0].part_number).toBe("PASV");
    expect(lines[0].quantity).toBe(1500);
    expect(lines[0].unit_price).toBeNull();
    expect(lines[0].promise_date_start).toBe("2026-05-17");
  });
});

describe("extraction regression: ostmark_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("ostmark_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050027");
    expect(normalizeCurrency(extraction.currency)).toBe("EUR");
    expect(lines[0].part_number).toBe("TOOL-DIE-9472");
    expect(lines[0].quantity).toBe(25);
    expect(lines[0].unit_price).toBe(1140.8);
    expect(lines[0].promise_date_start).toBe("2026-05-11");
    expect(lines[0].promise_date_end).toBe("2026-05-31");
    expect(lines[0].promise_basis).toBe("ex_works");
    expect(lines[1].part_number).toBe("OST-CAR-A-100");
    expect(lines[1].quantity).toBe(50);
    expect(lines[1].unit_price).toBe(16.744);
    expect(lines[1].promise_date_start).toBe("2026-05-11");
    expect(lines[1].promise_date_end).toBe("2026-05-31");
    expect(lines[1].promise_basis).toBe("ex_works");
  });
});

describe("extraction regression: quickship_01.pdf", () => {
  itIfKey("matches expected fields", async () => {
    const { extraction, lines } = await extractSample("quickship_01.pdf");
    expect(extraction.po_number).toBe("PO-4500050030");
    expect(lines[0].line_number).toBeNull();
    expect(lines[0].part_number).toBe("MISC-SPR-001");
    expect(lines[0].quantity).toBe(450);
    expect(lines[0].unit_of_measure).toBe("EA");
    expect(lines[0].unit_price).toBe(0.18);
    expect(lines[0].promise_date_start).toBe("2026-05-21");
    expect(lines[0].promise_basis).toBe("ship");
  });
});
