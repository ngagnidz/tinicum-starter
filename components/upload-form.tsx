"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { missingOpenPosColumns, type OpenPosRow } from "@/lib/csv/open-pos";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

type Phase = "idle" | "uploading" | "uploaded" | "extracting" | "done";
type Tab = "upload" | "analyze";

interface UploadedFileRow {
  id: string;
  file_name: string;
}

// webkitdirectory / directory aren't in React's HTML attribute types, but
// every major browser understands them on an <input type="file">.
type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

export function UploadForm() {
  const [csvRows, setCsvRows] = useState<OpenPosRow[] | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [runId, setRunId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileRow[]>([]);
  const [poLineCount, setPoLineCount] = useState(0);
  const [uploadedDistinctPoCount, setUploadedDistinctPoCount] = useState(0);

  const [extractProgress, setExtractProgress] = useState({
    current: 0,
    total: 0,
  });
  const [failures, setFailures] = useState<
    { fileName: string; error: string }[]
  >([]);

  const distinctPoCount = useMemo(() => {
    if (!csvRows) return 0;
    return new Set(csvRows.map((r) => r.po_number)).size;
  }, [csvRows]);

  function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setCsvError(null);
    setCsvRows(null);
    Papa.parse<OpenPosRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const missing = missingOpenPosColumns(results.meta.fields ?? []);
        if (missing.length > 0) {
          setCsvError(
            `CSV is missing required column(s): ${missing.join(", ")}`,
          );
          return;
        }
        setCsvRows(results.data);
      },
      error: (err: Error) => setCsvError(err.message),
    });
  }

  function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    setPdfFiles((prev) => {
      const byKey = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
      for (const f of incoming) byKey.set(`${f.name}:${f.size}`, f);
      return [...byKey.values()];
    });
    e.target.value = "";
  }

  function removePdf(name: string) {
    setPdfFiles((prev) => prev.filter((f) => f.name !== name));
  }

  const canUpload =
    phase === "idle" && !!csvRows && !csvError && pdfFiles.length > 0;

  async function handleUpload() {
    if (!csvRows) return;
    setPhase("uploading");
    setUploadError(null);
    const supabase = createClient();

    try {
      const { data: run, error: runError } = await supabase
        .from("runs")
        .insert({ status: "uploading" })
        .select("id")
        .single();
      if (runError || !run) {
        throw new Error(runError?.message ?? "Could not create run");
      }

      const newRunId = run.id as string;

      await Promise.all(
        pdfFiles.map(async (file) => {
          const path = `${newRunId}/${file.name}`;
          const { error } = await supabase.storage
            .from("confirmations")
            .upload(path, file, { contentType: "application/pdf" });
          if (error) {
            throw new Error(`Upload failed for ${file.name}: ${error.message}`);
          }
        }),
      );

      const { data: fileRows, error: fileRowsError } = await supabase
        .from("confirmation_files")
        .insert(
          pdfFiles.map((file) => ({
            run_id: newRunId,
            file_name: file.name,
            storage_path: `${newRunId}/${file.name}`,
            status: "pending",
          })),
        )
        .select("id, file_name");
      if (fileRowsError || !fileRows) {
        throw new Error(
          fileRowsError?.message ?? "Could not save file records",
        );
      }

      const { error: poLinesError } = await supabase.from("po_lines").insert(
        csvRows.map((row) => ({
          run_id: newRunId,
          po_number: row.po_number,
          po_date: row.po_date || null,
          vendor_id: row.vendor_id || null,
          vendor_name: row.vendor_name || null,
          line_number: row.line_number ? Number(row.line_number) : null,
          our_pn: row.our_pn || null,
          our_description: row.our_description || null,
          qty_ordered: row.qty_ordered ? Number(row.qty_ordered) : null,
          unit_price: row.unit_price ? Number(row.unit_price) : null,
          required_date: row.required_date || null,
        })),
      );
      if (poLinesError) throw new Error(poLinesError.message);

      await supabase
        .from("runs")
        .update({ status: "uploaded" })
        .eq("id", newRunId);

      setRunId(newRunId);
      setUploadedFiles(fileRows as UploadedFileRow[]);
      setPoLineCount(csvRows.length);
      setUploadedDistinctPoCount(distinctPoCount);
      setPhase("uploaded");
      setActiveTab("analyze");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setPhase("idle");
    }
  }

  const EXTRACTION_CONCURRENCY = 3;

  async function handleRunExtraction() {
    if (!runId) return;
    setPhase("extracting");
    setFailures([]);
    setExtractProgress({ current: 0, total: uploadedFiles.length });

    let nextIndex = 0;
    let completed = 0;

    async function extractOne(file: UploadedFileRow) {
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: file.id }),
        });
        const json = await res.json();
        if (!json.ok) {
          setFailures((prev) => [
            ...prev,
            { fileName: file.file_name, error: json.error ?? "Unknown error" },
          ]);
        }
      } catch (err) {
        setFailures((prev) => [
          ...prev,
          {
            fileName: file.file_name,
            error: err instanceof Error ? err.message : "Request failed",
          },
        ]);
      }
      completed += 1;
      setExtractProgress({ current: completed, total: uploadedFiles.length });
    }

    async function worker() {
      while (nextIndex < uploadedFiles.length) {
        const file = uploadedFiles[nextIndex];
        nextIndex += 1;
        await extractOne(file);
      }
    }

    const workerCount = Math.min(EXTRACTION_CONCURRENCY, uploadedFiles.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    await createClient().from("runs").update({ status: "extracted" }).eq("id", runId);
    setPhase("done");
  }

  const directoryProps: DirectoryInputProps = {
    webkitdirectory: "",
    directory: "",
  };

  return (
    <div className="w-full max-w-3xl">
      {/* Step Indicators */}
      <div className="flex gap-4 mb-8 items-center justify-center">
        {[
          { num: 1, label: "Upload", completed: phase !== "idle" },
          { num: 2, label: "Extract", completed: phase === "done" },
          { num: 3, label: "Review matches", completed: false },
        ].map((step, idx) => (
          <div key={step.num} className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold text-sm transition-colors animate-slideUp ${
                step.completed
                  ? "bg-blue-600 text-white"
                  : "bg-gray-300 text-gray-700"
              }`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {step.num}
            </div>
            <span
              className={`text-sm font-medium transition-colors animate-slideUp ${
                step.completed ? "text-gray-900" : "text-gray-500"
              }`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {step.label}
            </span>
            {idx < 2 && <div className="w-8 h-0.5 bg-gray-300"></div>}
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab("upload")}
          className={`pb-3 px-1 font-semibold text-sm transition-colors ${
            activeTab === "upload"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Upload
        </button>
        <button
          onClick={() => setActiveTab("analyze")}
          disabled={phase === "idle" || phase === "uploading"}
          className={`pb-3 px-1 font-semibold text-sm transition-colors ${
            activeTab === "analyze"
              ? "text-blue-600 border-b-2 border-blue-600"
              : phase === "idle" || phase === "uploading"
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Analyze
        </button>
      </div>

      {/* Upload Tab */}
      {activeTab === "upload" && (
        <div className="flex flex-col gap-6">
          {/* Open POs Card - Yellow theme */}
          <Card className="border-0 shadow-sm bg-yellow-50 animate-slideUp">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="text-2xl">📊</div>
                <div>
                  <CardTitle className="text-lg">Open POs</CardTitle>
                  <CardDescription>
                    The open_pos.csv export from your ERP.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="border-2 border-dashed border-yellow-300 rounded-lg p-8 text-center hover:bg-yellow-100 transition-colors cursor-pointer">
                <input
                  id="csv-input"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={phase !== "idle" && phase !== "uploading"}
                  onChange={handleCsvChange}
                  className="hidden"
                />
                <label
                  htmlFor="csv-input"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <div className="text-3xl">📁</div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      Drop the CSV here, or browse
                    </p>
                    <p className="text-xs text-gray-600 mt-1">One .csv file</p>
                  </div>
                </label>
              </div>

              {csvFileName && !csvError && csvRows && (
                <p className="text-sm text-gray-700">
                  ✓ <span className="font-medium">{csvFileName}</span>:{" "}
                  {csvRows.length} rows, {distinctPoCount} distinct POs.
                </p>
              )}
              {csvError && (
                <p className="text-sm text-red-600">✗ {csvError}</p>
              )}

              <div className="bg-yellow-100 p-3 rounded text-xs text-gray-700">
                <p className="font-medium mb-1">Required columns:</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    "po_number",
                    "po_date",
                    "vendor_id",
                    "vendor_name",
                    "line_number",
                    "our_pn",
                    "our_description",
                    "qty_ordered",
                    "unit_price",
                    "required_date",
                  ].map((col) => (
                    <span
                      key={col}
                      className="bg-white px-2 py-1 rounded border border-yellow-200"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vendor Confirmations Card - Pink theme */}
          <Card className="border-0 shadow-sm bg-pink-50 animate-slideUp" style={{ animationDelay: '0.1s' }}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="text-2xl">📄</div>
                <div>
                  <CardTitle className="text-lg">Vendor confirmations</CardTitle>
                  <CardDescription>
                    Pick the whole folder or individual PDF files.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="border-2 border-dashed border-pink-300 rounded-lg p-6 text-center hover:bg-pink-100 transition-colors cursor-pointer">
                  <input
                    id="pdf-folder-input"
                    type="file"
                    multiple
                    disabled={phase !== "idle" && phase !== "uploading"}
                    onChange={handlePdfChange}
                    className="hidden"
                    {...directoryProps}
                  />
                  <label
                    htmlFor="pdf-folder-input"
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    <div className="text-2xl">📁</div>
                    <p className="font-semibold text-gray-900">Choose a folder</p>
                    <p className="text-xs text-gray-600">
                      Everything inside is scanned for PDFs
                    </p>
                  </label>
                </div>

                <div className="border-2 border-dashed border-pink-300 rounded-lg p-6 text-center hover:bg-pink-100 transition-colors cursor-pointer">
                  <input
                    id="pdf-files-input"
                    type="file"
                    multiple
                    accept="application/pdf"
                    disabled={phase !== "idle" && phase !== "uploading"}
                    onChange={handlePdfChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="pdf-files-input"
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    <div className="text-2xl">📋</div>
                    <p className="font-semibold text-gray-900">
                      Choose PDF files
                    </p>
                    <p className="text-xs text-gray-600">Select one or many</p>
                  </label>
                </div>
              </div>

              {pdfFiles.length > 0 && (
                <div className="bg-pink-100 p-3 rounded">
                  <p className="text-sm font-medium text-gray-900 mb-2">
                    {pdfFiles.length} PDF{pdfFiles.length === 1 ? "" : "s"} selected
                  </p>
                  {phase === "idle" && (
                    <ul className="max-h-40 overflow-y-auto text-xs text-gray-700 space-y-1">
                      {pdfFiles.map((f) => (
                        <li
                          key={f.name}
                          className="flex items-center justify-between gap-2 bg-white p-2 rounded"
                        >
                          <span className="truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removePdf(f.name)}
                            className="text-red-600 hover:underline shrink-0 text-xs"
                          >
                            remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upload Button */}
          <Button
            onClick={handleUpload}
            disabled={!canUpload}
            size="lg"
            className={`w-full py-6 text-base font-semibold rounded-lg transition-all animate-slideUp ${
              phase === "uploading"
                ? "bg-blue-400 hover:bg-blue-400 cursor-default"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
            style={{ animationDelay: '0.2s' }}
          >
            {phase === "uploading" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Uploading
              </span>
            ) : (
              "Upload and extract"
            )}
          </Button>

          {uploadError && (
            <p className="text-sm text-red-600 text-center font-medium">
              {uploadError}
            </p>
          )}
        </div>
      )}

      {/* Analyze Tab */}
      {activeTab === "analyze" && phase !== "idle" && phase !== "uploading" && runId && (
        <div className="flex flex-col gap-6 animate-slideUp">
          <Card className="border-0 shadow-sm bg-blue-50">
            <CardHeader>
              <CardTitle className="text-lg">Run {runId.slice(0, 8)}</CardTitle>
              <CardDescription>
                {uploadedFiles.length} PDFs and {poLineCount} PO lines (
                {uploadedDistinctPoCount} distinct POs) uploaded.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {phase === "uploaded" && (
                <Button
                  onClick={handleRunExtraction}
                  size="lg"
                  className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-base font-semibold animate-pulse-light"
                >
                  Analyze
                </Button>
              )}

              {(phase === "extracting" || phase === "done") && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    {phase === "extracting" && (
                      <span className="inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                    )}
                    {phase === "done" && <span className="text-2xl">✓</span>}
                    <Progress
                      value={
                        extractProgress.total === 0
                          ? 0
                          : (extractProgress.current / extractProgress.total) * 100
                      }
                      className="flex-1"
                    />
                  </div>
                  <p className="text-sm text-gray-700 font-medium">
                    {phase === "extracting"
                      ? `Extracting ${extractProgress.current} of ${extractProgress.total}`
                      : `Extracted ${extractProgress.total - failures.length} of ${extractProgress.total} (${failures.length} failed)`}
                  </p>
                </div>
              )}

              {failures.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-red-600">
                    {failures.length} extraction failure{failures.length !== 1 ? "s" : ""}
                  </p>
                  <ul className="text-xs text-gray-700 border border-red-200 bg-red-50 rounded-md p-3 flex flex-col gap-2">
                    {failures.map((f) => (
                      <li key={f.fileName}>
                        <span className="font-medium">{f.fileName}</span>:{" "}
                        {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {phase === "done" && (
                <Button
                  asChild
                  size="lg"
                  className="w-full py-6 bg-green-600 hover:bg-green-700 text-base font-semibold"
                >
                  <Link href={`/runs/${runId}/matches`}>View matches</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
