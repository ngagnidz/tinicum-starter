import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { humanizeIssueType } from "@/lib/issue-labels";
import type { Severity } from "@/lib/line-matching";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VendorEmailPanel } from "@/components/vendor-email-panel";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";

export const instant = false;

const SEVERITY_ORDER: Severity[] = ["HIGH", "MEDIUM", "LOW"];
const SEVERITY_VARIANT: Record<Severity, "destructive" | "default" | "secondary"> = {
  HIGH: "destructive",
  MEDIUM: "default",
  LOW: "secondary",
};

interface DiscrepancyRow {
  id: string;
  vendor_name: string | null;
  part: string | null;
  issue_type: string;
  ordered_value: string | null;
  confirmed_value: string | null;
  days_late: number | null;
  note: string | null;
  severity: Severity;
  needs_review: boolean;
  match_rule: string | null;
  source_file: string | null;
}

export default async function MatchDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ po?: string }>;
}) {
  const { id: runId } = await params;
  const { po } = await searchParams;

  if (!po) notFound();

  const supabase = await createClient();

  const { data: run } = await supabase.from("runs").select("id").eq("id", runId).single();
  if (!run) notFound();

  const [{ data: rows }, { data: files }] = await Promise.all([
    supabase
      .from("discrepancies")
      .select(
        "id, vendor_name, part, issue_type, ordered_value, confirmed_value, days_late, note, severity, needs_review, match_rule, source_file",
      )
      .eq("run_id", runId)
      .eq("po_number", po),
    supabase.from("confirmation_files").select("file_name, storage_path").eq("run_id", runId),
  ]);

  const allRows = (rows ?? []) as DiscrepancyRow[];
  if (allRows.length === 0) notFound();

  const storagePathByFileName = new Map((files ?? []).map((f) => [f.file_name, f.storage_path]));
  const distinctFileNames = [
    ...new Set(allRows.flatMap((r) => (r.source_file ? r.source_file.split("; ") : []))),
  ];
  const signedUrlByFileName = new Map<string, string>();
  await Promise.all(
    distinctFileNames.map(async (fileName) => {
      const storagePath = storagePathByFileName.get(fileName);
      if (!storagePath) return;
      const { data } = await supabase.storage
        .from("confirmations")
        .createSignedUrl(storagePath, 3600);
      if (data?.signedUrl) signedUrlByFileName.set(fileName, data.signedUrl);
    }),
  );

  const vendorName = allRows.find((r) => r.vendor_name)?.vendor_name ?? null;

  const sortedRows = [...allRows].sort((a, b) => {
    const sev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (sev !== 0) return sev;
    return (a.part ?? "").localeCompare(b.part ?? "");
  });

  const countBySeverity = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = allRows.filter((r) => r.severity === s).length;
      return acc;
    },
    {} as Record<Severity, number>,
  );

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-2xl p-5 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-1 text-center animate-fadeIn">
          <Link
            href={`/runs/${runId}/matches`}
            className="self-start text-sm text-blue-600 hover:underline"
          >
            ← Back to matches
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{po}</h1>
          {vendorName && <p className="text-sm text-gray-500">{vendorName}</p>}
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap justify-center gap-2 animate-fadeIn">
            {SEVERITY_ORDER.filter((s) => countBySeverity[s] > 0).map((s) => (
              <Badge key={s} variant={SEVERITY_VARIANT[s]}>
                {countBySeverity[s]} {s}
              </Badge>
            ))}
          </div>

          {distinctFileNames.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 animate-fadeIn">
              {distinctFileNames.map((name) => (
                <PdfPreviewDialog key={name} name={name} url={signedUrlByFileName.get(name)}>
                  <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    View PDF — {name}
                  </span>
                </PdfPreviewDialog>
              ))}
            </div>
          )}

          <VendorEmailPanel runId={runId} po={po} />

          <div className="flex flex-col gap-3">
            {sortedRows.map((r, i) => (
              <Card
                key={r.id}
                className="shadow-sm animate-slideUp"
                style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
              >
                <CardContent className="pt-6 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</Badge>
                    <span className="font-semibold text-gray-900">
                      {humanizeIssueType(r.issue_type)}
                    </span>
                    {r.part && (
                      <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-0.5">
                        Part {r.part}
                      </span>
                    )}
                  </div>

                  {(r.ordered_value || r.confirmed_value) && (
                    <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-gray-700">
                      {r.ordered_value && (
                        <div>
                          <span className="text-gray-500">Ordered: </span>
                          {r.ordered_value}
                        </div>
                      )}
                      {r.confirmed_value && (
                        <div>
                          <span className="text-gray-500">Confirmed: </span>
                          {r.confirmed_value}
                          {r.days_late !== null && (
                            <span className="text-red-600"> ({r.days_late}d late)</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {r.note && <p className="text-sm text-gray-600">{r.note}</p>}

                  {r.needs_review && (
                    <p className="text-xs text-gray-400">
                      Inferred pairing, rule {r.match_rule}
                    </p>
                  )}

                  {r.source_file && (
                    <p className="text-xs text-gray-500">
                      {r.source_file.split("; ").map((name, idx) => (
                        <span key={name}>
                          {idx > 0 && ", "}
                          <PdfPreviewDialog name={name} url={signedUrlByFileName.get(name)}>
                            {name}
                          </PdfPreviewDialog>
                        </span>
                      ))}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
