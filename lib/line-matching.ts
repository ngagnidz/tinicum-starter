// Line-level matching: pairs every PO line with the confirmation line(s)
// that fulfil it, then compares quantity/price/date/unit against the PO.
// Plain TypeScript, no AI -- everything here runs on data extraction has
// already produced.
//
// A PO can have more than one confirmation for two different reasons, and
// they need opposite handling:
//   - PARTS ("part 1 of 2", "part 2 of 2"): different shipments of the same
//     order -> combine their lines, sum quantities.
//   - REVISIONS (no doc_part, or the same doc_part N, sent more than once):
//     the vendor re-sent/corrected the same document -> only the latest
//     (by ack_date) counts; older ones are history, not additional supply.
// groupConfirmationsForPo below resolves each PO's confirmations into
// per-part groups, each either a single document, a revision history with a
// clear current version, or -- if ack_date can't establish a clear order --
// unresolved, which blocks comparison entirely rather than guessing.

import { MATCHING_CONFIG } from "@/lib/config/matching";
import type { FxRate } from "@/lib/fx";

export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type MatchRule = "a" | "b" | "c" | "d" | "e";

export interface PoLineRow {
  id: string;
  po_number: string;
  po_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  line_number: number | null;
  our_pn: string | null;
  our_description: string | null;
  qty_ordered: number | null;
  unit_price: number | null;
  required_date: string | null;
}

export interface ConfirmationRow {
  id: string;
  file_id: string;
  po_number: string | null;
  vendor_name: string | null;
  doc_part: string | null;
  currency: "USD" | "EUR" | null;
  ack_date: string | null;
  ack_date_text: string | null;
}

export interface ConfirmationLineRow {
  id: string;
  confirmation_id: string;
  line_number: number | null;
  part_number: string | null;
  description: string | null;
  quantity: number | null;
  unit_of_measure: string | null;
  unit_price: number | null;
  promise_text: string | null;
  promise_date_start: string | null;
  promise_date_end: string | null;
  promise_basis: "delivery" | "ship" | "ex_works" | null;
}

export interface ConfirmationFileRow {
  id: string;
  file_name: string;
}

export interface CrosswalkRow {
  vendor_id: string;
  vendor_part_number: string;
  our_pn: string;
}

export interface DiscrepancyDraft {
  po_number: string | null;
  po_line_id: string | null;
  confirmation_line_id: string | null;
  vendor_name: string | null;
  part: string | null;
  issue_type: string;
  ordered_value: string | null;
  confirmed_value: string | null;
  days_late: number | null;
  note: string | null;
  severity: Severity;
  match_rule: MatchRule | null;
  needs_review: boolean;
  source_file: string | null;
}

export interface CrosswalkDraft {
  vendor_id: string;
  vendor_part_number: string;
  our_pn: string;
  source: "inferred";
}

export interface MatchingInput {
  poLines: PoLineRow[];
  confirmations: ConfirmationRow[];
  confirmationLines: ConfirmationLineRow[];
  files: ConfirmationFileRow[];
  existingCrosswalk: CrosswalkRow[];
  /** Function to look up FX rates by month (YYYY-MM) and currency. Returns null if not found. */
  getFxRate: (month: string, currency: string) => FxRate | null;
}

export interface MatchingResult {
  discrepancies: DiscrepancyDraft[];
  newCrosswalkEntries: CrosswalkDraft[];
}

interface Candidate {
  line: ConfirmationLineRow;
  confirmation: ConfirmationRow;
}

