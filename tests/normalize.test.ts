import { describe, expect, it } from "vitest";
import {
  isValidPoNumber,
  normalizeCurrency,
  normalizePartNumber,
  normalizeUnitOfMeasure,
  parsePromiseText,
} from "@/lib/normalize";

describe("parsePromiseText", () => {
  it("returns nulls and no review flag for missing text", () => {
    expect(parsePromiseText(null, null)).toEqual({
      promise_date_start: null,
      promise_date_end: null,
      promise_basis: "delivery",
      needs_review: false,
    });
  });

  it("parses US-style MM/DD/YYYY as a single delivery date", () => {
    expect(parsePromiseText("05/21/2026", "USD")).toEqual({
      promise_date_start: "2026-05-21",
      promise_date_end: "2026-05-21",
      promise_basis: "delivery",
      needs_review: false,
    });
  });

  it("parses German-style DD.MM.YYYY only when currency is EUR", () => {
    expect(parsePromiseText("08.06.2026", "EUR")).toEqual({
      promise_date_start: "2026-06-08",
      promise_date_end: "2026-06-08",
      promise_basis: "delivery",
      needs_review: false,
    });
  });

  it("leaves a dotted date unparsed (for review) when currency isn't EUR", () => {
    const result = parsePromiseText("08.06.2026", "USD");
    expect(result.promise_date_start).toBeNull();
    expect(result.needs_review).toBe(true);
    const resultNoCurrency = parsePromiseText("08.06.2026", null);
    expect(resultNoCurrency.promise_date_start).toBeNull();
    expect(resultNoCurrency.needs_review).toBe(true);
  });

  it("parses a single calendar week into its Monday-Sunday span", () => {
    const result = parsePromiseText("KW 20 / 2026", null);
    expect(result.promise_basis).toBe("delivery");
    expect(result.needs_review).toBe(false);
    // ISO week 20 of 2026 starts Monday 2026-05-11.
    expect(result.promise_date_start).toBe("2026-05-11");
    expect(result.promise_date_end).toBe("2026-05-17");
  });

  it("parses a calendar week range into Monday of the first week through Sunday of the last", () => {
    const result = parsePromiseText("KW 20-22 / 2026", "EUR");
    expect(result).toEqual({
      promise_date_start: "2026-05-11",
      promise_date_end: "2026-05-31",
      promise_basis: "delivery",
      needs_review: false,
    });
  });

  it("strips a leading 'ship' and sets basis to ship", () => {
    expect(parsePromiseText("ship 05/21/2026", "USD")).toEqual({
      promise_date_start: "2026-05-21",
      promise_date_end: "2026-05-21",
      promise_basis: "ship",
      needs_review: false,
    });
  });

  it("strips a leading 'EXW' and sets basis to ex_works", () => {
    const result = parsePromiseText("EXW KW 20-22 / 2026", "EUR");
    expect(result.promise_basis).toBe("ex_works");
    expect(result.promise_date_start).toBe("2026-05-11");
    expect(result.promise_date_end).toBe("2026-05-31");
  });

  it("flags unparseable text for review instead of guessing", () => {
    const result = parsePromiseText("sometime next quarter", "USD");
    expect(result.promise_date_start).toBeNull();
    expect(result.promise_date_end).toBeNull();
    expect(result.needs_review).toBe(true);
  });
});

describe("normalizePartNumber", () => {
  it("trims and uppercases", () => {
    expect(normalizePartNumber("  bar-a286-375 ")).toBe("BAR-A286-375");
  });
  it("passes through null", () => {
    expect(normalizePartNumber(null)).toBeNull();
  });
});

describe("normalizeUnitOfMeasure", () => {
  it("maps known synonyms case-insensitively", () => {
    expect(normalizeUnitOfMeasure("lbs")).toBe("LB");
    expect(normalizeUnitOfMeasure("Lb")).toBe("LB");
    expect(normalizeUnitOfMeasure("ea")).toBe("EA");
    expect(normalizeUnitOfMeasure("pcs")).toBe("EA");
    expect(normalizeUnitOfMeasure("piece")).toBe("EA");
    expect(normalizeUnitOfMeasure("Stück")).toBe("EA");
  });
  it("leaves unknown units as printed", () => {
    expect(normalizeUnitOfMeasure("kg")).toBe("kg");
  });
  it("passes through null", () => {
    expect(normalizeUnitOfMeasure(null)).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it("reads USD only from a dollar sign", () => {
    expect(normalizeCurrency("$0.8400")).toBe("USD");
  });
  it("reads EUR from the euro sign or the text EUR", () => {
    expect(normalizeCurrency("€1140.80")).toBe("EUR");
    expect(normalizeCurrency("EUR")).toBe("EUR");
  });
  it("returns null rather than defaulting when no signal is present", () => {
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency("per piece")).toBeNull();
  });
});

describe("isValidPoNumber", () => {
  it("accepts PO- followed by exactly 10 digits", () => {
    expect(isValidPoNumber("PO-4500050001")).toBe(true);
  });
  it("rejects null, wrong prefix, or wrong digit count", () => {
    expect(isValidPoNumber(null)).toBe(false);
    expect(isValidPoNumber("4500050001")).toBe(false);
    expect(isValidPoNumber("PO-450005000")).toBe(false);
    expect(isValidPoNumber("PO-45000500011")).toBe(false);
  });
});
