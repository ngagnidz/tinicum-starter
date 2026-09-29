import Link from "next/link";
import { notFound } from "next/navigation";

// This page always reads the latest run/confirmation data, so it can't be
// statically prerendered -- run it as a normal dynamic (blocking) route.
export const instant = false;
import { createClient } from "@/lib/supabase/server";
import { buildMatchRows, formatDocPart, type MatchStatus } from "@/lib/matching";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MatchesFilterBar } from "@/components/matches-filter-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: "Matched",
  no_confirmation: "No confirmation",
  po_not_on_list: "PO not on open list",
  vendor_mismatch: "Vendor mismatch",
  extraction_failed: "Extraction failed",
  pending: "Pending extraction",
};

const STATUS_VARIANT: Record<
  MatchStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  matched: "default",
  no_confirmation: "secondary",
  po_not_on_list: "destructive",
  vendor_mismatch: "destructive",
  extraction_failed: "destructive",
  pending: "outline",
};

const STATUS_ORDER: MatchStatus[] = [
  "matched",
  "no_confirmation",
  "po_not_on_list",
  "vendor_mismatch",
  "extraction_failed",
  "pending",
];

export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; vendor?: string; q?: string }>;
}) {
  const { id: runId } = await params;
  const { status: statusFilter, vendor: vendorFilter, q: search } = await searchParams;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("runs")
    .select("id, created_at, status")
    .eq("id", runId)
    .single();

  if (!run) notFound();

  const [{ data: poLines }, { data: files }, { data: confirmations }, { data: discrepancies }] =
    await Promise.all([
      supabase
        .from("po_lines")
        .select("po_number, vendor_name")
        .eq("run_id", runId),
      supabase
        .from("confirmation_files")
        .select("id, file_name, storage_path, status, error")
        .eq("run_id", runId),
      supabase
        .from("confirmations")
        .select("file_id, po_number, vendor_name, doc_part")
        .eq("run_id", runId),
      supabase.from("discrepancies").select("po_number").eq("run_id", runId),
    ]);

  const allRows = buildMatchRows(poLines ?? [], files ?? [], confirmations ?? []);

  const issueCountByPo = new Map<string, number>();
  for (const d of discrepancies ?? []) {
    if (!d.po_number) continue;
    issueCountByPo.set(d.po_number, (issueCountByPo.get(d.po_number) ?? 0) + 1);
  }

  const vendors = [
    ...new Set(
      allRows.map((r) => r.vendorCsv ?? r.vendorPdf).filter((v): v is string => !!v),
    ),
  ].sort();

  const rows = allRows
    .filter((r) => !statusFilter || r.status === statusFilter)
    .filter((r) => !vendorFilter || r.vendorCsv === vendorFilter || r.vendorPdf === vendorFilter)
    .filter(
      (r) =>
        !search ||
        (r.poNumber ?? "").toLowerCase().includes(search.toLowerCase()),
    );

  const signedUrlByFileId = new Map<string, string>();
  await Promise.all(
    rows
      .filter((r) => r.fileId && r.storagePath)
      .map(async (r) => {
        const { data } = await supabase.storage
          .from("confirmations")
          .createSignedUrl(r.storagePath as string, 3600);
        if (data?.signedUrl) {
          signedUrlByFileId.set(r.fileId as string, data.signedUrl);
        }
      }),
  );

  const counts = STATUS_ORDER.reduce(
    (acc, status) => {
      acc[status] = allRows.filter((r) => r.status === status).length;
      return acc;
    },
    {} as Record<MatchStatus, number>,
  );

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-7xl p-5 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← New run
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Matches for run {runId.slice(0, 8)}
          </h1>
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((status) => (
                <Badge key={status} variant={STATUS_VARIANT[status]}>
                  {STATUS_LABEL[status]}: {counts[status]}
                </Badge>
              ))}
            </div>

            <MatchesFilterBar
              runId={runId}
              statuses={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              vendors={vendors}
            >
              <div
                key={`${statusFilter ?? ""}|${vendorFilter ?? ""}|${search ?? ""}`}
                className="flex flex-col gap-2 animate-fadeIn"
              >
                <span className="text-sm text-gray-500">
                  Showing {rows.length} of {allRows.length}
                </span>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO number</TableHead>
                      <TableHead>Vendor (CSV)</TableHead>
                      <TableHead>Vendor (PDF)</TableHead>
                      <TableHead>Confirmation file</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Issues</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const url = row.fileId ? signedUrlByFileId.get(row.fileId) : undefined;
                      const issueCount = row.poNumber ? (issueCountByPo.get(row.poNumber) ?? 0) : 0;
                      return (
                        <TableRow key={`${row.poNumber ?? "none"}-${row.fileId ?? "none"}-${i}`}>
                          <TableCell className="font-medium">{row.poNumber ?? "—"}</TableCell>
                          <TableCell>{row.vendorCsv ?? "—"}</TableCell>
                          <TableCell>{row.vendorPdf ?? "—"}</TableCell>
                          <TableCell>
                            {row.fileName ? (
                              url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 underline hover:no-underline"
                                >
                                  {row.fileName}
                                </a>
                              ) : (
                                row.fileName
                              )
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[row.status]}>
                              {STATUS_LABEL[row.status]}
                              {row.status === "matched" ? formatDocPart(row.docPart) : ""}
                            </Badge>
                            {row.error && (
                              <p className="text-xs text-red-600 mt-1">{row.error}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            {issueCount > 0 ? (
                              <Badge variant="destructive">{issueCount}</Badge>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {issueCount > 0 && row.poNumber && (
                              <Link
                                href={`/runs/${runId}/matches/details?po=${encodeURIComponent(row.poNumber)}`}
                                className="text-sm text-blue-600 hover:underline"
                              >
                                View details →
                              </Link>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </MatchesFilterBar>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