/** One doc_part value (or "whole" for none) worth of confirmations for a PO, resolved to a current version. */
interface ConfirmationGroup {
  key: string;
  confirmations: ConfirmationRow[];
  status: "single" | "resolved" | "unresolved";
  current: ConfirmationRow | null;
  previous: ConfirmationRow | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function impliedUnitOfMeasure(description: string | null): string | null {
  if (!description) return null;
  const d = description.toLowerCase();
  if (/\bper\s+lb\b|\blbs?\b/.test(d)) return "LB";
  if (/\bper\s+piece\b|\beach\b/.test(d)) return "EA";
  return null;
}

function describeOrdered(poLine: PoLineRow): string | null {
  const parts: string[] = [];
  if (poLine.qty_ordered !== null) parts.push(`qty ${poLine.qty_ordered}`);
  if (poLine.unit_price !== null) parts.push(`@ ${poLine.unit_price}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function describeConfirmed(line: ConfirmationLineRow | null): string | null {
  if (!line) return null;
  const parts: string[] = [];
  if (line.quantity !== null) parts.push(`qty ${line.quantity}`);
  if (line.unit_price !== null) parts.push(`@ ${line.unit_price}`);
  if (line.promise_text) parts.push(`promise ${line.promise_text}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function fileNameOf(
  confirmation: ConfirmationRow,
  fileById: Map<string, ConfirmationFileRow>,
): string | null {
  return fileById.get(confirmation.file_id)?.file_name ?? null;
}

function parseDocPart(docPart: string | null): { n: number; m: number } | null {
  const match = docPart?.match(/^(\d+)\s+of\s+(\d+)$/i);
  if (!match) return null;
  return { n: Number(match[1]), m: Number(match[2]) };
}

/**
 * Groups a PO's confirmations by doc_part N (confirmations with no doc_part
 * all share one "whole" group). Within each group, orders by ack_date to
 * find the current version -- "unresolved" when that's not possible (a null
 * ack_date, or a tie for latest), per the spec: don't guess, don't sum.
 */
function groupConfirmationsForPo(confirmations: ConfirmationRow[]): ConfirmationGroup[] {
  const byKey = new Map<string, ConfirmationRow[]>();
  for (const c of confirmations) {
    const parsed = parseDocPart(c.doc_part);
    const key = parsed ? `part-${parsed.n}` : "whole";
    const arr = byKey.get(key) ?? [];
    arr.push(c);
    byKey.set(key, arr);
  }

  const groups: ConfirmationGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length === 1) {
      groups.push({ key, confirmations: list, status: "single", current: list[0], previous: null });
      continue;
    }

    const anyNullDate = list.some((c) => c.ack_date === null);
    const maxDate = list.reduce<string | null>(
      (max, c) => (c.ack_date !== null && (max === null || c.ack_date > max) ? c.ack_date : max),
      null,
    );
    const atMaxDate = maxDate === null ? [] : list.filter((c) => c.ack_date === maxDate);

    if (anyNullDate || atMaxDate.length !== 1) {
      groups.push({ key, confirmations: list, status: "unresolved", current: null, previous: null });
      continue;
    }

    const sorted = [...list].sort((a, b) => (a.ack_date! < b.ack_date! ? -1 : 1));
    const current = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    groups.push({ key, confirmations: list, status: "resolved", current, previous });
  }
  return groups;
}

/** Same pairing rules as a/c/d/e (no crosswalk lookup, no shared "unmatched" pool) for locating one confirmation's line for a given PO line -- used to diff across revisions. */
function findLineForPoLine(
  confirmationId: string,
  poLine: PoLineRow,
  linesByConfirmation: Map<string, ConfirmationLineRow[]>,
): ConfirmationLineRow | null {
  const lines = linesByConfirmation.get(confirmationId) ?? [];
  const ourPnNorm = norm(poLine.our_pn);

  if (ourPnNorm) {
    const exact = lines.find((l) => norm(l.part_number) === ourPnNorm);
    if (exact) return exact;
  }
  if (poLine.line_number !== null) {
    const byLineNumber = lines.find((l) => l.line_number === poLine.line_number);
    if (byLineNumber) return byLineNumber;
  }
  if (lines.length === 1) return lines[0];
  if (ourPnNorm) {
    const suffix = lines.find((l) => {
      const pn = norm(l.part_number);
      return pn !== "" && ourPnNorm.endsWith(pn);
    });
    if (suffix) return suffix;
  }
  return null;
}

function describeLineSnapshot(line: ConfirmationLineRow | null): string {
  return describeConfirmed(line) ?? "no matching line item";
}

function buildRevisionUnresolved(
  poLine: PoLineRow,
  group: ConfirmationGroup,
  vendorNameCsv: string | null,
  linesByConfirmation: Map<string, ConfirmationLineRow[]>,
  fileById: Map<string, ConfirmationFileRow>,
): DiscrepancyDraft {
  const versions = group.confirmations.map((c) => {
    const line = findLineForPoLine(c.id, poLine, linesByConfirmation);
    const fileName = fileNameOf(c, fileById) ?? "(unknown file)";
    return `${fileName} (ack ${c.ack_date ?? "no date"}): ${describeLineSnapshot(line)}`;
  });

  return {
    po_number: poLine.po_number,
    po_line_id: poLine.id,
    confirmation_line_id: null,
    vendor_name: group.confirmations[0]?.vendor_name ?? vendorNameCsv,
    part: poLine.our_pn,
    issue_type: "revision_unresolved",
    ordered_value: describeOrdered(poLine),
    confirmed_value: null,
    days_late: null,
    note: `Cannot determine which version is current: ${versions.join("; ")}`,
    severity: "HIGH",
    match_rule: null,
    needs_review: true,
    source_file:
      [...new Set(group.confirmations.map((c) => fileNameOf(c, fileById)).filter(Boolean))].join(
        "; ",
      ) || null,
  };
}

function buildRevisedConfirmation(
  poLine: PoLineRow,
  group: ConfirmationGroup,
  vendorNameCsv: string | null,
  linesByConfirmation: Map<string, ConfirmationLineRow[]>,
  fileById: Map<string, ConfirmationFileRow>,
): DiscrepancyDraft {
  const current = group.current!;
  const previous = group.previous!;
  const currLine = findLineForPoLine(current.id, poLine, linesByConfirmation);
  const prevLine = findLineForPoLine(previous.id, poLine, linesByConfirmation);

  const changes: string[] = [];
  if ((prevLine?.quantity ?? null) !== (currLine?.quantity ?? null)) {
    changes.push(`qty ${prevLine?.quantity ?? "none"} → ${currLine?.quantity ?? "none"}`);
  }
  if ((prevLine?.unit_price ?? null) !== (currLine?.unit_price ?? null)) {
    changes.push(`price ${prevLine?.unit_price ?? "none"} → ${currLine?.unit_price ?? "none"}`);
  }
  if ((prevLine?.promise_date_start ?? null) !== (currLine?.promise_date_start ?? null)) {
    changes.push(
      `promise ${prevLine?.promise_date_start ?? "none"} → ${currLine?.promise_date_start ?? "none"}`,
    );
  }

  const prevFile = fileNameOf(previous, fileById) ?? "previous";
  const currFile = fileNameOf(current, fileById) ?? "current";
  const fileNote = `(${prevFile} ${previous.ack_date ?? "no date"} → ${currFile} ${current.ack_date ?? "no date"})`;
  const changed = changes.length > 0;

  return {
    po_number: poLine.po_number,
    po_line_id: poLine.id,
    confirmation_line_id: currLine?.id ?? null,
    vendor_name: current.vendor_name ?? vendorNameCsv,
    part: poLine.our_pn,
    issue_type: "revised_confirmation",
    ordered_value: describeConfirmed(prevLine),
    confirmed_value: describeConfirmed(currLine),
    days_late: null,
    note: changed ? `${changes.join(", ")} ${fileNote}` : `re-sent, no changes ${fileNote}`,
    severity: changed ? "MEDIUM" : "LOW",
    match_rule: null,
    needs_review: false,
    source_file: [prevFile, currFile].join("; "),
  };
}

export function computeDiscrepancies(input: MatchingInput): MatchingResult {
  const { poLines, confirmations, confirmationLines, files, existingCrosswalk, getFxRate } =
    input;
  const cfg = MATCHING_CONFIG;

  const fileById = new Map(files.map((f) => [f.id, f]));

  const linesByConfirmation = new Map<string, ConfirmationLineRow[]>();
  for (const l of confirmationLines) {
    const arr = linesByConfirmation.get(l.confirmation_id) ?? [];
    arr.push(l);
    linesByConfirmation.set(l.confirmation_id, arr);
  }

  const poLinesByPo = new Map<string, PoLineRow[]>();
  for (const pl of poLines) {
    const arr = poLinesByPo.get(pl.po_number) ?? [];
    arr.push(pl);
    poLinesByPo.set(pl.po_number, arr);
  }

  const confirmationsByPo = new Map<string, ConfirmationRow[]>();
  const unknownPoConfirmations: ConfirmationRow[] = [];
  for (const c of confirmations) {
    if (!c.po_number || !poLinesByPo.has(c.po_number)) {
      unknownPoConfirmations.push(c);
      continue;
    }
    const arr = confirmationsByPo.get(c.po_number) ?? [];
    arr.push(c);
    confirmationsByPo.set(c.po_number, arr);
  }

  // vendor_id::VENDOR_PART -> our_pn, seeded from persisted crosswalk rows
  // and extended in-memory as rule c/d pairings are discovered below, so a
  // later PO line in the same run can immediately benefit via rule b.
  const crosswalkMap = new Map<string, string>();
  for (const cw of existingCrosswalk) {
    crosswalkMap.set(`${cw.vendor_id}::${norm(cw.vendor_part_number)}`, cw.our_pn);
  }
  const knownCrosswalkKeys = new Set(crosswalkMap.keys());
  const newCrosswalkEntries: CrosswalkDraft[] = [];

  const discrepancies: DiscrepancyDraft[] = [];

  for (const c of unknownPoConfirmations) {
    discrepancies.push({
      po_number: c.po_number,
      po_line_id: null,
      confirmation_line_id: null,
      vendor_name: c.vendor_name,
      part: null,
      issue_type: "unknown_po",
      ordered_value: null,
      confirmed_value: c.po_number,
      days_late: null,
      note: `Confirmation references PO ${c.po_number ?? "(none extracted)"}, which is not in the open POs list`,
      severity: "HIGH",
      match_rule: null,
      needs_review: false,
      source_file: fileNameOf(c, fileById),
    });
  }

  for (const [poNumber, poLinesForPo] of poLinesByPo) {
    const vendorNameCsv = poLinesForPo[0]?.vendor_name ?? null;
    const vendorId = poLinesForPo[0]?.vendor_id ?? null;
    const confsForPo = confirmationsByPo.get(poNumber) ?? [];

    if (confsForPo.length === 0) {
      discrepancies.push({
        po_number: poNumber,
        po_line_id: null,
        confirmation_line_id: null,
        vendor_name: vendorNameCsv,
        part: null,
        issue_type: "no_confirmation",
        ordered_value: null,
        confirmed_value: null,
        days_late: null,
        note: `${poLinesForPo.length} line(s) on this PO, no confirmation found`,
        severity: "HIGH",
        match_rule: null,
        needs_review: false,
        source_file: null,
      });
      continue;
    }

    // Resolve parts vs. revisions per doc_part group; only the current
    // version of each group contributes lines to matching (superseded
    // revisions are excluded entirely, not summed). Unresolved groups
    // contribute all their versions, tagged, so pairing can still tell
    // which PO line they'd affect -- handled specially below.
    const groups = groupConfirmationsForPo(confsForPo);
    const groupByConfId = new Map<string, ConfirmationGroup>();
    const effectiveConfirmations: ConfirmationRow[] = [];
    for (const g of groups) {
      if (g.status === "unresolved") {
        for (const c of g.confirmations) {
          effectiveConfirmations.push(c);
          groupByConfId.set(c.id, g);
        }
      } else {
        effectiveConfirmations.push(g.current!);
        groupByConfId.set(g.current!.id, g);
      }
    }

    const candidates: Candidate[] = [];
    for (const c of effectiveConfirmations) {
      for (const line of linesByConfirmation.get(c.id) ?? []) {
        candidates.push({ line, confirmation: c });
      }
    }

    if (candidates.length === 0) {
      discrepancies.push({
        po_number: poNumber,
        po_line_id: null,
        confirmation_line_id: null,
        vendor_name: confsForPo[0]?.vendor_name ?? vendorNameCsv,
        part: null,
        issue_type: "acknowledged_no_details",
        ordered_value: null,
        confirmed_value: null,
        days_late: null,
        note: "Vendor acknowledged the PO but confirmed no line items yet",
        severity: "MEDIUM",
        match_rule: null,
        needs_review: false,
        source_file:
          [...new Set(confsForPo.map((c) => fileNameOf(c, fileById)).filter(Boolean))].join(
            "; ",
          ) || null,
      });
      continue;
    }

    // doc_part coverage across every confirmation for this PO: if any
    // states e.g. "1 of 2" but the full 1..2 range was never all seen, a
    // qty shortfall is a missing shipment, not necessarily a real shortage.
    let expectedTotal: number | null = null;
    const seenParts = new Set<number>();
    for (const c of confsForPo) {
      const parsed = parseDocPart(c.doc_part);
      if (parsed) {
        seenParts.add(parsed.n);
        expectedTotal = expectedTotal === null ? parsed.m : Math.max(expectedTotal, parsed.m);
      }
    }
    const isPartiallyConfirmed =
      expectedTotal !== null &&
      Array.from({ length: expectedTotal }, (_, i) => i + 1).some((n) => !seenParts.has(n));

    let unmatched = [...candidates];
    const sortedPoLines = [...poLinesForPo].sort(
      (a, b) => (a.line_number ?? 0) - (b.line_number ?? 0),
    );

    for (const poLine of sortedPoLines) {
      const ourPnNorm = norm(poLine.our_pn);
      let matched: Candidate[] = [];
      let matchRule: MatchRule | null = null;

      if (ourPnNorm) {
        matched = unmatched.filter((cand) => norm(cand.line.part_number) === ourPnNorm);
        if (matched.length > 0) matchRule = "a";
      }

      if (matched.length === 0 && vendorId) {
        matched = unmatched.filter((cand) => {
          const mapped = crosswalkMap.get(`${vendorId}::${norm(cand.line.part_number)}`);
          return mapped !== undefined && norm(mapped) === ourPnNorm;
        });
        if (matched.length > 0) matchRule = "b";
      }

      if (matched.length === 0 && poLine.line_number !== null) {
        matched = unmatched.filter((cand) => cand.line.line_number === poLine.line_number);
        if (matched.length > 0) matchRule = "c";
      }

      if (matched.length === 0 && sortedPoLines.length === 1 && unmatched.length > 0) {
        matched = [...unmatched];
        matchRule = "d";
      }

      if (matched.length === 0) {
        matched = unmatched.filter((cand) => {
          const pn = norm(cand.line.part_number);
          return pn !== "" && ourPnNorm !== "" && ourPnNorm.endsWith(pn);
        });
        if (matched.length > 0) matchRule = "e";
      }

      if (matched.length === 0 || matchRule === null) {
        // A line the PO has but the current version doesn't confirm is only
        // "dropped in revision" if an older version of the same document
        // group DID have it -- otherwise it's a plain missing_line.
        const droppedInRevision = groups.some(
          (g) =>
            g.status === "resolved" &&
            g.previous &&
            findLineForPoLine(g.previous.id, poLine, linesByConfirmation) !== null,
        );
        discrepancies.push({
          po_number: poNumber,
          po_line_id: poLine.id,
          confirmation_line_id: null,
          vendor_name: vendorNameCsv,
          part: poLine.our_pn,
          issue_type: "missing_line",
          ordered_value: describeOrdered(poLine),
          confirmed_value: null,
          days_late: null,
          note: droppedInRevision
            ? "dropped in revision"
            : "No confirmation line could be paired with this PO line",
          severity: "HIGH",
          match_rule: null,
          needs_review: false,
          source_file: null,
        });
        continue;
      }

      const matchedSet = new Set(matched);
      unmatched = unmatched.filter((c) => !matchedSet.has(c));

      if ((matchRule === "c" || matchRule === "d") && vendorId && poLine.our_pn) {
        for (const cand of matched) {
          const vendorPart = cand.line.part_number;
          if (!vendorPart || norm(vendorPart) === ourPnNorm) continue;
          const key = `${vendorId}::${norm(vendorPart)}`;
          if (knownCrosswalkKeys.has(key)) continue;
          knownCrosswalkKeys.add(key);
          crosswalkMap.set(key, poLine.our_pn);
          newCrosswalkEntries.push({
            vendor_id: vendorId,
            vendor_part_number: vendorPart,
            our_pn: poLine.our_pn,
            source: "inferred",
          });
        }
      }

      const matchedGroups = [
        ...new Set(
          matched
            .map((cand) => groupByConfId.get(cand.confirmation.id))
            .filter((g): g is ConfirmationGroup => !!g),
        ),
      ];
      const unresolvedGroups = matchedGroups.filter((g) => g.status === "unresolved");

      if (unresolvedGroups.length > 0) {
        // Ambiguous ordering -- don't guess, don't sum, don't compare.
        for (const g of unresolvedGroups) {
          discrepancies.push(
            buildRevisionUnresolved(poLine, g, vendorNameCsv, linesByConfirmation, fileById),
          );
        }
        continue;
      }

      pushLineComparison({
        poLine,
        matched,
        matchRule,
        isPartiallyConfirmed,
        vendorNameCsv,
        fileById,
        cfg,
        getFxRate,
        out: discrepancies,
      });

      for (const g of matchedGroups) {
        if (g.status === "resolved" && g.previous) {
          discrepancies.push(
            buildRevisedConfirmation(poLine, g, vendorNameCsv, linesByConfirmation, fileById),
          );
        }
      }
    }

    for (const cand of unmatched) {
      discrepancies.push({
        po_number: poNumber,
        po_line_id: null,
        confirmation_line_id: cand.line.id,
        vendor_name: cand.confirmation.vendor_name ?? vendorNameCsv,
        part: cand.line.part_number,
        issue_type: "extra_line",
        ordered_value: null,
        confirmed_value: describeConfirmed(cand.line),
        days_late: null,
        note: "Confirmation line did not pair with any PO line",
        severity: "LOW",
        match_rule: null,
        needs_review: false,
        source_file: fileNameOf(cand.confirmation, fileById),
      });
    }
  }

  return { discrepancies, newCrosswalkEntries };
}

function pushLineComparison(args: {
  poLine: PoLineRow;
  matched: Candidate[];
  matchRule: MatchRule;
  isPartiallyConfirmed: boolean;
  vendorNameCsv: string | null;
  fileById: Map<string, ConfirmationFileRow>;
  cfg: typeof MATCHING_CONFIG;
  getFxRate: (month: string, currency: string) => FxRate | null;
  out: DiscrepancyDraft[];
}) {
  const { poLine, matched, matchRule, isPartiallyConfirmed, vendorNameCsv, fileById, cfg, getFxRate, out } =
    args;
  const lines = matched.map((m) => m.line);
  const confirmationVendor = matched[0].confirmation.vendor_name ?? vendorNameCsv;
  const sourceFile =
    [...new Set(matched.map((m) => fileNameOf(m.confirmation, fileById)).filter(Boolean))].join(
      "; ",
    ) || null;
  const confirmationLineId = matched.length === 1 ? matched[0].line.id : null;
  const needsReview = matchRule === "c" || matchRule === "d" || matchRule === "e";
  const splitNote = matched.length > 1 ? ` (summed across ${matched.length} confirmation lines)` : "";

  const push = (row: Pick<
    DiscrepancyDraft,
    "issue_type" | "ordered_value" | "confirmed_value" | "days_late" | "note" | "severity"
  >) => {
    out.push({
      po_number: poLine.po_number,
      po_line_id: poLine.id,
      confirmation_line_id: confirmationLineId,
      vendor_name: confirmationVendor,
      part: poLine.our_pn,
      match_rule: matchRule,
      needs_review: needsReview,
      source_file: sourceFile,
      ...row,
    });
  };

  // quantity
  const qtyValues = lines.map((l) => l.quantity).filter((q): q is number => q !== null);
  if (qtyValues.length > 0 && poLine.qty_ordered !== null) {
    const confirmedQty = qtyValues.reduce((a, b) => a + b, 0);
    if (confirmedQty < poLine.qty_ordered) {
      push({
        issue_type: isPartiallyConfirmed ? "partially_confirmed" : "qty_short",
        ordered_value: String(poLine.qty_ordered),
        confirmed_value: String(confirmedQty),
        days_late: null,
        note:
          (isPartiallyConfirmed
            ? "A doc_part of this PO's confirmation set hasn't arrived yet"
            : "Confirmed quantity is less than ordered") + splitNote,
        severity: isPartiallyConfirmed ? "MEDIUM" : "HIGH",
      });
    } else if (confirmedQty > poLine.qty_ordered) {
      // Not classified in the spec's severity list -- MEDIUM by default,
      // between an outright shortage (HIGH) and a low-severity note.
      push({
        issue_type: "qty_over",
        ordered_value: String(poLine.qty_ordered),
        confirmed_value: String(confirmedQty),
        days_late: null,
        note: "Confirmed quantity exceeds ordered" + splitNote,
        severity: "MEDIUM",
      });
    }
  }

  // price
  const currency = matched[0].confirmation.currency;
  const priceValues = lines.map((l) => l.unit_price).filter((p): p is number => p !== null);
  const confirmedPrice = priceValues.length > 0 ? priceValues[0] : null;

  if (confirmedPrice === null) {
    push({
      issue_type: "price_not_confirmed",
      ordered_value: poLine.unit_price !== null ? String(poLine.unit_price) : null,
      confirmed_value: currency === "EUR" ? "EUR, no price shown" : null,
      days_late: null,
      note: "No price shown on the confirmation",
      severity: "MEDIUM",
    });
  } else if (poLine.unit_price !== null) {
    // For EUR prices, look up the rate for the PO's month
    let fxRate: FxRate | null = null;
    let rateMonth: string | null = null;
    if (currency === "EUR" && poLine.po_date) {
      rateMonth = poLine.po_date.substring(0, 7); // YYYY-MM
      fxRate = getFxRate(rateMonth, "EUR");
    }

    if (currency === "EUR" && confirmedPrice !== null && !fxRate) {
      // No rate available for this month -- fall back to currency_differs
      push({
        issue_type: "currency_differs",
        ordered_value: `${poLine.unit_price} USD`,
        confirmed_value: `${confirmedPrice} EUR`,
        days_late: null,
        note: `Confirmation is priced in EUR but no FX rate available for ${rateMonth ?? "(unknown month)"} -- not compared against the USD PO price`,
        severity: "MEDIUM",
      });
    } else if (currency === "EUR" && fxRate) {
      // Convert EUR to USD using historical rate and check percentage tolerance
      const confirmedPriceUsd = confirmedPrice * fxRate.rate;
      const diff = Math.abs(confirmedPriceUsd - poLine.unit_price);
      const percentDiff = diff / poLine.unit_price;

      if (percentDiff > cfg.convertedPriceTolerance) {
        push({
          issue_type: "price_change",
          ordered_value: `${poLine.unit_price} USD`,
          confirmed_value: `${confirmedPrice} EUR (≈ ${confirmedPriceUsd.toFixed(4)} USD)`,
          days_late: null,
          note: `EUR price converted at 1 EUR = ${fxRate.rate} USD (${rateMonth}): ${confirmedPrice} EUR = ${confirmedPriceUsd.toFixed(4)} USD vs PO ${poLine.unit_price} USD (${(percentDiff * 100).toFixed(2)}% difference)`,
          severity: "HIGH",
        });
      }
    } else if (currency === "USD") {
      // USD prices use absolute tolerance
      const diff = Math.abs(confirmedPrice - poLine.unit_price);
      if (diff > cfg.priceTolerance) {
        push({
          issue_type: "price_change",
          ordered_value: `${poLine.unit_price} USD`,
          confirmed_value: `${confirmedPrice} USD`,
          days_late: null,
          note: "Confirmed unit price differs from the PO",
          severity: "HIGH",
        });
      }
    }
  }

  // date
  const dateValues = lines
    .map((l) => l.promise_date_end ?? l.promise_date_start)
    .filter((d): d is string => d !== null);
  if (dateValues.length === 0) {
    push({
      issue_type: "date_not_confirmed",
      ordered_value: poLine.required_date,
      confirmed_value: null,
      days_late: null,
      note: "No promise date on the confirmation",
      severity: "MEDIUM",
    });
  } else if (poLine.required_date) {
    const latest = dateValues.reduce((a, b) => (a > b ? a : b));
    const daysLate = Math.round(
      (Date.parse(latest) - Date.parse(poLine.required_date)) / 86_400_000,
    );
    if (daysLate > cfg.daysLateTolerance) {
      const shipOrExw = lines.some(
        (l) => l.promise_basis === "ship" || l.promise_basis === "ex_works",
      );
      push({
        issue_type: "late_promise",
        ordered_value: poLine.required_date,
        confirmed_value: latest,
        days_late: daysLate,
        note:
          `Promised ${daysLate} day(s) after required.` +
          (shipOrExw
            ? " Promise date is a ship/ex-works date -- actual arrival will be later."
            : ""),
        severity: "HIGH",
      });
    }
  }

  // unit of measure
  const impliedUom = impliedUnitOfMeasure(poLine.our_description);
  const confirmedUoms = new Set(lines.map((l) => l.unit_of_measure).filter((u): u is string => u !== null));
  if (impliedUom && confirmedUoms.size > 0 && !confirmedUoms.has(impliedUom)) {
    push({
      issue_type: "uom_differs",
      ordered_value: impliedUom,
      confirmed_value: [...confirmedUoms].join(", "),
      days_late: null,
      note: "Unit of measure differs from what the PO description implies",
      severity: "LOW",
    });
  }
}
