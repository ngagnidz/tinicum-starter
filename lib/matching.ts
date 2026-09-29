// Document-level matching: pairs each confirmation file with a PO number
// from the CSV. Plain TypeScript, no AI -- everything here runs on data
// that extraction has already produced.

export type MatchStatus =
  | "matched"
  | "no_confirmation"
  | "po_not_on_list"
  | "vendor_mismatch"
  | "extraction_failed"
  | "pending";

export interface MatchRow {
  poNumber: string | null;
  vendorCsv: string | null;
  vendorPdf: string | null;
  fileId: string | null;
  fileName: string | null;
  storagePath: string | null;
  status: MatchStatus;
  docPart: string | null;
  error: string | null;
}

export interface PoLineInput {
  po_number: string;
  vendor_name: string | null;
}

export interface FileInput {
  id: string;
  file_name: string;
  storage_path: string;
  status: string;
  error: string | null;
}

export interface ConfirmationInput {
  file_id: string;
  po_number: string | null;
  vendor_name: string | null;
  doc_part: string | null;
}

// Generic corporate-entity words we ignore when comparing vendor names, so
// e.g. "Apex Bar & Tube Co." and "APEX BAR & TUBE CO." (or a translated /
// reformatted variant) still overlap on the words that actually identify
// the company.
const CORPORATE_SUFFIXES = new Set([
  "inc",
  "co",
  "company",
  "corp",
  "corporation",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "srl",
  "sa",
  "bv",
  "group",
  "industries",
  "industrial",
]);

function normalizeVendorName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !CORPORATE_SUFFIXES.has(tok));
}

/** True when the two names are consistent enough not to flag as a mismatch. */
export function vendorsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return true; // nothing to compare against, don't flag
  const tokensA = normalizeVendorName(a);
  const tokensB = new Set(normalizeVendorName(b));
  if (tokensA.length === 0 || tokensB.size === 0) return true;
  return tokensA.some((t) => tokensB.has(t));
}

export function buildMatchRows(
  poLines: PoLineInput[],
  files: FileInput[],
  confirmations: ConfirmationInput[],
): MatchRow[] {
  const csvVendorByPo = new Map<string, string | null>();
  for (const line of poLines) {
    if (!csvVendorByPo.has(line.po_number)) {
      csvVendorByPo.set(line.po_number, line.vendor_name);
    }
  }

  const confirmationByFileId = new Map<string, ConfirmationInput>();
  for (const c of confirmations) {
    if (!confirmationByFileId.has(c.file_id)) {
      confirmationByFileId.set(c.file_id, c);
    }
  }

  const matchedPoNumbers = new Set<string>();
  const rows: MatchRow[] = [];

  const sortedFiles = [...files].sort((a, b) =>
    a.file_name.localeCompare(b.file_name),
  );

  for (const file of sortedFiles) {
    if (file.status === "failed") {
      rows.push({
        poNumber: null,
        vendorCsv: null,
        vendorPdf: null,
        fileId: file.id,
        fileName: file.file_name,
        storagePath: file.storage_path,
        status: "extraction_failed",
        docPart: null,
        error: file.error,
      });
      continue;
    }

    if (file.status === "pending") {
      rows.push({
        poNumber: null,
        vendorCsv: null,
        vendorPdf: null,
        fileId: file.id,
        fileName: file.file_name,
        storagePath: file.storage_path,
        status: "pending",
        docPart: null,
        error: null,
      });
      continue;
    }

    const confirmation = confirmationByFileId.get(file.id);
    if (!confirmation) {
      rows.push({
        poNumber: null,
        vendorCsv: null,
        vendorPdf: null,
        fileId: file.id,
        fileName: file.file_name,
        storagePath: file.storage_path,
        status: "extraction_failed",
        docPart: null,
        error: "Marked extracted but no confirmation record was found",
      });
      continue;
    }

    const poNumber = confirmation.po_number;
    const vendorPdf = confirmation.vendor_name;
    const vendorCsv = poNumber ? (csvVendorByPo.get(poNumber) ?? null) : null;

    if (poNumber && csvVendorByPo.has(poNumber)) {
      matchedPoNumbers.add(poNumber);
      rows.push({
        poNumber,
        vendorCsv,
        vendorPdf,
        fileId: file.id,
        fileName: file.file_name,
        storagePath: file.storage_path,
        status: vendorsMatch(vendorCsv, vendorPdf)
          ? "matched"
          : "vendor_mismatch",
        docPart: confirmation.doc_part,
        error: null,
      });
    } else {
      rows.push({
        poNumber,
        vendorCsv: null,
        vendorPdf,
        fileId: file.id,
        fileName: file.file_name,
        storagePath: file.storage_path,
        status: "po_not_on_list",
        docPart: confirmation.doc_part,
        error: null,
      });
    }
  }

  const unmatchedPos = [...csvVendorByPo.entries()]
    .filter(([po]) => !matchedPoNumbers.has(po))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [poNumber, vendorCsv] of unmatchedPos) {
    rows.push({
      poNumber,
      vendorCsv,
      vendorPdf: null,
      fileId: null,
      fileName: null,
      storagePath: null,
      status: "no_confirmation",
      docPart: null,
      error: null,
    });
  }

  return rows;
}

export function formatDocPart(docPart: string | null): string {
  return docPart ? ` (part ${docPart})` : "";
}
