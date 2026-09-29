// Deterministic post-processing applied after extraction. The model is
// instructed to copy promise dates and currency symbols verbatim rather
// than parse/normalize them itself -- that kind of mechanical conversion
// (date math especially, with ISO calendar weeks) is exactly what a model
// gets subtly wrong, so it's done here instead where it's testable.

import type { ExtractionLine } from "@/lib/schema/confirmation";

export type Currency = "USD" | "EUR";
export type PromiseBasis = "delivery" | "ship" | "ex_works";

export interface NormalizedPromise {
  promise_date_start: string | null;
  promise_date_end: string | null;
  promise_basis: PromiseBasis;
  needs_review: boolean;
}

const MDY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DMY_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const KW_RANGE_RE = /^KW\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\/\s*(\d{4})$/i;
const KW_SINGLE_RE = /^KW\s*(\d{1,2})\s*\/\s*(\d{4})$/i;
const SHIP_PREFIX_RE = /^ship\b\s*/i;
const EXW_PREFIX_RE = /^exw\b\s*/i;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Monday of the given ISO-8601 week (weeks start Monday, week 1 contains Jan 4). */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayMon0 = (jan4.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayMon0);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

function dateToISO(d: Date): string {
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * `currency` gates the DD.MM.YYYY branch: a dotted date is only read as
 * day-first when we independently know the document is EUR/German --
 * otherwise a dotted date is left unparsed (needs_review) rather than
 * guessed at.
 */
export function parsePromiseText(
  raw: string | null,
  currency: Currency | null,
): NormalizedPromise {
  const empty = (basis: PromiseBasis, needsReview: boolean): NormalizedPromise => ({
    promise_date_start: null,
    promise_date_end: null,
    promise_basis: basis,
    needs_review: needsReview,
  });

  if (!raw || !raw.trim()) return empty("delivery", false);

  let text = raw.trim();
  let basis: PromiseBasis = "delivery";
  const shipMatch = text.match(SHIP_PREFIX_RE);
  if (shipMatch) {
    basis = "ship";
    text = text.slice(shipMatch[0].length).trim();
  } else {
    const exwMatch = text.match(EXW_PREFIX_RE);
    if (exwMatch) {
      basis = "ex_works";
      text = text.slice(exwMatch[0].length).trim();
    }
  }

  const mdy = text.match(MDY_RE);
  if (mdy) {
    const [, m, d, y] = mdy;
    const iso = toISO(Number(y), Number(m), Number(d));
    return { promise_date_start: iso, promise_date_end: iso, promise_basis: basis, needs_review: false };
  }

  if (currency === "EUR") {
    const dmy = text.match(DMY_RE);
    if (dmy) {
      const [, d, m, y] = dmy;
      const iso = toISO(Number(y), Number(m), Number(d));
      return { promise_date_start: iso, promise_date_end: iso, promise_basis: basis, needs_review: false };
    }
  }

  const kwRange = text.match(KW_RANGE_RE);
  if (kwRange) {
    const [, wa, wb, y] = kwRange;
    const start = isoWeekMonday(Number(y), Number(wa));
    const endMonday = isoWeekMonday(Number(y), Number(wb));
    const end = new Date(endMonday);
    end.setUTCDate(endMonday.getUTCDate() + 6);
    return {
      promise_date_start: dateToISO(start),
      promise_date_end: dateToISO(end),
      promise_basis: basis,
      needs_review: false,
    };
  }

  const kwSingle = text.match(KW_SINGLE_RE);
  if (kwSingle) {
    const [, w, y] = kwSingle;
    const start = isoWeekMonday(Number(y), Number(w));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      promise_date_start: dateToISO(start),
      promise_date_end: dateToISO(end),
      promise_basis: basis,
      needs_review: false,
    };
  }

  return empty(basis, true);
}

/**
 * A document's own issue date -- always a single date, never a range/week
 * or a ship/ex-works basis, so it reuses just the MM/DD/YYYY and (EUR-gated)
 * DD.MM.YYYY branches of parsePromiseText's date parsing.
 */
export function parseAckDate(raw: string | null, currency: Currency | null): string | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();

  const mdy = text.match(MDY_RE);
  if (mdy) {
    const [, m, d, y] = mdy;
    return toISO(Number(y), Number(m), Number(d));
  }

  if (currency === "EUR") {
    const dmy = text.match(DMY_RE);
    if (dmy) {
      const [, d, m, y] = dmy;
      return toISO(Number(y), Number(m), Number(d));
    }
  }

  return null;
}

export function normalizePartNumber(partNumber: string | null): string | null {
  if (!partNumber) return null;
  const trimmed = partNumber.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

const UNIT_OF_MEASURE_MAP: Record<string, string> = {
  lb: "LB",
  lbs: "LB",
  ea: "EA",
  pcs: "EA",
  piece: "EA",
  pieces: "EA",
  "stück": "EA",
  stk: "EA",
};

export function normalizeUnitOfMeasure(unit: string | null): string | null {
  if (!unit) return null;
  const trimmed = unit.trim();
  if (!trimmed) return null;
  const mapped = UNIT_OF_MEASURE_MAP[trimmed.toLowerCase()];
  return mapped ?? trimmed;
}

/**
 * Reads whatever currency indicator the model relayed (a symbol, a code, or
 * null) and collapses it to exactly "USD" | "EUR" | null. "USD" only if a
 * "$" is present, "EUR" only if "€" or the text "EUR" is present -- no
 * default when neither shows up.
 */
export function normalizeCurrency(raw: string | null): Currency | null {
  if (!raw) return null;
  if (raw.includes("$")) return "USD";
  if (raw.includes("€") || /EUR/i.test(raw)) return "EUR";
  return null;
}

/** Whatever the model printed for po_number, formatted per the real convention. */
const PO_NUMBER_RE = /^PO-\d{10}$/;

export function isValidPoNumber(poNumber: string | null): boolean {
  return poNumber !== null && PO_NUMBER_RE.test(poNumber);
}

/** Shapes one extracted line into the row confirmation_lines stores, applying every normalization above. */
export function toConfirmationLineRow(
  line: ExtractionLine,
  currency: Currency | null,
) {
  const promise = parsePromiseText(line.promise_text, currency);
  const invalidQuantity = line.quantity !== null && line.quantity <= 0;
  const invalidUnitPrice = line.unit_price !== null && line.unit_price <= 0;

  return {
    line_number: line.line_number,
    part_number: normalizePartNumber(line.part_number),
    description: line.description,
    quantity: invalidQuantity ? null : line.quantity,
    unit_of_measure: normalizeUnitOfMeasure(line.unit_of_measure),
    unit_price: invalidUnitPrice ? null : line.unit_price,
    promise_text: line.promise_text,
    promise_date_start: promise.promise_date_start,
    promise_date_end: promise.promise_date_end,
    promise_basis: promise.promise_basis,
    needs_review: promise.needs_review || invalidQuantity || invalidUnitPrice,
  };
}
