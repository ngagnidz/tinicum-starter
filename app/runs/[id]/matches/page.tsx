import Link from "next/link";
import { notFound } from "next/navigation";

// This page always reads the latest run/confirmation data, so it can't be
// statically prerendered -- run it as a normal dynamic (blocking) route.
export const instant = false;
import { createClient } from "@/lib/supabase/server";
import {
  buildMatchRows,
  formatDocPart,
  type MatchStatus,
} from "@/lib/matching";
import { Badge } from "@/components/ui/badge";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: runId } = await params;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("runs")
    .select("id, created_at, status")
    .eq("id", runId)
    .single();

  if (!run) notFound();

  const [{ data: poLines }, { data: files }, { data: confirmations }] =
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
    ]);

  const rows = buildMatchRows(poLines ?? [], files ?? [], confirmations ?? []);

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
      acc[status] = rows.filter((r) => r.status === status).length;
      return acc;
    },
    {} as Record<MatchStatus, number>,
  );

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-5xl p-5 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← New run
          </Link>
          <h1 className="text-2xl font-semibold">
            Matches for run {runId.slice(0, 8)}
          </h1>
          <Link
            href={`/runs/${runId}/discrepancies`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Line-level discrepancies →
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((status) => (
            <Badge key={status} variant={STATUS_VARIANT[status]}>
              {STATUS_LABEL[status]}: {counts[status]}
            </Badge>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO number</TableHead>
              <TableHead>Vendor (CSV)</TableHead>
              <TableHead>Vendor (PDF)</TableHead>
              <TableHead>Confirmation file</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const url = row.fileId ? signedUrlByFileId.get(row.fileId) : undefined;
              return (
                <TableRow key={`${row.poNumber ?? "none"}-${row.fileId ?? "none"}-${i}`}>
                  <TableCell>{row.poNumber ?? "—"}</TableCell>
                  <TableCell>{row.vendorCsv ?? "—"}</TableCell>
                  <TableCell>{row.vendorPdf ?? "—"}</TableCell>
                  <TableCell>
                    {row.fileName ? (
                      url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:no-underline"
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
                      <p className="text-xs text-destructive mt-1">{row.error}</p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
