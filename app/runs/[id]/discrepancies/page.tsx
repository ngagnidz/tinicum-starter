import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RunMatchingButton } from "@/components/run-matching-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Severity } from "@/lib/line-matching";

export const instant = false;

const SEVERITY_ORDER: Severity[] = ["HIGH", "MEDIUM", "LOW"];
const SEVERITY_VARIANT: Record<Severity, "destructive" | "default" | "secondary"> = {
  HIGH: "destructive",
  MEDIUM: "default",
  LOW: "secondary",
};

interface DiscrepancyRow {
  id: string;
  po_number: string | null;
  vendor_name: string | null;
  part: string | null;
  issue_type: string;
  ordered_value: string | null;
  confirmed_value: string | null;
  days_late: number | null;
  note: string | null;
  severity: Severity;
  match_rule: string | null;
  needs_review: boolean;
  source_file: string | null;
}

export default async function DiscrepanciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vendor?: string; issue_type?: string }>;
}) {
  const { id: runId } = await params;
  const { vendor: vendorFilter, issue_type: issueTypeFilter } = await searchParams;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("runs")
    .select("id")
    .eq("id", runId)
    .single();
  if (!run) notFound();

  const [{ data: rows }, { data: files }] = await Promise.all([
    supabase
      .from("discrepancies")
      .select(
        "id, po_number, vendor_name, part, issue_type, ordered_value, confirmed_value, days_late, note, severity, match_rule, needs_review, source_file",
      )
      .eq("run_id", runId),
    supabase.from("confirmation_files").select("file_name, storage_path").eq("run_id", runId),
  ]);

  const allRows = (rows ?? []) as DiscrepancyRow[];

  const storagePathByFileName = new Map((files ?? []).map((f) => [f.file_name, f.storage_path]));
  const distinctFileNames = [
    ...new Set(
      allRows.flatMap((r) => (r.source_file ? r.source_file.split("; ") : [])),
    ),
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

  const vendors = [...new Set(allRows.map((r) => r.vendor_name).filter((v): v is string => !!v))].sort();
  const issueTypes = [...new Set(allRows.map((r) => r.issue_type))].sort();

  const countsByIssueType = new Map<string, number>();
  const countsByVendor = new Map<string, number>();
  for (const r of allRows) {
    countsByIssueType.set(r.issue_type, (countsByIssueType.get(r.issue_type) ?? 0) + 1);
    const v = r.vendor_name ?? "(unknown)";
    countsByVendor.set(v, (countsByVendor.get(v) ?? 0) + 1);
  }

  const filteredRows = allRows
    .filter((r) => !vendorFilter || r.vendor_name === vendorFilter)
    .filter((r) => !issueTypeFilter || r.issue_type === issueTypeFilter)
    .sort((a, b) => {
      const sev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      if (sev !== 0) return sev;
      return (a.po_number ?? "").localeCompare(b.po_number ?? "");
    });

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-6xl p-5 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← New run
          </Link>
          <Link
            href={`/runs/${runId}/matches`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Document-level matches
          </Link>
          <h1 className="text-2xl font-semibold">
            Discrepancies for run {runId.slice(0, 8)}
          </h1>
        </div>

        <RunMatchingButton runId={runId} />

        {allRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No discrepancies yet -- click &quot;Run matching&quot; to compute them.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">By issue type</p>
              <div className="flex flex-wrap gap-2">
                {[...countsByIssueType.entries()].map(([type, count]) => (
                  <Badge key={type} variant="outline">
                    {type}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">By vendor</p>
              <div className="flex flex-wrap gap-2">
                {[...countsByVendor.entries()].map(([vendor, count]) => (
                  <Badge key={vendor} variant="outline">
                    {vendor}: {count}
                  </Badge>
                ))}
              </div>
            </div>

            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="vendor" className="text-xs text-muted-foreground">
                  Vendor
                </label>
                <select
                  id="vendor"
                  name="vendor"
                  defaultValue={vendorFilter ?? ""}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">All vendors</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="issue_type" className="text-xs text-muted-foreground">
                  Issue type
                </label>
                <select
                  id="issue_type"
                  name="issue_type"
                  defaultValue={issueTypeFilter ?? ""}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">All issue types</option>
                  {issueTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="h-9 rounded-md border px-3 text-sm hover:bg-accent"
              >
                Filter
              </button>
              {(vendorFilter || issueTypeFilter) && (
                <Link
                  href={`/runs/${runId}/discrepancies`}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Clear filters
                </Link>
              )}
            </form>

            <p className="text-sm text-muted-foreground">
              Showing {filteredRows.length} of {allRows.length} issues.
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Part</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Confirmed</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell>{r.po_number ?? "—"}</TableCell>
                    <TableCell>{r.vendor_name ?? "—"}</TableCell>
                    <TableCell>{r.part ?? "—"}</TableCell>
                    <TableCell>
                      {r.issue_type}
                      {r.needs_review && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (inferred pairing, rule {r.match_rule})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{r.ordered_value ?? "—"}</TableCell>
                    <TableCell>
                      {r.confirmed_value ?? "—"}
                      {r.days_late !== null && (
                        <span className="text-xs text-muted-foreground"> ({r.days_late}d late)</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                      {r.note ?? ""}
                    </TableCell>
                    <TableCell>
                      {r.source_file
                        ? r.source_file.split("; ").map((name, i) => {
                            const url = signedUrlByFileName.get(name);
                            return (
                              <span key={name}>
                                {i > 0 && ", "}
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline hover:no-underline"
                                  >
                                    {name}
                                  </a>
                                ) : (
                                  name
                                )}
                              </span>
                            );
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </main>
  );
}
