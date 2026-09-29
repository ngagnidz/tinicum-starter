import { z } from "zod";

// The extraction model is instructed to return clean JSON (numbers as
// numbers, null for anything absent) but we don't trust that blindly --
// these preprocessors coerce the common ways it might still drift (a
// stringified number, an empty string instead of null) before validating.
//
// po_number and currency are deliberately left loose here (any string) --
// the real "PO-XXXXXXXXXX" / "USD"|"EUR" contracts are enforced as
// *validation* in app/api/extract/route.ts (see lib/normalize.ts), which
// flags a violation for review instead of throwing the whole extraction
// away. Date math is likewise not the model's job -- see lib/normalize.ts.

function toNullable(v: unknown) {
  return v === "" || v === undefined ? null : v;
}

function toNumber(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

const stringNullable = z.preprocess(toNullable, z.string().nullable());
const numberNullable = z.preprocess(toNumber, z.number().nullable());
const intNullable = z.preprocess(toNumber, z.number().int().nullable());

export const ExtractionLineSchema = z.object({
  line_number: intNullable,
  part_number: stringNullable,
  description: stringNullable,
  quantity: numberNullable,
  unit_of_measure: stringNullable,
  unit_price: numberNullable,
  promise_text: stringNullable,
});

export const ExtractionSchema = z.object({
  po_number: stringNullable,
  vendor_name: stringNullable,
  currency: stringNullable,
  doc_part: stringNullable,
  // The document's own issue date (not a promise date) -- copied verbatim,
  // parsed to ISO in lib/normalize.ts the same way promise_text is.
  ack_date_text: stringNullable,
  lines: z.array(ExtractionLineSchema),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractionLine = z.infer<typeof ExtractionLineSchema>;
